import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type Db, type Executor } from './lib/server/db/index.ts';
import { appUser, hubLogin, userSession } from './lib/server/db/schema.ts';
import { hashToken as hash, inDays, inMinutes, newToken, now } from './lib/server/tokens.ts';
import { cleanUserName } from './lib/server/users.ts';

/*
 * Who is signed in. People prove who they are at the login hub
 * (src/lib/server/hub.ts runs that protocol); this is what Foosball keeps
 * afterwards: the sign-in in progress, the link from the hub's person key to a
 * Foosball account, and the browser's session. Ported from the budget app
 * (~/workspace/budget/src/sessions.ts).
 */

export const SESSION_COOKIE = 'foosball_session';
/** The cookie that names a sign-in in progress, between the hub's redirect and its callback. */
export const LOGIN_COOKIE = 'foosball_login';
export const SESSION_DAYS = 30;
/** A page load this long after the hub last approved someone goes back through the hub. */
export const HUB_CHECK_HOURS = 24;
export const LOGIN_MINUTES = 10;

// ---------------------------------------------------------------- sign-ins in progress

export interface LoginInProgress {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Where to go once signed in: a local path. */
  next: string;
  /** A silent re-check rather than a sign-in someone asked for. */
  silent: boolean;
}

/** Keeps a sign-in until the hub sends the browser back. Returns the id for the browser's cookie. */
export async function saveLogin(login: LoginInProgress, db: Executor = getDb()): Promise<string> {
  const id = newToken();
  await db.delete(hubLogin).where(lt(hubLogin.expiresAt, now));
  await db.insert(hubLogin).values({ idHash: hash(id), ...login, expiresAt: inMinutes(LOGIN_MINUTES) });
  return id;
}

/** Single use: gone whether or not the sign-in then completes. Null if unknown or expired. */
export async function takeLogin(id: string, db: Executor = getDb()): Promise<LoginInProgress | null> {
  const [row] = await db
    .delete(hubLogin)
    .where(and(eq(hubLogin.idHash, hash(id)), gt(hubLogin.expiresAt, now)))
    .returning({
      state: hubLogin.state,
      nonce: hubLogin.nonce,
      codeVerifier: hubLogin.codeVerifier,
      next: hubLogin.next,
      silent: hubLogin.silent,
    });
  return row ?? null;
}

// ---------------------------------------------------------------- who a hub person is here

/**
 * The Foosball account for someone the hub let in. Their person key decides,
 * once linked. Before that, an account from the passkey era not yet linked
 * whose name is the key or the person's name (ignoring case) is linked,
 * keeping its orgs and games; anyone else gets a new account in no org, which
 * an org invite then adds to an org. The hub has already decided they may open
 * Foosball.
 */
export async function userForHubPerson(
  person: { sub: string; name: string },
  db: Db = getDb(),
): Promise<{ userId: number; created: boolean; linked: boolean }> {
  try {
    return await db.transaction((tx) => findOrCreate(person, tx));
  } catch (err) {
    // Two first sign-ins at once: the other one linked or created them; use that.
    if (isUniqueViolation(err)) {
      const [row] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.hubSub, person.sub));
      if (row) return { userId: row.id, created: false, linked: false };
    }
    throw err;
  }
}

async function findOrCreate(
  person: { sub: string; name: string },
  tx: Executor,
): Promise<{ userId: number; created: boolean; linked: boolean }> {
  const [known] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.hubSub, person.sub));
  if (known) return { userId: known.id, created: false, linked: false };

  const names = [...new Set([person.sub, person.name].map((n) => n.trim().toLowerCase()).filter(Boolean))];
  const candidates = await tx
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(and(isNull(appUser.hubSub), or(...names.map((n) => sql`lower(${appUser.name}) = ${n}`))))
    .for('update');
  // The person key is what the hub guarantees; a match on it beats one on the display name.
  const match =
    candidates.find((c) => c.name.toLowerCase() === person.sub.trim().toLowerCase()) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (match) {
    await tx.update(appUser).set({ hubSub: person.sub }).where(eq(appUser.id, match.id));
    return { userId: match.id, created: false, linked: true };
  }

  const [row] = await tx
    .insert(appUser)
    .values({ name: await freeName(person, tx), hubSub: person.sub })
    .returning({ id: appUser.id });
  return { userId: row!.id, created: true, linked: false };
}

/** Account names are unique: the person's name, else with their key, else numbered. */
async function freeName(person: { sub: string; name: string }, tx: Executor): Promise<string> {
  const base = cleanUserName(person.name.trim() || person.sub);
  const options = [base, `${base} (${person.sub})`, ...Array.from({ length: 20 }, (_, i) => `${base} ${i + 2}`)];
  for (const option of options) {
    const name = cleanUserName(option);
    const [taken] = await tx.select({ id: appUser.id }).from(appUser).where(sql`lower(${appUser.name}) = ${name.toLowerCase()}`);
    if (!taken) return name;
  }
  return cleanUserName(`${base.slice(0, 33)} ${newToken().slice(0, 6)}`);
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  ((err as { code?: string }).code === '23505' || isUniqueViolation((err as { cause?: unknown }).cause));

// ---------------------------------------------------------------- sessions

/** A new session for someone the hub has just approved. */
export async function createSession(userId: number, db: Executor = getDb()): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  await db.delete(userSession).where(lt(userSession.expiresAt, now));
  const [row] = await db
    .insert(userSession)
    .values({ tokenHash: hash(token), userId, expiresAt: inDays(SESSION_DAYS) })
    .returning({ expiresAt: userSession.expiresAt });
  return { token, expiresAt: row!.expiresAt };
}

export interface Session {
  userId: number;
  userName: string;
  expiresAt: Date;
  /** True when the expiry moved, so the cookie should be re-sent. */
  renewed: boolean;
  /** True when the hub last approved them over HUB_CHECK_HOURS ago: a page load goes back through it. */
  hubCheckDue: boolean;
}

/**
 * Sliding expiry: a session in use is pushed out to 30 days, at most once a day.
 * Runs on every request, so it looks up and extends in a single statement: the
 * extension is a data-modifying CTE. The main query still sees the row as it
 * was, so the new expiry comes from the CTE, and whether it ran is `renewed`.
 */
export async function validateSession(token: string, db: Executor = getDb()): Promise<Session | null> {
  const live = and(eq(userSession.tokenHash, hash(token)), gt(userSession.expiresAt, now));
  const bumped = db.$with('bumped').as(
    db
      .update(userSession)
      .set({ expiresAt: inDays(SESSION_DAYS) })
      .where(and(live, lt(userSession.expiresAt, inDays(SESSION_DAYS - 1))))
      .returning({ tokenHash: userSession.tokenHash, expiresAt: userSession.expiresAt }),
  );
  const [row] = await db
    .with(bumped)
    .select({
      userId: appUser.id,
      userName: appUser.name,
      expiresAt: userSession.expiresAt,
      bumpedTo: bumped.expiresAt,
      hubCheckDue: sql<boolean>`${userSession.hubCheckedAt} < now() - make_interval(hours => ${HUB_CHECK_HOURS})`,
    })
    .from(userSession)
    .leftJoin(bumped, eq(bumped.tokenHash, userSession.tokenHash))
    .innerJoin(appUser, eq(appUser.id, userSession.userId))
    .where(live);
  return row
    ? {
        userId: row.userId,
        userName: row.userName,
        expiresAt: row.bumpedTo ?? row.expiresAt,
        renewed: row.bumpedTo !== null,
        hubCheckDue: row.hubCheckDue,
      }
    : null;
}

export async function deleteSession(token: string, db: Executor = getDb()): Promise<void> {
  await db.delete(userSession).where(eq(userSession.tokenHash, hash(token)));
}

/** Ends every session an account has, e.g. when the hub says they may no longer open Foosball. */
export async function deleteUserSessions(userId: number, db: Executor = getDb()): Promise<void> {
  await db.delete(userSession).where(eq(userSession.userId, userId));
}
