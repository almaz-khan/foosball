import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { currentMembership, requireAdmin, requireMember, requireRecorder } from '../src/lib/server/auth.ts';
import { acceptInvite, createInvite, inviteFor, pendingInvites, revokeInvite } from '../src/lib/server/invites.ts';
import { linkPlayer, listMembers, removeMember, setRole } from '../src/lib/server/members.ts';
import { createOrg, memberships, type Membership, type Org } from '../src/lib/server/orgs.ts';
import { createPlayer, removePlayer, type Player } from '../src/lib/server/players.ts';
import { createLimiter } from '../src/lib/server/rate-limit.ts';
import { actions } from '../src/routes/invite/[token]/+page.server.ts';
import { freshDatabase } from './helpers/testdb.ts';

let db: Db;
let office: Org;
let other: Org;
let ann: number;
let bob: number;
let annPlayer: Player;
let bobPlayer: Player;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE foosball.org, foosball.app_user RESTART IDENTITY CASCADE`);
  office = await createOrg('Office', 'office', db);
  other = await createOrg('Other', 'other', db);
  [ann, bob] = (await db.insert(appUser).values([{ name: 'Ann' }, { name: 'Bob' }]).returning({ id: appUser.id })).map((u) => u.id) as [number, number];
  annPlayer = await createPlayer(office.id, { firstName: 'Ann' }, db);
  bobPlayer = await createPlayer(office.id, { firstName: 'Bob' }, db);
  await db.insert(orgMember).values({ orgId: office.id, userId: ann, role: 'admin', playerId: annPlayer.id });
});

describe('invites for someone with an account', () => {
  test('joins the org with the existing account and the invite’s player', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Bob', player: { playerId: bobPlayer.id } }, db);
    expect(await inviteFor(token, db)).toMatchObject({ orgName: 'Office', role: 'member', playerName: 'Bob' });
    await acceptInvite(token, bob, db);
    expect(await memberships(bob, db)).toMatchObject([{ orgSlug: 'office', role: 'member', playerId: bobPlayer.id }]);
    expect(await inviteFor(token, db)).toBeNull();
  });

  test('a member cannot join twice, and the refused invite stays usable', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Ann again' }, db);
    await expect(acceptInvite(token, ann, db)).rejects.toThrow(/already a member/);
    expect(await inviteFor(token, db)).not.toBeNull();
  });

  test('an invite can only name an active, unlinked player of its own org', async () => {
    const stranger = await createPlayer(other.id, { firstName: 'Zed' }, db);
    await expect(createInvite({ orgId: office.id, invitedName: 'x', player: { playerId: stranger.id } }, db)).rejects.toThrow(/roster/);
    await expect(createInvite({ orgId: office.id, invitedName: 'x', player: { playerId: annPlayer.id } }, db)).rejects.toThrow(/already linked/);
    await removePlayer(office.id, bobPlayer.id, db);
    await expect(createInvite({ orgId: office.id, invitedName: 'x', player: { playerId: bobPlayer.id } }, db)).rejects.toThrow(/roster/);
  });

  test('pending invites are listed per org and can be revoked', async () => {
    await createInvite({ orgId: office.id, invitedName: 'Cat', player: { firstName: 'Cat', lastName: 'Sun' } }, db);
    await createInvite({ orgId: other.id, invitedName: 'Elsewhere' }, db);
    const [cat] = await pendingInvites(office.id, db);
    expect(cat).toMatchObject({ invitedName: 'Cat', playerName: 'Cat Sun', role: 'member' });
    expect(await revokeInvite(other.id, cat!.id, db)).toBe(false);
    expect(await revokeInvite(office.id, cat!.id, db)).toBe(true);
    expect(await pendingInvites(office.id, db)).toHaveLength(0);
  });

  test('the join action adds the signed-in person and opens that org', async () => {
    const { token } = await createInvite({ orgId: office.id, invitedName: 'Bob' }, db);
    const set: Record<string, string> = {};
    const event = {
      params: { token },
      locals: { session: { userId: bob, userName: 'Bob' }, memberships: [], member: null },
      cookies: { set: (name: string, value: string) => (set[name] = value) },
    } as never;
    try {
      await actions.join!(event);
      throw new Error('expected a redirect');
    } catch (err) {
      expect(isRedirect(err) && err.location).toBe('/');
    }
    expect(set.foosball_org).toBe('office');
    expect((await memberships(bob, db))[0]!.role).toBe('member');
  });
});

describe('members', () => {
  test('an org always keeps an admin', async () => {
    await expect(setRole(office.id, ann, 'member', db)).rejects.toThrow(/at least one admin/);
    await expect(removeMember(office.id, ann, db)).rejects.toThrow(/at least one admin/);

    await db.insert(orgMember).values({ orgId: office.id, userId: bob });
    expect(await setRole(office.id, bob, 'admin', db)).toBe(true);
    expect(await setRole(office.id, ann, 'member', db)).toBe(true);
    expect(await removeMember(office.id, ann, db)).toBe(true);
    expect((await listMembers(office.id, db)).map((m) => [m.userName, m.role])).toEqual([['Bob', 'admin']]);
  });

  test('two admins demoting each other at once cannot leave the org without one', async () => {
    await db.insert(orgMember).values({ orgId: office.id, userId: bob, role: 'admin' });
    const results = await Promise.allSettled([setRole(office.id, ann, 'member', db), setRole(office.id, bob, 'member', db)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await listMembers(office.id, db)).filter((m) => m.role === 'admin')).toHaveLength(1);
  });

  test('linking: one member per player, only active players of the same org', async () => {
    await db.insert(orgMember).values({ orgId: office.id, userId: bob });
    await expect(linkPlayer(office.id, bob, annPlayer.id, db)).rejects.toThrow(/already linked/);
    const stranger = await createPlayer(other.id, { firstName: 'Zed' }, db);
    await expect(linkPlayer(office.id, bob, stranger.id, db)).rejects.toThrow(/roster/);
    expect(await linkPlayer(office.id, bob, bobPlayer.id, db)).toBe(true);
    expect(await linkPlayer(office.id, bob, null, db)).toBe(true);
    expect(await linkPlayer(other.id, bob, null, db)).toBe(false);
  });
});

describe('what a request may do', () => {
  const member = (over: Partial<Membership> = {}): Membership => ({
    orgId: 1, orgName: 'Office', orgSlug: 'office', role: 'member', playerId: 3, playerName: 'Ann', ...over,
  });
  const locals = (m: Membership | null) =>
    ({ session: { userId: 1, userName: 'Ann' }, memberships: m ? [m] : [], member: m }) as unknown as App.Locals;
  const status = (run: () => unknown) => {
    try {
      run();
      return 200;
    } catch (err) {
      if (isHttpError(err)) return err.status;
      throw err;
    }
  };

  test('watchers look, players record, admins manage', () => {
    expect(status(() => requireMember(locals(null)))).toBe(403);
    expect(status(() => requireMember(locals(member({ playerId: null }))))).toBe(200);
    expect(status(() => requireRecorder(locals(member({ playerId: null }))))).toBe(403);
    expect(status(() => requireRecorder(locals(member())))).toBe(200);
    expect(status(() => requireAdmin(locals(member())))).toBe(403);
    expect(status(() => requireAdmin(locals(member({ role: 'admin', playerId: null }))))).toBe(200);
  });

  test('the org cookie picks among memberships, else the oldest', () => {
    const a = member();
    const b = member({ orgId: 2, orgSlug: 'pub' });
    expect(currentMembership([a, b], 'pub')).toBe(b);
    expect(currentMembership([a, b], 'gone')).toBe(a);
    expect(currentMembership([], 'pub')).toBeNull();
  });
});

describe('rate limit', () => {
  test('caps each client per window, and everyone together', () => {
    let t = 0;
    const limit = createLimiter({ perClient: 2, global: 3, windowMs: 1000 }, () => t);
    expect([limit('a').ok, limit('a').ok, limit('a').ok]).toEqual([true, true, false]);
    expect(limit('b').ok).toBe(true);
    expect(limit('c').ok).toBe(false); // global: a, a, b already
    t = 1000;
    expect(limit('a').ok).toBe(true);
  });
});
