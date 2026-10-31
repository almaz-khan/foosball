import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { createGame, getGame, listGames } from '../src/lib/server/games.ts';
import { createOrg, memberships, type Membership, type Org } from '../src/lib/server/orgs.ts';
import { createPlayer, listPlayers, type Player } from '../src/lib/server/players.ts';
import {
  addPoint,
  backToSetup,
  formFields,
  isSeated,
  newPlay,
  restore,
  seat,
  start,
  swapPositions,
  swapSides,
  tapSeat,
  type Play,
} from '../src/lib/play.ts';
import * as playPage from '../src/routes/play/+page.server.ts';
import { event, outcome } from './helpers/route.ts';
import { freshDatabase } from './helpers/testdb.ts';

const KEY = 'test-key-0001';
const seated = (...ids: number[]) => ids.reduce<Play>((p, id) => seat(p, id), newPlay(KEY));

describe('seating', () => {
  test('tapped players fill the empty seats in order', () => {
    const p = seated(1, 2, 3);
    expect(p.seats).toEqual({ 'red.offense': 1, 'red.defense': 2, 'blue.offense': 3, 'blue.defense': null });
    expect(isSeated(p)).toBe(false);
    expect(isSeated(seat(p, 4))).toBe(true);
    // A fifth player has nowhere to go.
    expect(seat(seat(p, 4), 5)).toEqual(seat(p, 4));
  });

  test('a chosen seat takes the next player; someone already seated moves', () => {
    let p = seated(1, 2, 3, 4);
    p = tapSeat(p, 'blue.defense'); // frees it and chooses it
    expect(p.seats['blue.defense']).toBeNull();
    p = seat(p, 1); // Ann moves from red offense
    expect(p.seats).toEqual({ 'red.offense': null, 'red.defense': 2, 'blue.offense': 3, 'blue.defense': 1 });
    expect(p.selected).toBeNull();
    // Tapping the chosen seat again un-chooses it.
    expect(tapSeat(tapSeat(p, 'red.offense'), 'red.offense').selected).toBeNull();
  });

  test('sides and positions swap', () => {
    const p = seated(1, 2, 3, 4);
    expect(swapSides(p).seats).toEqual({ 'red.offense': 3, 'red.defense': 4, 'blue.offense': 1, 'blue.defense': 2 });
    expect(swapPositions(p, 'blue').seats).toMatchObject({ 'blue.offense': 4, 'blue.defense': 3 });
  });
});

describe('scoring', () => {
  test('a live game starts the clock; scores stay within 0–99', () => {
    const at = new Date('2026-10-31T10:00:00Z');
    expect(start(seated(1, 2, 3), true, at).phase).toBe('setup'); // not everyone seated
    let p = start(seated(1, 2, 3, 4), true, at);
    expect(p).toMatchObject({ phase: 'live', startedAt: '2026-10-31T10:00:00.000Z' });
    p = addPoint(addPoint(p, 'red', 1), 'red', 1);
    p = addPoint(p, 'blue', -1);
    expect(p.score).toEqual({ red: 2, blue: 0 });
    expect(start(seated(1, 2, 3, 4), false).startedAt).toBeNull();
    expect(backToSetup(p)).toMatchObject({ phase: 'setup', score: { red: 0, blue: 0 }, seats: p.seats });
  });

  test('the save form carries seats, scores, exact times and the key', () => {
    const p = addPoint(start(seated(1, 2, 3, 4), true, new Date('2026-10-31T10:00:00Z')), 'blue', 1);
    expect(formFields(p, new Date('2026-10-31T10:07:30Z'))).toEqual({
      red_offense: '1', red_defense: '2', blue_offense: '3', blue_defense: '4',
      red_score: '0', blue_score: '1',
      started_at: '2026-10-31T10:00:00.000Z', ended_at: '2026-10-31T10:07:30.000Z',
      client_key: KEY,
    });
  });

  test('a stored game comes back; anything else is dropped', () => {
    const p = start(seated(1, 2, 3, 4), true);
    expect(restore(JSON.stringify(p))).toEqual(p);
    expect(restore(null)).toBeNull();
    expect(restore('{not json')).toBeNull();
    expect(restore(JSON.stringify({ ...p, version: 0 }))).toBeNull();
    expect(restore(JSON.stringify({ ...p, seats: { ...p.seats, 'red.offense': 'x' } }))).toBeNull();
  });
});

describe('recording at the table', () => {
  let db: Db;
  let office: Org;
  let p: Player[];
  const who: Record<'ben' | 'vic', { id: number; member: Membership }> = {} as never;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE foosball.org, foosball.app_user RESTART IDENTITY CASCADE`);
    office = await createOrg('Office', 'office', db);
    p = await Promise.all(['Ann', 'Ben', 'Cat', 'Dan'].map((firstName) => createPlayer(office.id, { firstName }, db)));
    const users = await db.insert(appUser).values([{ name: 'ben' }, { name: 'vic' }]).returning({ id: appUser.id });
    await db.insert(orgMember).values([
      { orgId: office.id, userId: users[0]!.id, playerId: p[1]!.id },
      { orgId: office.id, userId: users[1]!.id, playerId: null },
    ]);
    for (const [i, name] of (['ben', 'vic'] as const).entries()) {
      who[name] = { id: users[i]!.id, member: (await memberships(users[i]!.id, db))[0]! };
    }
  });

  const fields = () => {
    const play = addPoint(start(p.reduce<Play>((acc, x) => seat(acc, x.id), newPlay('abcd-1234-efgh')), true, new Date(Date.now() - 600_000)), 'red', 1);
    return formFields(play);
  };

  test('the same game saved twice (a retry, a double tap) is one game', async () => {
    const save = () => outcome(() => playPage.actions.save!(event({ userId: who.ben.id, member: who.ben.member, form: fields() })));
    const first = await save();
    const second = await save();
    expect(first).toMatchObject({ kind: 'redirect', location: expect.stringMatching(/^\/games\/\d+\?saved$/) });
    expect(second).toEqual(first);
    const { games } = await listGames(office.id, {}, db);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ source: 'web', createdBy: who.ben.id, red: { score: 1, offense: { name: 'Ann' } } });
    expect(games[0]!.endedAt!.getTime() - games[0]!.startedAt!.getTime()).toBeGreaterThan(590_000);
  });

  test('saving at once from two requests still makes one game', async () => {
    const input = {
      red: { score: 1, offense: p[0]!.id, defense: p[1]!.id },
      blue: { score: 0, offense: p[2]!.id, defense: p[3]!.id },
      clientKey: 'same-key-123',
    };
    const ids = await Promise.all([createGame(office.id, input, null, db), createGame(office.id, input, null, db)]);
    expect(ids[0]).toBe(ids[1]);
    expect(await getGame(office.id, ids[0], db)).not.toBeNull();
  });

  test('only members who play can open the table or save', async () => {
    expect(await outcome(() => playPage.load(event({ userId: who.vic.id, member: who.vic.member })))).toMatchObject({ kind: 'error', status: 403 });
    expect(
      await outcome(() => playPage.actions.save!(event({ userId: who.vic.id, member: who.vic.member, form: fields() }))),
    ).toMatchObject({ kind: 'error', status: 403 });
  });

  test('anyone who records can add a guest to the roster', async () => {
    const add = await outcome(() =>
      playPage.actions.addPlayer!(event({ userId: who.ben.id, member: who.ben.member, form: { first_name: 'Gus', last_name: '' } })),
    );
    expect(add).toMatchObject({ kind: 'ok', value: { added: { name: 'Gus' } } });
    expect((await listPlayers(office.id, {}, db)).map((x) => x.name)).toContain('Gus');
    const empty = await outcome(() =>
      playPage.actions.addPlayer!(event({ userId: who.ben.id, member: who.ben.member, form: { first_name: ' ' } })),
    );
    expect(empty).toMatchObject({ kind: 'fail', status: 400 });
  });
});
