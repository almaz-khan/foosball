import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { createGame, getGame, type GameInput } from '../src/lib/server/games.ts';
import { createOrg, memberships, type Membership, type Org } from '../src/lib/server/orgs.ts';
import { createPlayer, getPlayer, type Player } from '../src/lib/server/players.ts';
import * as gamePage from '../src/routes/games/[id]/+page.server.ts';
import * as gamesPage from '../src/routes/games/+page.server.ts';
import * as playerPage from '../src/routes/players/[id]/+page.server.ts';
import * as playersPage from '../src/routes/players/+page.server.ts';
import { event, outcome } from './helpers/route.ts';
import { freshDatabase } from './helpers/testdb.ts';

let db: Db;
let office: Org;
let other: Org;
let p: Player[];
/** Ann: admin. Ben: member who plays. Vic: member who only watches. */
const who: Record<'ann' | 'ben' | 'vic', { id: number; member: Membership }> = {} as never;

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
  p = await Promise.all(['Ann', 'Ben', 'Cat', 'Dan', 'Eve'].map((firstName) => createPlayer(office.id, { firstName }, db)));
  const users = await db.insert(appUser).values([{ name: 'ann' }, { name: 'ben' }, { name: 'vic' }]).returning({ id: appUser.id });
  await db.insert(orgMember).values([
    { orgId: office.id, userId: users[0]!.id, role: 'admin', playerId: p[0]!.id },
    { orgId: office.id, userId: users[1]!.id, role: 'member', playerId: p[1]!.id },
    { orgId: office.id, userId: users[2]!.id, role: 'member', playerId: null },
  ]);
  for (const [i, name] of (['ann', 'ben', 'vic'] as const).entries()) {
    const id = users[i]!.id;
    who[name] = { id, member: (await memberships(id, db))[0]! };
  }
});

const input = (over: Partial<GameInput> = {}): GameInput => ({
  startedAt: new Date('2026-10-01T08:00:00Z'),
  endedAt: new Date('2026-10-01T08:08:00Z'),
  red: { score: 10, offense: p[0]!.id, defense: p[1]!.id },
  blue: { score: 7, offense: p[2]!.id, defense: p[3]!.id },
  ...over,
});

const editForm = {
  red_offense: '', red_defense: '', blue_offense: '', blue_defense: '',
  red_score: '5', blue_score: '10', started_at: '2026-10-01T10:00', ended_at: '2026-10-01T10:12',
};
const seatsOf = () => ({
  red_offense: String(p[0]!.id), red_defense: String(p[1]!.id),
  blue_offense: String(p[2]!.id), blue_defense: String(p[4]!.id),
});

describe('a saved game', () => {
  test('its recorder may edit it; another member may not; an admin may', async () => {
    const id = await createGame(office.id, input(), who.ben.id, db);
    const save = (as: 'ann' | 'ben' | 'vic') =>
      outcome(() =>
        gamePage.actions.save!(event({ userId: who[as].id, member: who[as].member, params: { id: String(id) }, form: { ...editForm, ...seatsOf() } })),
      );

    expect(await save('vic')).toMatchObject({ kind: 'error', status: 403 });
    expect(await save('ben')).toMatchObject({ kind: 'ok' });
    const edited = await getGame(office.id, id, db);
    expect(edited).toMatchObject({ red: { score: 5 }, blue: { score: 10, defense: { name: 'Eve' } } });
    // Entered in Prague time, stored as the instant.
    expect(edited!.startedAt!.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect(await save('ann')).toMatchObject({ kind: 'ok' });
  });

  test('an invalid edit is refused with a reason, and changes nothing', async () => {
    const id = await createGame(office.id, input(), who.ann.id, db);
    const twice = { ...editForm, ...seatsOf(), blue_defense: String(p[0]!.id) };
    const result = await outcome(() =>
      gamePage.actions.save!(event({ userId: who.ann.id, member: who.ann.member, params: { id: String(id) }, form: twice })),
    );
    expect(result).toMatchObject({ kind: 'fail', status: 400, data: { message: expect.stringMatching(/different person/) } });
    expect((await getGame(office.id, id, db))!.red.score).toBe(10);
  });

  test('deleting: refused to other members, done for the recorder', async () => {
    const id = await createGame(office.id, input(), who.ben.id, db);
    const del = (as: 'ann' | 'ben' | 'vic') =>
      outcome(() => gamePage.actions.delete!(event({ userId: who[as].id, member: who[as].member, params: { id: String(id) } })));
    expect(await del('vic')).toMatchObject({ kind: 'error', status: 403 });
    expect(await del('ben')).toMatchObject({ kind: 'redirect', location: '/games' });
    expect(await getGame(office.id, id, db)).toBeNull();
  });

  test('another org’s game is not found, even by id', async () => {
    const elsewhere = await createPlayer(other.id, { firstName: 'Zed' }, db);
    const [a, b, c] = await Promise.all(['Y', 'X', 'W'].map((firstName) => createPlayer(other.id, { firstName }, db)));
    const id = await createGame(other.id, input({ red: { score: 1, offense: elsewhere.id, defense: a!.id }, blue: { score: 2, offense: b!.id, defense: c!.id } }), null, db);
    const load = await outcome(() => gamePage.load(event({ userId: who.ann.id, member: who.ann.member, params: { id: String(id) } })));
    expect(load).toMatchObject({ kind: 'error', status: 404 });
  });

  test('the page offers editing only to those who may', async () => {
    const id = await createGame(office.id, input(), who.ben.id, db);
    const load = async (as: 'ann' | 'ben' | 'vic') =>
      (await gamePage.load(event({ userId: who[as].id, member: who[as].member, params: { id: String(id) } }))) as { canEdit: boolean; times: { startedAt: string } };
    expect((await load('vic')).canEdit).toBe(false);
    expect((await load('ben')).canEdit).toBe(true);
    expect((await load('ann')).times.startedAt).toBe('2026-10-01T10:00');
  });
});

describe('the games list', () => {
  test('filters by player and by days in the org’s zone', async () => {
    // 23:30 UTC on 1 Oct is already 2 Oct in Prague.
    await createGame(office.id, input({ startedAt: null, endedAt: new Date('2026-10-01T23:30:00Z') }), null, db);
    await createGame(office.id, input({ startedAt: null, endedAt: new Date('2026-10-01T12:00:00Z'), red: { score: 1, offense: p[4]!.id, defense: p[1]!.id } }), null, db);
    const list = async (url: string) =>
      ((await gamesPage.load(event({ userId: who.vic.id, member: who.vic.member, url }))) as { games: { id: number }[] }).games.length;
    expect(await list('/games')).toBe(2);
    expect(await list('/games?from=2026-10-02&to=2026-10-02')).toBe(1);
    expect(await list('/games?to=2026-10-01')).toBe(1);
    expect(await list(`/games?player=${p[4]!.id}`)).toBe(1);
  });

  test('someone in no org is told so', async () => {
    expect(await outcome(() => gamesPage.load(event({ userId: who.ann.id, member: null })))).toMatchObject({ kind: 'error', status: 403 });
  });
});

describe('the roster', () => {
  test('only admins add players', async () => {
    const add = (as: 'ann' | 'ben', form: Record<string, string>) =>
      outcome(() => playersPage.actions.add!(event({ userId: who[as].id, member: who[as].member, form })));
    expect(await add('ben', { first_name: 'Fay' })).toMatchObject({ kind: 'error', status: 403 });
    expect(await add('ann', { first_name: '  ' })).toMatchObject({ kind: 'fail', status: 400 });
    const added = await add('ann', { first_name: 'Fay', last_name: 'Wu' });
    expect(added).toMatchObject({ kind: 'redirect', location: expect.stringMatching(/^\/players\/\d+$/) });
  });

  test('removing archives someone who played and deletes someone who never did', async () => {
    await createGame(office.id, input(), null, db);
    const remove = (id: number) =>
      outcome(() => playerPage.actions.remove!(event({ userId: who.ann.id, member: who.ann.member, params: { id: String(id) } })));
    expect(await remove(p[2]!.id)).toMatchObject({ kind: 'redirect', location: `/players/${p[2]!.id}` });
    expect((await getPlayer(office.id, p[2]!.id, db))!.archived).toBe(true);
    expect(await remove(p[4]!.id)).toMatchObject({ kind: 'redirect', location: '/players' });
    expect(await getPlayer(office.id, p[4]!.id, db)).toBeNull();
    const asMember = await outcome(() =>
      playerPage.actions.remove!(event({ userId: who.ben.id, member: who.ben.member, params: { id: String(p[3]!.id) } })),
    );
    expect(asMember).toMatchObject({ kind: 'error', status: 403 });
  });
});
