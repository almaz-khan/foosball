import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, gamePlayer, orgMember } from '../src/lib/server/db/schema.ts';
import { createGame, deleteGame, GameError, getGame, listGames, updateGame, type GameInput } from '../src/lib/server/games.ts';
import { canEditGame, canRecord, createOrg, memberships, type Org } from '../src/lib/server/orgs.ts';
import { createPlayer, listPlayers, removePlayer, restorePlayer, type Player } from '../src/lib/server/players.ts';
import { seedDemo } from '../src/cli.ts';
import { freshDatabase } from './helpers/testdb.ts';

let db: Db;
let office: Org;
let other: Org;
let p: Player[];
let stranger: Player;

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
  stranger = await createPlayer(other.id, { firstName: 'Zed' }, db);
});

const at = (iso: string) => new Date(iso);

/** The constraint a statement broke, from the Postgres error drizzle wraps; null if it succeeded. */
async function violated(query: PromiseLike<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (err) {
    return (err as { cause?: { constraint_name?: string } }).cause?.constraint_name ?? String(err);
  }
}
const input = (over: Partial<GameInput> = {}): GameInput => ({
  startedAt: at('2026-10-01T10:00:00Z'),
  endedAt: at('2026-10-01T10:08:00Z'),
  red: { score: 10, offense: p[0]!.id, defense: p[1]!.id },
  blue: { score: 7, offense: p[2]!.id, defense: p[3]!.id },
  ...over,
});

describe('games', () => {
  test('a game is stored and read back in the red/blue shape, players filled in', async () => {
    const id = await createGame(office.id, input(), null, db);
    const g = await getGame(office.id, id, db);
    expect(g).not.toBeNull();
    expect(g!.red).toEqual({ score: 10, offense: { id: p[0]!.id, name: 'Ann' }, defense: { id: p[1]!.id, name: 'Ben' } });
    expect(g!.blue.offense.name).toBe('Cat');
    expect(g!.source).toBe('web');
    expect(g!.playedAt).toEqual(at('2026-10-01T10:08:00Z'));
  });

  test('refuses the same person twice, bad scores and an end before the start', async () => {
    const twice = input({ blue: { score: 1, offense: p[0]!.id, defense: p[3]!.id } });
    await expect(createGame(office.id, twice, null, db)).rejects.toThrow(GameError);
    await expect(createGame(office.id, input({ red: { score: -1, offense: p[0]!.id, defense: p[1]!.id } }), null, db)).rejects.toThrow(GameError);
    await expect(createGame(office.id, input({ red: { score: 2.5, offense: p[0]!.id, defense: p[1]!.id } }), null, db)).rejects.toThrow(GameError);
    await expect(createGame(office.id, input({ endedAt: at('2026-10-01T09:00:00Z') }), null, db)).rejects.toThrow(GameError);
  });

  test('another org’s player cannot be seated, even past the app’s own check', async () => {
    const mixed = input({ blue: { score: 1, offense: stranger.id, defense: p[3]!.id } });
    await expect(createGame(office.id, mixed, null, db)).rejects.toThrow('roster');
    // The database refuses it too: the seat's foreign key carries the org.
    const id = await createGame(office.id, input(), null, db);
    await db.execute(sql`DELETE FROM foosball.game_player WHERE game_id = ${id} AND team = 'red' AND position = 'offense'`);
    expect(await violated(db.insert(gamePlayer).values({ orgId: office.id, gameId: id, playerId: stranger.id, team: 'red', position: 'offense' }))).toBe('game_player_player_fk');
  });

  test('games are only visible, editable and deletable within their org', async () => {
    const id = await createGame(office.id, input(), null, db);
    expect(await getGame(other.id, id, db)).toBeNull();
    expect(await updateGame(other.id, id, input(), db)).toBe(false);
    expect(await deleteGame(other.id, id, db)).toBe(false);
    expect((await listGames(other.id, {}, db)).games).toHaveLength(0);
  });

  test('an update replaces scores and seats', async () => {
    const id = await createGame(office.id, input(), null, db);
    await updateGame(office.id, id, input({ red: { score: 5, offense: p[4]!.id, defense: p[1]!.id } }), db);
    const g = await getGame(office.id, id, db);
    expect(g!.red.score).toBe(5);
    expect(g!.red.offense.name).toBe('Eve');
  });

  test('list: newest first, filtered by player and dates, paged with a cursor', async () => {
    for (let day = 1; day <= 5; day++) {
      const start = at(`2026-10-0${day}T12:00:00Z`);
      const seats = day % 2 ? input() : input({ red: { score: 1, offense: p[4]!.id, defense: p[1]!.id } });
      await createGame(office.id, { ...seats, startedAt: start, endedAt: null }, null, db);
    }
    const all = await listGames(office.id, {}, db);
    expect(all.games.map((g) => g.startedAt!.getUTCDate())).toEqual([5, 4, 3, 2, 1]);

    const eve = await listGames(office.id, { playerId: p[4]!.id }, db);
    expect(eve.games.map((g) => g.startedAt!.getUTCDate())).toEqual([4, 2]);

    const window = await listGames(office.id, { from: at('2026-10-02T00:00:00Z'), to: at('2026-10-04T00:00:00Z') }, db);
    expect(window.games.map((g) => g.startedAt!.getUTCDate())).toEqual([3, 2]);

    const first = await listGames(office.id, { limit: 2 }, db);
    const second = await listGames(office.id, { limit: 2, cursor: first.next }, db);
    const third = await listGames(office.id, { limit: 2, cursor: second.next }, db);
    expect([...first.games, ...second.games, ...third.games].map((g) => g.startedAt!.getUTCDate())).toEqual([5, 4, 3, 2, 1]);
    expect(third.next).toBeNull();
  });

  test('games saved in the same millisecond page without loss or repeats', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await createGame(office.id, { ...input(), startedAt: null, endedAt: null }, null, db));
    await db.execute(sql`UPDATE foosball.game SET created_at = '2026-10-01T10:00:00Z'`);
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listGames>> = await listGames(office.id, { limit: 2, cursor }, db);
      seen.push(...page.games.map((g) => g.id));
      cursor = page.next;
    } while (cursor);
    expect(seen).toEqual(ids.reverse());
  });
});

describe('players', () => {
  test('someone with games is archived; someone without is deleted', async () => {
    await createGame(office.id, input(), null, db);
    expect(await removePlayer(office.id, p[0]!.id, db)).toBe('archived');
    expect(await removePlayer(office.id, p[4]!.id, db)).toBe('deleted');
    expect((await listPlayers(office.id, {}, db)).map((x) => x.name)).toEqual(['Ben', 'Cat', 'Dan']);
    expect((await listPlayers(office.id, { includeArchived: true }, db)).map((x) => x.name)).toEqual(['Ann', 'Ben', 'Cat', 'Dan']);
    await restorePlayer(office.id, p[0]!.id, db);
    expect((await listPlayers(office.id, {}, db)).map((x) => x.name)).toContain('Ann');
  });

  test('deleting a linked player unlinks the member, who then can only watch', async () => {
    const [user] = await db.insert(appUser).values({ name: 'eve' }).returning({ id: appUser.id });
    await db.insert(orgMember).values({ orgId: office.id, userId: user!.id, playerId: p[4]!.id });
    expect(canRecord((await memberships(user!.id, db))[0]!)).toBe(true);

    expect(await removePlayer(office.id, p[4]!.id, db)).toBe('deleted');
    const [m] = await memberships(user!.id, db);
    expect(m!.playerId).toBeNull();
    expect(canRecord(m!)).toBe(false);
  });

  test('a member cannot be linked to another org’s player', async () => {
    const [user] = await db.insert(appUser).values({ name: 'zed' }).returning({ id: appUser.id });
    expect(await violated(db.insert(orgMember).values({ orgId: office.id, userId: user!.id, playerId: stranger.id }))).toBe('org_member_player_fk');
  });
});

describe('permissions', () => {
  test('recorders and admins may edit a game; other members may not', async () => {
    const member = { orgId: 1, orgName: 'Office', orgSlug: 'office', role: 'member' as const, playerId: 1, playerName: 'Ann' };
    expect(canEditGame(member, 7, 7)).toBe(true);
    expect(canEditGame(member, 7, 8)).toBe(false);
    expect(canEditGame(member, 7, null)).toBe(false);
    expect(canEditGame({ ...member, role: 'admin' }, 7, 8)).toBe(true);
    expect(canEditGame(null, 7, 7)).toBe(false);
  });
});

describe('seed', () => {
  test('creates the demo org once', async () => {
    expect(await seedDemo(db)).toBe('created');
    expect(await seedDemo(db)).toBe('exists');
    const demo = (await db.execute<{ id: number }>(sql`SELECT id FROM foosball.org WHERE slug = 'demo'`))[0]!;
    expect((await listGames(demo.id, {}, db)).games).toHaveLength(2);
  });
});
