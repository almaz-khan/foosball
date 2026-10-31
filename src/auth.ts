/**
 * Passkey accounts: registration, sign-in and sessions. Ported from the budget
 * app (~/workspace/budget/src/auth.ts), keeping its fixes for password managers
 * that mangle user handles:
 *   - User handles are ASCII (users.ts newUserHandle). NordPass decodes the
 *     handle as UTF-8 text and re-encodes it, which destroys binary handles.
 *   - Sign-in identifies the user by credential id and signature, never by the
 *     user handle, which is outside the signature and proves nothing.
 *
 * Where foosball differs: an account is created only by an org invite
 * (lib/server/invites.ts), together with its first passkey and its membership.
 * Enrollment links only ever add a passkey to an existing account: a new
 * device, or recovery when every device is lost.
 */
import { isIP } from 'node:net';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm';
import { getDb, type Executor } from './lib/server/db/index.ts';
import { appUser, authChallenge, authCredential, authEnrollment, authSession } from './lib/server/db/schema.ts';
import { acceptInvite, inviteFor, InviteError } from './lib/server/invites.ts';
import { hashToken as hash, inDays, inMinutes, newToken, now } from './lib/server/tokens.ts';
import { cleanUserName, createUser, findUser, getUser, newUserHandle, UserError, type User } from './lib/server/users.ts';

export const SESSION_COOKIE = 'foosball_session';
export const SESSION_DAYS = 30;
export const ENROLL_MINUTES = 15;
const CHALLENGE_MINUTES = 5;

export interface AuthConfig {
  /** Exact origin the browser shows, e.g. `https://foosball.almaz.dev`. */
  origin: string;
  /** Hostname of the origin. WebAuthn binds every passkey to it. */
  rpID: string;
}

/**
 * Passkeys are bound to a hostname and browsers refuse them on bare IPs, so
 * `http://127.0.0.1:5180` can never work; `http://localhost:5180` can, and so
 * can any HTTPS hostname.
 */
export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const raw = env.FOOSBALL_ORIGIN ?? 'http://localhost:5180';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`FOOSBALL_ORIGIN is not a URL: ${raw}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    throw new Error(
      `FOOSBALL_ORIGIN must use a hostname, not an IP (${raw}): browsers refuse passkeys on IP addresses. ` +
        'Use http://localhost:5180 locally, or an HTTPS hostname.',
    );
  }
  if (url.protocol !== 'https:' && host !== 'localhost') {
    throw new Error(`FOOSBALL_ORIGIN must be https unless it is localhost (${raw}).`);
  }
  return { origin: url.origin, rpID: host };
}

/**
 * A failure whose message is safe and useful to show the person signing in.
 * Diagnostics are for the server log only: which check failed and the shape of
 * what the authenticator sent, never keys, tokens or signatures themselves.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly diagnostics?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const LINK_USED = 'This link was already used or has expired. Ask for a new one.';

// ---------------------------------------------------------------- enrollment (another passkey for an account)

export async function createEnrollment(
  userId: number,
  db: Executor = getDb(),
  minutes = ENROLL_MINUTES,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const [row] = await db
    .insert(authEnrollment)
    .values({ tokenHash: hash(token), userId, expiresAt: inMinutes(minutes) })
    .returning({ expiresAt: authEnrollment.expiresAt });
  return { token, expiresAt: row!.expiresAt };
}

const liveEnrollment = (token: string) =>
  and(eq(authEnrollment.tokenHash, hash(token)), isNull(authEnrollment.usedAt), gt(authEnrollment.expiresAt, now));

/** The account an unused, unexpired link adds a passkey to, or null. */
export async function enrollmentFor(token: string, db: Executor = getDb()): Promise<User | null> {
  const [row] = await db.select({ userId: authEnrollment.userId }).from(authEnrollment).where(liveEnrollment(token));
  return row ? getUser(row.userId, db) : null;
}

// ---------------------------------------------------------------- challenges

async function storeChallenge(
  challenge: string,
  purpose: 'register' | 'login',
  db: Executor,
  webauthnUserId: Uint8Array | null = null,
): Promise<string> {
  const id = newToken();
  await db.delete(authChallenge).where(lt(authChallenge.expiresAt, now));
  await db.insert(authChallenge).values({
    id,
    challenge,
    purpose,
    expiresAt: inMinutes(CHALLENGE_MINUTES),
    webauthnUserId: webauthnUserId ? Buffer.from(webauthnUserId) : null,
  });
  return id;
}

/** Single use: deleted whether or not verification then succeeds. */
export async function consumeChallenge(
  id: string,
  purpose: 'register' | 'login',
  db: Executor = getDb(),
): Promise<{ challenge: string; webauthnUserId: Uint8Array | null } | null> {
  const [row] = await db
    .delete(authChallenge)
    .where(and(eq(authChallenge.id, id), eq(authChallenge.purpose, purpose), gt(authChallenge.expiresAt, now)))
    .returning({ challenge: authChallenge.challenge, webauthnUserId: authChallenge.webauthnUserId });
  if (!row) return null;
  return {
    challenge: row.challenge,
    webauthnUserId: row.webauthnUserId ? new Uint8Array(row.webauthnUserId) : null,
  };
}

// ---------------------------------------------------------------- credentials

export interface Passkey {
  id: string;
  userId: number;
  userName: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** One account's passkeys, or everyone's when no account is given (the CLI). */
export async function listPasskeys(userId: number | null, db: Executor = getDb()): Promise<Passkey[]> {
  return db
    .select({
      id: authCredential.id,
      userId: authCredential.userId,
      userName: appUser.name,
      name: authCredential.name,
      createdAt: authCredential.createdAt,
      lastUsedAt: authCredential.lastUsedAt,
    })
    .from(authCredential)
    .innerJoin(appUser, eq(appUser.id, authCredential.userId))
    .where(userId === null ? undefined : eq(authCredential.userId, userId))
    .orderBy(asc(appUser.id), asc(authCredential.createdAt));
}

export async function hasPasskeys(db: Executor = getDb()): Promise<boolean> {
  const rows = await db.select({ id: authCredential.id }).from(authCredential).limit(1);
  return rows.length > 0;
}

/**
 * Removes a passkey and, by cascade, every session it signed in. With an
 * account id, only that account's own passkey can be removed.
 */
export async function revokePasskey(id: string, userId: number | null, db: Executor = getDb()): Promise<boolean> {
  const rows = await db
    .delete(authCredential)
    .where(and(eq(authCredential.id, id), userId === null ? undefined : eq(authCredential.userId, userId)))
    .returning({ id: authCredential.id });
  return rows.length > 0;
}

export async function renamePasskey(id: string, userId: number, name: string, db: Executor = getDb()): Promise<boolean> {
  const rows = await db
    .update(authCredential)
    .set({ name: deviceName(name) })
    .where(and(eq(authCredential.id, id), eq(authCredential.userId, userId)))
    .returning({ id: authCredential.id });
  return rows.length > 0;
}

const deviceName = (name: string) => name.trim().slice(0, 60) || 'Passkey';

// ---------------------------------------------------------------- registration

/** Whose passkey is being created: an existing account's, or the account an invite will create. */
export type RegistrationSubject = { user: User } | { newUserName: string };

/** Where the right to register comes from. */
export type RegisterAuthority =
  /** A signed-in person adding a device to their own account. */
  | { kind: 'session'; userId: number }
  /** An enrollment link adding a passkey to the account it names. */
  | { kind: 'enrollment'; token: string }
  /** An org invite, opened signed out: creates the account `userName`, then joins the org. */
  | { kind: 'invite'; token: string; userName: string };

/** The subject an authority registers for, or an AuthError saying why there is none. */
export async function registrationSubject(authority: RegisterAuthority, db: Executor = getDb()): Promise<RegistrationSubject> {
  switch (authority.kind) {
    case 'session': {
      const user = await getUser(authority.userId, db);
      if (!user) throw new AuthError('Sign in first.');
      return { user };
    }
    case 'enrollment': {
      const user = await enrollmentFor(authority.token, db);
      if (!user) throw new AuthError(LINK_USED);
      return { user };
    }
    case 'invite': {
      if (!(await inviteFor(authority.token, db))) throw new AuthError(LINK_USED);
      const name = userName(authority.userName);
      if (await findUser(name, db)) throw new AuthError(`Someone is already called “${name}”. Choose another name.`);
      return { newUserName: name };
    }
  }
}

function userName(name: string): string {
  try {
    return cleanUserName(name);
  } catch (err) {
    throw err instanceof UserError ? new AuthError(err.message) : err;
  }
}

export async function registrationOptions(
  subject: RegistrationSubject,
  config: AuthConfig,
  db: Executor = getDb(),
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const existing =
    'user' in subject
      ? await db
          .select({ id: authCredential.id, transports: authCredential.transports })
          .from(authCredential)
          .where(eq(authCredential.userId, subject.user.id))
      : [];
  // A new account gets its handle now; the verify step creates it with it.
  const webauthnUserId = 'user' in subject ? subject.user.webauthnId : newUserHandle();
  const name = 'user' in subject ? subject.user.name : subject.newUserName;

  const options = await generateRegistrationOptions({
    rpName: 'Foosball',
    rpID: config.rpID,
    userID: webauthnUserId,
    userName: name,
    userDisplayName: name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return {
    challengeId: await storeChallenge(options.challenge, 'register', db, webauthnUserId),
    options,
  };
}

/**
 * Registers a passkey. A session adds a device to its own account; an
 * enrollment link, which this consumes, adds one to the account it names; an
 * invite, which this consumes, creates the account and its membership, all in
 * one transaction.
 */
export async function registerPasskey(
  input: { challengeId: string; response: RegistrationResponseJSON; name: string },
  authority: RegisterAuthority,
  config: AuthConfig,
  db: Executor = getDb(),
): Promise<{ credentialId: string; userId: number }> {
  const issued = await consumeChallenge(input.challengeId, 'register', db);
  if (!issued?.webauthnUserId) throw new AuthError('This request expired. Try again.');

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: issued.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new AuthError('The passkey could not be verified.', {
      check: 'registration',
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!verification.verified) throw new AuthError('The passkey could not be verified.', { check: 'registration' });
  const { credential } = verification.registrationInfo;
  const handle = issued.webauthnUserId;

  return db.transaction(async (tx) => {
    let user: User;
    switch (authority.kind) {
      case 'session': {
        const found = await getUser(authority.userId, tx);
        if (!found) throw new AuthError('Sign in first.');
        user = found;
        break;
      }
      case 'enrollment': {
        const [link] = await tx
          .update(authEnrollment)
          .set({ usedAt: now })
          .where(liveEnrollment(authority.token))
          .returning({ userId: authEnrollment.userId });
        if (!link) throw new AuthError(LINK_USED);
        user = (await getUser(link.userId, tx))!;
        break;
      }
      case 'invite': {
        // Options for a new account carry a freshly minted handle. One that is
        // already someone's means the options were issued for that person.
        const [taken] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.webauthnId, Buffer.from(handle)));
        if (taken) throw new AuthError('This request was made for a different person. Try again.');
        try {
          user = await createUser(userName(authority.userName), handle, tx);
          await acceptInvite(authority.token, user.id, tx);
        } catch (err) {
          if (err instanceof UserError || err instanceof InviteError) throw new AuthError(err.message);
          throw err;
        }
        break;
      }
    }

    // The options were issued for one account's handle; a response carrying
    // someone else's cannot be attached to this account.
    if (!sameBytes(user.webauthnId, handle)) throw new AuthError('This request was made for a different person. Try again.');

    const inserted = await tx
      .insert(authCredential)
      .values({
        id: credential.id,
        userId: user.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        name: deviceName(input.name),
      })
      .onConflictDoNothing({ target: authCredential.id })
      .returning({ id: authCredential.id });
    if (inserted.length === 0) throw new AuthError('This passkey is already registered.');
    return { credentialId: credential.id, userId: user.id };
  });
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------- sign-in

export async function loginOptions(
  config: AuthConfig,
  db: Executor = getDb(),
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  // No allowCredentials: passkeys are discoverable, and listing ids would hand
  // them to anyone who can reach the sign-in page.
  const options = await generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required' });
  return { challengeId: await storeChallenge(options.challenge, 'login', db), options };
}

export async function verifyLogin(
  input: { challengeId: string; response: AuthenticationResponseJSON },
  config: AuthConfig,
  db: Executor = getDb(),
): Promise<{ credentialId: string; userId: number }> {
  const issued = await consumeChallenge(input.challengeId, 'login', db);
  if (!issued) throw new AuthError('This sign-in request expired. Try again.', { check: 'challenge' });

  const [row] = await db
    .select({
      id: authCredential.id,
      userId: authCredential.userId,
      publicKey: authCredential.publicKey,
      counter: authCredential.counter,
      transports: authCredential.transports,
      webauthnId: appUser.webauthnId,
    })
    .from(authCredential)
    .innerJoin(appUser, eq(appUser.id, authCredential.userId))
    .where(eq(authCredential.id, input.response.id));
  if (!row) throw new AuthError('This passkey isn’t registered here. It may have been removed.', { check: 'credential' });

  // The user handle is NOT covered by the assertion signature, so it cannot
  // authenticate anything; who signs in is decided by the credential id, whose
  // stored public key the signature must verify against below. Some password
  // managers (NordPass) return a handle other than the one they were given, so
  // a mismatch is logged, never fatal, and never changes who signs in.
  const userHandle = input.response.response.userHandle;
  const handleMismatch =
    userHandle !== undefined && Buffer.from(userHandle, 'base64url').compare(row.webauthnId) !== 0;

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: issued.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(row.publicKey),
        counter: row.counter,
        transports: row.transports as never,
      },
    });
  } catch (err) {
    throw new AuthError('This passkey could not be verified.', {
      check: 'assertion',
      err: err instanceof Error ? err.message : String(err),
      ...describeAssertion(input.response),
    });
  }
  if (!verification.verified) {
    throw new AuthError('This passkey could not be verified.', {
      check: 'signature',
      ...describeAssertion(input.response),
      storedKeyBytes: row.publicKey.length,
    });
  }

  if (handleMismatch) {
    console.warn(
      JSON.stringify({
        event: 'passkey_user_handle_mismatch',
        credentialId: row.id.slice(0, 16),
        receivedBytes: Buffer.from(userHandle!, 'base64url').length,
        expectedBytes: row.webauthnId.length,
        // An opaque account id, not a secret (it is outside the signature and
        // proves nothing). Logged so a manager's encoding can be identified.
        receivedHex: Buffer.from(userHandle!, 'base64url').toString('hex'),
      }),
    );
  }

  await db
    .update(authCredential)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: now })
    .where(eq(authCredential.id, row.id));
  console.info(
    JSON.stringify({
      event: 'passkey_login',
      credentialId: row.id.slice(0, 16),
      handleMatched: userHandle === undefined ? null : !handleMismatch,
    }),
  );
  return { credentialId: row.id, userId: row.userId };
}

// ---------------------------------------------------------------- sessions

export async function createSession(credentialId: string, db: Executor = getDb()): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  await db.delete(authSession).where(lt(authSession.expiresAt, now));
  const [row] = await db
    .insert(authSession)
    .values({ tokenHash: hash(token), credentialId, expiresAt: inDays(SESSION_DAYS) })
    .returning({ expiresAt: authSession.expiresAt });
  // A session opened by enrolling counts as using the passkey, as a sign-in does.
  await db.update(authCredential).set({ lastUsedAt: now }).where(eq(authCredential.id, credentialId));
  return { token, expiresAt: row!.expiresAt };
}

export interface Session {
  userId: number;
  userName: string;
  credentialId: string;
  expiresAt: Date;
  /** True when the expiry moved, so the cookie should be re-sent. */
  renewed: boolean;
}

/**
 * Sliding expiry: a session in use is pushed out to 30 days, at most once a day.
 * Runs on every request, so it looks up and extends in a single statement: the
 * extension is a data-modifying CTE. The main query still sees the row as it
 * was, so the new expiry comes from the CTE, and whether it ran is `renewed`.
 */
export async function validateSession(token: string, db: Executor = getDb()): Promise<Session | null> {
  const live = and(eq(authSession.tokenHash, hash(token)), gt(authSession.expiresAt, now));
  const bumped = db.$with('bumped').as(
    db
      .update(authSession)
      .set({ expiresAt: inDays(SESSION_DAYS) })
      .where(and(live, lt(authSession.expiresAt, inDays(SESSION_DAYS - 1))))
      .returning({ tokenHash: authSession.tokenHash, expiresAt: authSession.expiresAt }),
  );
  const [row] = await db
    .with(bumped)
    .select({
      userId: appUser.id,
      userName: appUser.name,
      credentialId: authSession.credentialId,
      expiresAt: authSession.expiresAt,
      bumpedTo: bumped.expiresAt,
    })
    .from(authSession)
    .leftJoin(bumped, eq(bumped.tokenHash, authSession.tokenHash))
    .innerJoin(authCredential, eq(authCredential.id, authSession.credentialId))
    .innerJoin(appUser, eq(appUser.id, authCredential.userId))
    .where(live);
  return row
    ? {
        userId: row.userId,
        userName: row.userName,
        credentialId: row.credentialId,
        expiresAt: row.bumpedTo ?? row.expiresAt,
        renewed: row.bumpedTo !== null,
      }
    : null;
}

export async function deleteSession(token: string, db: Executor = getDb()): Promise<void> {
  await db.delete(authSession).where(eq(authSession.tokenHash, hash(token)));
}

/** The non-secret shape of an assertion: enough to tell a malformed one from a forged one. */
function describeAssertion(response: AuthenticationResponseJSON): Record<string, unknown> {
  const signature = Buffer.from(response.response.signature, 'base64url');
  const authData = Buffer.from(response.response.authenticatorData, 'base64url');
  let clientData: { type?: string; origin?: string } = {};
  try {
    clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
  } catch {
    clientData = { type: 'unparseable' };
  }
  return {
    // ES256 signatures must be ASN.1 DER (first byte 0x30, ~70-72 bytes). A raw
    // 64-byte r||s signature is a known authenticator bug and fails verification.
    signatureBytes: signature.length,
    signatureFirstByte: signature.length ? `0x${signature[0]!.toString(16).padStart(2, '0')}` : null,
    authDataBytes: authData.length,
    flags: authData.length > 32 ? `0x${authData[32]!.toString(16).padStart(2, '0')}` : null,
    counter: authData.length >= 37 ? authData.readUInt32BE(33) : null,
    clientDataType: clientData.type ?? null,
    clientDataOrigin: clientData.origin ?? null,
  };
}
