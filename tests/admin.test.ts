import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { inviteFor, pendingInvites } from '../src/lib/server/invites.ts';
import { listMembers } from '../src/lib/server/members.ts';
import { createOrg, memberships, type Membership, type Org } from '../src/lib/server/orgs.ts';
import { createPlayer, type Player } from '../src/lib/server/players.ts';
import { getUser } from '../src/lib/server/users.ts';
import * as account from '../src/routes/account/+page.server.ts';
import * as admin from '../src/routes/admin/+page.server.ts';
import { event, outcome } from './helpers/route.ts';
import { freshDatabase } from './helpers/testdb.ts';

let db: Db;
let office: Org;
let pub: Org;
let annP: Player, benP: Player, catP: Player;
/** Ann: office admin. Ben: office member. Zed: office member, and admin of the pub. */
const who: Record<'ann' | 'ben' | 'zed', { id: number; member: Membership }> = {} as never;

beforeAll(async () => {
  db = await freshDatabase();
  process.env.FOOSBALL_ORIGIN = 'https://foosball.example.dev';
});
afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE foosball.org, foosball.app_user RESTART IDENTITY CASCADE`);
  office = await createOrg('Office', 'office', db);
  pub = await createOrg('Pub', 'pub', db);
  [annP, benP, catP] = (await Promise.all(['Ann', 'Ben', 'Cat'].map((firstName) => createPlayer(office.id, { firstName }, db)))) as [Player, Player, Player];
  const users = await db.insert(appUser).values([{ name: 'Ann' }, { name: 'Ben' }, { name: 'Zed' }]).returning({ id: appUser.id });
  const [ann, ben, zed] = users.map((u) => u.id) as [number, number, number];
  await db.insert(orgMember).values([
    { orgId: office.id, userId: ann, role: 'admin', playerId: annP.id },
    { orgId: office.id, userId: ben, role: 'member', playerId: benP.id },
    { orgId: office.id, userId: zed, role: 'member' },
    { orgId: pub.id, userId: zed, role: 'admin' },
  ]);
  for (const [name, id] of [['ann', ann], ['ben', ben], ['zed', zed]] as const) {
    who[name] = { id, member: (await memberships(id, db))[0]! };
  }
});

const as = (name: 'ann' | 'ben' | 'zed', options: { form?: Record<string, string> } = {}) =>
  event({ userId: who[name].id, member: who[name].member, form: options.form });

describe('account', () => {
  test('renaming yourself: free names only', async () => {
    expect(await outcome(() => account.actions.rename!(as('ben', { form: { name: 'Ann' } })))).toMatchObject({ kind: 'fail' });
    expect(await outcome(() => account.actions.rename!(as('ben', { form: { name: ' Benjamin ' } })))).toMatchObject({ kind: 'ok' });
    expect((await getUser(who.ben.id, db))!.name).toBe('Benjamin');
  });

  test('switching org: only to one you are in', async () => {
    const e = as('zed', { form: { org: 'pub' } }) as { locals: { memberships: Membership[] } };
    e.locals.memberships = await memberships(who.zed.id, db);
    expect(await outcome(() => account.actions.switchOrg!(e as never))).toMatchObject({ kind: 'redirect', location: '/' });
    expect(await outcome(() => account.actions.switchOrg!(as('ben', { form: { org: 'pub' } })))).toMatchObject({ kind: 'fail', status: 404 });
  });
});

describe('admin', () => {
  test('is for admins only', async () => {
    expect(await outcome(() => admin.load(as('ben')))).toMatchObject({ kind: 'error', status: 403 });
    expect(await outcome(() => admin.actions.invite!(as('ben', { form: { name: 'x' } })))).toMatchObject({ kind: 'error', status: 403 });
    expect(await outcome(() => admin.load(as('ann')))).toMatchObject({ kind: 'ok' });
  });

  test('invites: a new player, an existing one, or nobody', async () => {
    const invite = async (form: Record<string, string>) => {
      const r = await outcome(() => admin.actions.invite!(as('ann', { form })));
      if (r.kind !== 'ok') return r;
      const link = (r.value as { invite: { link: string } }).invite.link;
      return inviteFor(link.split('/invite/')[1]!, db);
    };
    expect(await invite({ name: 'Dee Dee', role: 'member', player_mode: 'new', first_name: 'Dee', last_name: 'Dee' })).toMatchObject({ playerName: 'Dee Dee', role: 'member' });
    expect(await invite({ name: 'Cat', role: 'admin', player_mode: 'existing', player_id: String(catP.id) })).toMatchObject({ playerName: 'Cat', role: 'admin' });
    expect(await invite({ name: 'Vic', role: 'member', player_mode: 'none' })).toMatchObject({ playerName: null });
    // Ben is already linked to his player.
    expect(await invite({ name: 'Not Ben', player_mode: 'existing', player_id: String(benP.id) })).toMatchObject({ kind: 'fail', data: { message: expect.stringMatching(/already linked/) } });
    expect(await pendingInvites(office.id, db)).toHaveLength(3);
  });

  test('roles: the last admin stays; an admin who steps down leaves the page', async () => {
    const setRole = (userId: number, role: string) =>
      outcome(() => admin.actions.setRole!(as('ann', { form: { user_id: String(userId), role } })));
    expect(await setRole(who.ann.id, 'member')).toMatchObject({ kind: 'fail', data: { message: expect.stringMatching(/at least one admin/) } });
    expect(await setRole(who.ben.id, 'admin')).toMatchObject({ kind: 'ok' });
    expect(await setRole(who.ann.id, 'member')).toMatchObject({ kind: 'redirect', location: '/' });
    // Someone in another org only: not found here.
    const [stranger] = await db.insert(appUser).values({ name: 'Stranger' }).returning({ id: appUser.id });
    expect(await setRole(stranger!.id, 'admin')).toMatchObject({ kind: 'fail', status: 404 });
  });

  test('linking players: one each, and unlinking makes a watcher', async () => {
    const link = (userId: number, playerId: string) =>
      outcome(() => admin.actions.linkPlayer!(as('ann', { form: { user_id: String(userId), player_id: playerId } })));
    expect(await link(who.zed.id, String(annP.id))).toMatchObject({ kind: 'fail', data: { message: expect.stringMatching(/already linked/) } });
    expect(await link(who.zed.id, String(catP.id))).toMatchObject({ kind: 'ok' });
    expect(await link(who.ben.id, '')).toMatchObject({ kind: 'ok' });
    const byName = Object.fromEntries((await listMembers(office.id, db)).map((m) => [m.userName, m.playerName]));
    expect(byName).toEqual({ Ann: 'Ann', Ben: null, Zed: 'Cat' });
  });

  test('removing a member; the last admin cannot leave', async () => {
    const remove = (userId: number) => outcome(() => admin.actions.removeMember!(as('ann', { form: { user_id: String(userId) } })));
    expect(await remove(who.ann.id)).toMatchObject({ kind: 'fail' });
    expect(await remove(who.ben.id)).toMatchObject({ kind: 'ok' });
    expect((await listMembers(office.id, db)).map((m) => m.userName)).toEqual(['Ann', 'Zed']);
  });
});
