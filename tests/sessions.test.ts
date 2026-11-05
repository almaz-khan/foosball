import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { sql as q } from 'drizzle-orm';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { createOrg, memberships } from '../src/lib/server/orgs.ts';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  saveLogin,
  takeLogin,
  userForHubPerson,
  validateSession,
  type LoginInProgress,
} from '../src/sessions.ts';
import { freshDatabase } from './helpers/testdb.ts';

let db: Db;
let sql: Db['$client'];
/** Almaz: an account from the passkey era, admin of the office, not yet linked to the hub. */
let almaz: number;

beforeAll(async () => {
  db = await freshDatabase();
  sql = db.$client;
});
afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});
beforeEach(async () => {
  await db.execute(q`TRUNCATE foosball.org, foosball.app_user, foosball.hub_login RESTART IDENTITY CASCADE`);
  const office = await createOrg('Office', 'office', db);
  [{ id: almaz }] = (await db.insert(appUser).values({ name: 'Almaz' }).returning({ id: appUser.id })) as [{ id: number }];
  await db.insert(orgMember).values({ orgId: office.id, userId: almaz, role: 'admin' });
});

const login: LoginInProgress = { state: 's', nonce: 'n', codeVerifier: 'v', next: '/games', silent: false };
const count = async (table: string) =>
  ((await sql.unsafe(`SELECT count(*)::int AS n FROM foosball.${table}`)) as unknown as [{ n: number }])[0].n;

test('a sign-in in progress is kept by a hash of its id, and taken once', async () => {
  const id = await saveLogin(login, db);
  const [row] = await sql`SELECT encode(id_hash, 'hex') AS h FROM foosball.hub_login`;
  expect(row!.h).not.toContain(Buffer.from(id).toString('hex'));
  expect(await takeLogin(id, db)).toEqual(login);
  expect(await takeLogin(id, db)).toBeNull();
  expect(await takeLogin('made-up', db)).toBeNull();
});

test('an expired sign-in in progress is refused, and swept by the next one', async () => {
  const id = await saveLogin(login, db);
  await sql`UPDATE foosball.hub_login SET expires_at = now() - interval '1 minute'`;
  expect(await takeLogin(id, db)).toBeNull();
  const old = await saveLogin(login, db);
  await sql`UPDATE foosball.hub_login SET expires_at = now() - interval '1 minute'`;
  await saveLogin(login, db);
  expect(await takeLogin(old, db)).toBeNull();
  expect(await count('hub_login')).toBe(1);
});

test('links an existing account by the person key, ignoring case, and keeps its orgs', async () => {
  expect(await userForHubPerson({ sub: 'almaz', name: 'Someone Else' }, db)).toEqual({ userId: almaz, created: false, linked: true });
  const [row] = await sql`SELECT hub_sub FROM foosball.app_user WHERE id = ${almaz}`;
  expect(row!.hub_sub).toBe('almaz');
  expect((await memberships(almaz, db)).map((m) => [m.orgSlug, m.role])).toEqual([['office', 'admin']]);
  // From then on the key alone finds them.
  expect(await userForHubPerson({ sub: 'almaz', name: 'Renamed' }, db)).toEqual({ userId: almaz, created: false, linked: false });
});

test('links by the person’s name when the key matches nobody', async () => {
  expect(await userForHubPerson({ sub: 'k-17', name: 'ALMAZ' }, db)).toMatchObject({ userId: almaz, linked: true });
});

test('never re-links an account already linked to another person', async () => {
  await userForHubPerson({ sub: 'almaz', name: 'Almaz' }, db);
  const other = await userForHubPerson({ sub: 'impostor', name: 'Almaz' }, db);
  expect(other.created).toBe(true);
  expect(other.userId).not.toBe(almaz);
  const [row] = await sql`SELECT name, hub_sub FROM foosball.app_user WHERE id = ${other.userId}`;
  // "Almaz" is taken, so the new account's name carries their key.
  expect(row).toEqual({ name: 'Almaz (impostor)', hub_sub: 'impostor' });
  // A new account is in no org: an invite brings them in.
  expect(await memberships(other.userId, db)).toEqual([]);
});

test('someone new gets an account in no org', async () => {
  const made = await userForHubPerson({ sub: 'bob', name: '  Bob   Ng ' }, db);
  expect(made.created).toBe(true);
  const [row] = await sql`SELECT name FROM foosball.app_user WHERE id = ${made.userId}`;
  expect(row!.name).toBe('Bob Ng');
  expect(await memberships(made.userId, db)).toEqual([]);
});

test('a display name shared by two unlinked accounts links neither', async () => {
  await db.insert(appUser).values([{ name: 'Sam' }, { name: 'SAM' }]);
  expect((await userForHubPerson({ sub: 'k-99', name: 'Sam' }, db)).created).toBe(true);
});

test('two first sign-ins at once end up as one account', async () => {
  const [a, b] = await Promise.all([
    userForHubPerson({ sub: 'carol', name: 'Carol' }, db),
    userForHubPerson({ sub: 'carol', name: 'Carol' }, db),
  ]);
  expect(a.userId).toBe(b.userId);
  const [{ n }] = (await sql`SELECT count(*)::int AS n FROM foosball.app_user WHERE hub_sub = 'carol'`) as unknown as [{ n: number }];
  expect(n).toBe(1);
});

test('a session is found by its token, never stored as one, and ends on delete', async () => {
  const { token } = await createSession(almaz, db);
  const [row] = await sql`SELECT encode(token_hash, 'hex') AS h FROM foosball.user_session`;
  expect(row!.h).not.toContain(Buffer.from(token, 'base64url').toString('hex'));
  expect(await validateSession(token, db)).toMatchObject({ userId: almaz, userName: 'Almaz', renewed: false, hubCheckDue: false });
  await deleteSession(token, db);
  expect(await validateSession(token, db)).toBeNull();
});

test('slides the expiry at most once a day', async () => {
  const { token } = await createSession(almaz, db);
  expect((await validateSession(token, db))!.renewed).toBe(false);
  await sql`UPDATE foosball.user_session SET expires_at = now() + interval '20 days'`;
  const renewed = (await validateSession(token, db))!;
  expect(renewed.renewed).toBe(true);
  expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  expect((await validateSession(token, db))!.renewed).toBe(false);
});

test('an expired session is gone', async () => {
  const { token } = await createSession(almaz, db);
  await sql`UPDATE foosball.user_session SET expires_at = now() - interval '1 second'`;
  expect(await validateSession(token, db)).toBeNull();
});

test('a day after the hub last approved them, the hub check is due', async () => {
  const { token } = await createSession(almaz, db);
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '23 hours'`;
  expect((await validateSession(token, db))!.hubCheckDue).toBe(false);
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '25 hours'`;
  expect((await validateSession(token, db))!.hubCheckDue).toBe(true);
});

test('ending an account’s sessions ends all of them, and only theirs', async () => {
  const bob = await userForHubPerson({ sub: 'bob', name: 'Bob' }, db);
  const a = await createSession(almaz, db);
  const b = await createSession(almaz, db);
  const c = await createSession(bob.userId, db);
  await deleteUserSessions(almaz, db);
  expect(await validateSession(a.token, db)).toBeNull();
  expect(await validateSession(b.token, db)).toBeNull();
  expect(await validateSession(c.token, db)).not.toBeNull();
});
