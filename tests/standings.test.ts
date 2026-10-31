import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { periodStart } from '../src/lib/dates.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { createGame } from '../src/lib/server/games.ts';
import { createOrg, memberships, type Org } from '../src/lib/server/orgs.ts';
import { createPlayer, type Player } from '../src/lib/server/players.ts';
import { standings } from '../src/lib/server/standings.ts';
import * as dashboard from '../src/routes/+page.server.ts';
import { event } from './helpers/route.ts';
import { freshDatabase } from './helpers/testdb.ts';

let db: Db;
let office: Org;
let ann: Player, ben: Player, cat: Player, dan: Player, eve: Player;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.$client.end({ timeout: 5 });
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE foosball.org, foosball.app_user RESTART IDENTITY CASCADE`);
  office = await createOrg('Office', 'office', db);
  [ann, ben, cat, dan, eve] = await Promise.all(['Ann', 'Ben', 'Cat', 'Dan', 'Eve'].map((firstName) => createPlayer(office.id, { firstName }, db))) as Player[] as [Player, Player, Player, Player, Player];
});

/** red = [offense, defense], blue = [offense, defense]. */
const play = (red: [Player, Player, number], blue: [Player, Player, number], endedAt = new Date('2026-10-15T12:00:00Z')) =>
  createGame(
    office.id,
    { endedAt, red: { offense: red[0].id, defense: red[1].id, score: red[2] }, blue: { offense: blue[0].id, defense: blue[1].id, score: blue[2] } },
    null,
    db,
  );

describe('standings', () => {
  test('wins, losses, draws and goals, scored from each player’s side', async () => {
    await play([ann, ben, 10], [cat, dan, 5]);
    await play([cat, dan, 10], [ann, ben, 8]);
    await play([ann, ben, 10], [cat, dan, 10]);
    const table = await standings(office.id, {}, db);
    const of = (p: Player) => table.find((s) => s.playerId === p.id)!;
    expect(of(ann)).toMatchObject({ played: 3, won: 1, lost: 1, drawn: 1, goalsFor: 28, goalsAgainst: 25 });
    expect(of(cat)).toMatchObject({ played: 3, won: 1, lost: 1, drawn: 1, goalsFor: 25, goalsAgainst: 28 });
    expect(of(ann).winRate).toBeCloseTo(1 / 3);
    // Ann always played offense; Ben always defense, beside her.
    expect(of(ann).asOffense).toEqual({ played: 3, won: 1 });
    expect(of(ann).asDefense).toEqual({ played: 0, won: 0 });
    expect(of(ben).asDefense).toEqual({ played: 3, won: 1 });
  });

  test('ranked by win rate, then goal difference; fewer than 3 games listed last', async () => {
    await play([ann, ben, 10], [cat, dan, 0]);
    await play([ann, cat, 10], [ben, dan, 8]);
    await play([ann, dan, 4], [ben, cat, 10]);
    await play([eve, ann, 10], [ben, cat, 9]);
    const names = (await standings(office.id, {}, db)).map((s) => `${s.name}${s.provisional ? '?' : ''}`);
    // Ann 3/4. Ben and Cat 2/4, Ben ahead on goal difference (+13 against -3). Dan 0/3. Eve: one game.
    expect(names).toEqual(['Ann', 'Ben', 'Cat', 'Dan', 'Eve?']);
  });

  test('best partner: the highest win rate over at least 3 games together', async () => {
    for (let i = 0; i < 3; i++) await play([ann, ben, 10], [cat, dan, 5]); // Ann+Ben: 3/3
    for (let i = 0; i < 2; i++) await play([ann, cat, 10], [ben, dan, 5]); // Ann+Cat: 2/2, too few
    await play([ann, dan, 0], [ben, cat, 10]);
    const table = await standings(office.id, {}, db);
    const of = (p: Player) => table.find((s) => s.playerId === p.id)!;
    expect(of(ann).bestPartner).toEqual({ playerId: ben.id, name: 'Ben', played: 3, won: 3 });
    expect(of(dan).bestPartner).toEqual({ playerId: cat.id, name: 'Cat', played: 3, won: 0 });
    expect(of(eve)).toBeUndefined();
  });

  test('a period counts only the games played in it; other orgs never count', async () => {
    await play([ann, ben, 10], [cat, dan, 5], new Date('2026-09-30T21:30:00Z')); // 23:30 in Prague, September
    await play([ann, ben, 3], [cat, dan, 10], new Date('2026-09-30T22:30:00Z')); // 00:30, October
    const october = periodStart('month', 'Europe/Prague', new Date('2026-10-20T12:00:00Z'))!;
    expect(october.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    const table = await standings(office.id, { from: october }, db);
    expect(table.find((s) => s.playerId === ann.id)).toMatchObject({ played: 1, won: 0 });

    const other = await createOrg('Other', 'other', db);
    expect(await standings(other.id, {}, db)).toEqual([]);
  });
});

describe('the dashboard', () => {
  test('shows the period’s standings, recent games and the member’s own record', async () => {
    const [user] = await db.insert(appUser).values({ name: 'ann' }).returning({ id: appUser.id });
    await db.insert(orgMember).values({ orgId: office.id, userId: user!.id, playerId: ann.id });
    const member = (await memberships(user!.id, db))[0]!;
    await play([ann, ben, 10], [cat, dan, 5], new Date('2020-01-01T12:00:00Z'));
    await play([ann, ben, 10], [cat, dan, 7], new Date());

    const load = async (url: string) =>
      ((await dashboard.load(event({ userId: user!.id, member, url }))) as { dashboard: { games: number; period: string; recent: unknown[]; me: { played: number } | null } }).dashboard;
    expect(await load('/')).toMatchObject({ period: 'all', games: 2, me: { played: 2 } });
    expect(await load('/?period=year')).toMatchObject({ period: 'year', games: 1, me: { played: 1 } });
    expect((await load('/?period=nonsense')).period).toBe('all');
    expect((await load('/?period=month')).recent).toHaveLength(1);
  });

  test('someone in no org gets the explanation, not an error', async () => {
    expect(await dashboard.load(event({ userId: 1, member: null }))).toEqual({ dashboard: null });
  });
});
