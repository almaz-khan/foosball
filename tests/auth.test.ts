import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  AuthError,
  authConfig,
  consumeChallenge,
  createEnrollment,
  createSession,
  deleteSession,
  enrollmentFor,
  listPasskeys,
  loginOptions,
  registerPasskey,
  registrationOptions,
  registrationSubject,
  renamePasskey,
  revokePasskey,
  validateSession,
  verifyLogin,
  type RegisterAuthority,
} from '../src/auth.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { createInvite, inviteFor } from '../src/lib/server/invites.ts';
import { createOrg, memberships, type Org } from '../src/lib/server/orgs.ts';
import { findUser } from '../src/lib/server/users.ts';
import { SoftAuthenticator } from './helpers/authenticator.ts';
import { freshDatabase } from './helpers/testdb.ts';

describe('authConfig', () => {
  test('defaults to localhost, which browsers accept over plain http', () => {
    expect(authConfig({})).toEqual({ origin: 'http://localhost:5180', rpID: 'localhost' });
  });

  test('takes the hostname of an https origin as the relying party id', () => {
    expect(authConfig({ FOOSBALL_ORIGIN: 'https://foosball.almaz.dev/' })).toEqual({
      origin: 'https://foosball.almaz.dev',
      rpID: 'foosball.almaz.dev',
    });
  });

  test('refuses IP addresses, where passkeys can never work, and plain http elsewhere than localhost', () => {
    expect(() => authConfig({ FOOSBALL_ORIGIN: 'http://127.0.0.1:5180' })).toThrow(/not an IP/);
    expect(() => authConfig({ FOOSBALL_ORIGIN: 'https://[::1]:5180' })).toThrow(/not an IP/);
    expect(() => authConfig({ FOOSBALL_ORIGIN: 'http://foosball.almaz.dev' })).toThrow(/https/);
  });
});

const config = authConfig({ FOOSBALL_ORIGIN: 'https://foosball.example.dev' });
let db: Db;
let office: Org;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE foosball.org, foosball.app_user, foosball.auth_challenge RESTART IDENTITY CASCADE`);
  office = await createOrg('Office', 'office', db);
});

const device = (quirk: 'none' | 'nordpass' = 'none') => new SoftAuthenticator(config.origin, quirk);

/** A full registration ceremony, the way the two endpoints run it. */
async function register(authenticator: SoftAuthenticator, authority: RegisterAuthority, name = 'Mac') {
  const subject = await registrationSubject(authority, db);
  const { challengeId, options } = await registrationOptions(subject, config, db);
  return registerPasskey({ challengeId, response: authenticator.register(options), name }, authority, config, db);
}

async function signIn(authenticator: SoftAuthenticator) {
  const { challengeId, options } = await loginOptions(config, db);
  return verifyLogin({ challengeId, response: authenticator.authenticate(options) }, config, db);
}

/** Someone who joined the office from an invite, with one passkey. */
async function join(name: string, authenticator = device(), invite: Parameters<typeof createInvite>[0] = { orgId: office.id, invitedName: name }) {
  const { token } = await createInvite(invite, db);
  return register(authenticator, { kind: 'invite', token, userName: name });
}

describe('invites create accounts', () => {
  test('an invite opened signed out creates the account, its passkey and its membership', async () => {
    const mac = device();
    const { userId } = await join('Ann', mac, {
      orgId: office.id,
      invitedName: 'Ann',
      role: 'admin',
      player: { firstName: 'Ann', lastName: 'Lee' },
    });
    expect((await findUser('Ann', db))!.id).toBe(userId);
    expect((await listPasskeys(userId, db)).map((p) => p.name)).toEqual(['Mac']);
    const [m] = await memberships(userId, db);
    expect(m).toMatchObject({ orgSlug: 'office', role: 'admin', playerName: 'Ann Lee' });

    expect(await signIn(mac)).toEqual({ credentialId: mac.credentialId, userId });
  });

  test('the invitee may choose another name than the one on the invite', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Benjamin' }, db);
    const { userId } = await register(device(), { kind: 'invite', token, userName: '  Ben  ' });
    expect((await findUser('Ben', db))!.id).toBe(userId);
  });

  test('an invite works exactly once, even with options already in hand', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Ann' }, db);
    const authority: RegisterAuthority = { kind: 'invite', token, userName: 'Ann' };
    const early = await registrationOptions(await registrationSubject({ ...authority, userName: 'Ann2' }, db), config, db);
    await register(device(), authority);

    expect(await inviteFor(token, db)).toBeNull();
    await expect(registrationSubject({ ...authority, userName: 'Ann2' }, db)).rejects.toThrow(AuthError);
    const replay = registerPasskey(
      { challengeId: early.challengeId, response: device().register(early.options), name: 'x' },
      { ...authority, userName: 'Ann2' },
      config,
      db,
    );
    await expect(replay).rejects.toThrow(/already used/);
    // Nothing half-made: the refused attempt left no account behind.
    expect(await findUser('Ann2', db)).toBeNull();
  });

  test('an expired or made-up invite is refused', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Ann', hours: 1 }, db);
    await db.execute(sql`UPDATE foosball.org_invite SET expires_at = now() - interval '1 minute'`);
    await expect(registrationSubject({ kind: 'invite', token, userName: 'Ann' }, db)).rejects.toThrow(/expired/);
    await expect(registrationSubject({ kind: 'invite', token: 'nope', userName: 'Ann' }, db)).rejects.toThrow(/expired/);
  });

  test('a name cannot be taken twice', async () => {
    await join('Ann');
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Ann' }, db);
    await expect(registrationSubject({ kind: 'invite', token, userName: 'Ann' }, db)).rejects.toThrow(/already called/);
    // Taken between the options and the passkey: still refused, and the invite stays unused.
    const subject = await registrationSubject({ kind: 'invite', token, userName: 'Bob' }, db);
    await join('Bob');
    const { challengeId, options } = await registrationOptions(subject, config, db);
    await expect(
      registerPasskey({ challengeId, response: device().register(options), name: 'x' }, { kind: 'invite', token, userName: 'Bob' }, config, db),
    ).rejects.toThrow(/already called/);
    expect(await inviteFor(token, db)).not.toBeNull();
  });

  test('an invite for a player already linked to someone is refused, and stays unused', async () => {
    await join('Ann', device(), { orgId: office.id, invitedName: 'Ann', player: { firstName: 'Ann' } });
    const [ann] = await memberships((await findUser('Ann', db))!.id, db);
    // The invite was valid when made; meanwhile someone else became that player.
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Imposter' }, db);
    await db.execute(sql`UPDATE foosball.org_invite SET player_id = ${ann!.playerId} WHERE used_at IS NULL`);
    await expect(register(device(), { kind: 'invite', token, userName: 'Imposter' })).rejects.toThrow(/already linked/);
    expect(await findUser('Imposter', db)).toBeNull();
    expect(await inviteFor(token, db)).not.toBeNull();
  });
});

describe('passkeys', () => {
  test('an enrollment link adds a passkey to an existing account, once', async () => {
    const { userId } = await join('Ann');
    const { token } = await createEnrollment(userId, db);
    expect((await enrollmentFor(token, db))!.name).toBe('Ann');

    const phone = device();
    expect((await register(phone, { kind: 'enrollment', token }, 'iPhone')).userId).toBe(userId);
    expect((await listPasskeys(userId, db)).map((p) => p.name)).toEqual(['Mac', 'iPhone']);
    expect((await signIn(phone)).userId).toBe(userId);

    expect(await enrollmentFor(token, db)).toBeNull();
    await expect(register(device(), { kind: 'enrollment', token })).rejects.toThrow(AuthError);
  });

  test('a signed-in session adds a device to its own account', async () => {
    const { userId } = await join('Ann');
    const { userId: again } = await register(device(), { kind: 'session', userId }, 'iPad');
    expect(again).toBe(userId);
    expect(await listPasskeys(userId, db)).toHaveLength(2);
  });

  test('a response made for another origin is rejected', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Ann' }, db);
    const authority: RegisterAuthority = { kind: 'invite', token, userName: 'Ann' };
    const { challengeId, options } = await registrationOptions(await registrationSubject(authority, db), config, db);
    const response = device().register(options, { origin: 'https://evil.example' });
    await expect(registerPasskey({ challengeId, response, name: 'x' }, authority, config, db)).rejects.toThrow(AuthError);
    expect(await findUser('Ann', db)).toBeNull();
  });

  test('a forged signature, a replayed challenge and an unknown passkey are refused', async () => {
    const mac = device();
    await join('Ann', mac);

    const { challengeId, options } = await loginOptions(config, db);
    const forged = mac.authenticate(options);
    forged.response.signature = device().authenticate(options).response.signature;
    await expect(verifyLogin({ challengeId, response: forged }, config, db)).rejects.toThrow(AuthError);

    const fresh = await loginOptions(config, db);
    const ok = mac.authenticate(fresh.options);
    await verifyLogin({ challengeId: fresh.challengeId, response: ok }, config, db);
    await expect(verifyLogin({ challengeId: fresh.challengeId, response: ok }, config, db)).rejects.toThrow(/expired/);

    await expect(signIn(device())).rejects.toThrow(/isn’t registered/);
  });

  test('a challenge is only good for its own ceremony', async () => {
    const { challengeId } = await loginOptions(config, db);
    expect(await consumeChallenge(challengeId, 'register', db)).toBeNull();
    expect(await consumeChallenge(challengeId, 'login', db)).not.toBeNull();
  });

  test('a password manager that mangles the user handle still signs in as its own account (NordPass)', async () => {
    const vault = device('nordpass');
    const { userId } = await join('Ann', vault);
    vault.userHandle = Buffer.from('somebody-else').toString('base64url');
    expect((await signIn(vault)).userId).toBe(userId);
  });

  test('people rename and remove only their own passkeys', async () => {
    const ann = await join('Ann');
    const bob = await join('Bob');
    expect(await renamePasskey(bob.credentialId, ann.userId, 'mine now', db)).toBe(false);
    expect(await revokePasskey(bob.credentialId, ann.userId, db)).toBe(false);
    expect(await renamePasskey(ann.credentialId, ann.userId, '  Work Mac ', db)).toBe(true);
    expect((await listPasskeys(ann.userId, db))[0]!.name).toBe('Work Mac');
    expect(await revokePasskey(ann.credentialId, ann.userId, db)).toBe(true);
    expect(await listPasskeys(null, db)).toHaveLength(1);
  });
});

describe('sessions', () => {
  test('a session validates as its account until deleted; only its hash is stored', async () => {
    const { credentialId, userId } = await join('Ann');
    const { token } = await createSession(credentialId, db);
    expect(await validateSession(token, db)).toMatchObject({ userId, userName: 'Ann', renewed: false });
    const stored = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM foosball.auth_session WHERE token_hash = convert_to(${token}, 'UTF8')`,
    );
    expect(stored[0]!.n).toBe(0);
    await deleteSession(token, db);
    expect(await validateSession(token, db)).toBeNull();
  });

  test('an expired session is refused; one in use slides forward at most once a day', async () => {
    const { credentialId } = await join('Ann');
    const { token } = await createSession(credentialId, db);
    await db.execute(sql`UPDATE foosball.auth_session SET expires_at = now() + interval '20 days'`);
    const renewed = await validateSession(token, db);
    expect(renewed!.renewed).toBe(true);
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await validateSession(token, db))!.renewed).toBe(false);

    await db.execute(sql`UPDATE foosball.auth_session SET expires_at = now() - interval '1 second'`);
    expect(await validateSession(token, db)).toBeNull();
  });

  test('revoking a passkey signs out every session it opened', async () => {
    const { credentialId, userId } = await join('Ann');
    const a = await createSession(credentialId, db);
    const b = await createSession(credentialId, db);
    await revokePasskey(credentialId, userId, db);
    expect(await validateSession(a.token, db)).toBeNull();
    expect(await validateSession(b.token, db)).toBeNull();
  });
});
