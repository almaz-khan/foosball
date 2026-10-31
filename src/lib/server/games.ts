import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { appUser, game, gamePlayer, player, POSITIONS, TEAMS, type Position, type Team } from './db/schema.ts';
import { fullName } from './orgs.ts';

export interface PlayerRef {
  id: number;
  name: string;
}

export interface Side<P> {
  score: number;
  offense: P;
  defense: P;
}

/** A game as the app shows it: the old API's `{red, blue}` shape, players filled in. */
export interface Game {
  id: number;
  startedAt: Date | null;
  endedAt: Date | null;
  /** When it was played, for ordering and filtering: its end, else its start, else when it was saved. */
  playedAt: Date;
  source: string;
  metadata: Record<string, unknown>;
  createdBy: number | null;
  /** The account that recorded it, by name; null for imported games or a deleted account. */
  recordedBy: string | null;
  red: Side<PlayerRef>;
  blue: Side<PlayerRef>;
}

export interface GameInput {
  startedAt?: Date | null;
  endedAt?: Date | null;
  red: Side<number>;
  blue: Side<number>;
  source?: string;
  metadata?: Record<string, unknown>;
  /** Set by the recording browser: saving the same key twice returns the first game. */
  clientKey?: string | null;
}

/** A failure whose message is safe and useful to show the person entering the game. */
export class GameError extends Error {}

export const MAX_SCORE = 99;

const playedAt = sql<Date>`coalesce(${game.endedAt}, ${game.startedAt}, ${game.createdAt})`.mapWith(
  (v: string | Date) => new Date(v),
);
/** A Date as a query parameter where no column type maps it (comparisons with `playedAt`). */
const at = (d: Date) => sql`${d.toISOString()}::timestamptz`;

function validate(input: GameInput): void {
  for (const team of TEAMS) {
    const s = input[team].score;
    if (!Number.isInteger(s) || s < 0 || s > MAX_SCORE) {
      throw new GameError(`The ${team} score must be a whole number from 0 to ${MAX_SCORE}.`);
    }
    for (const position of POSITIONS) {
      if (!Number.isInteger(input[team][position]) || input[team][position] <= 0) {
        throw new GameError(`Choose the ${team} ${position} player.`);
      }
    }
  }
  const ids = seats(input).map((s) => s.playerId);
  if (new Set(ids).size !== ids.length) throw new GameError('Each of the four players must be a different person.');
  const { startedAt, endedAt } = input;
  for (const d of [startedAt, endedAt]) {
    if (d && Number.isNaN(d.getTime())) throw new GameError('That is not a valid date.');
  }
  if (startedAt && endedAt && endedAt < startedAt) throw new GameError('A game cannot end before it starts.');
}

const seats = (input: GameInput): { team: Team; position: Position; playerId: number }[] =>
  TEAMS.flatMap((team) => POSITIONS.map((position) => ({ team, position, playerId: input[team][position] })));

/** All four must be on this org's roster: a friendlier refusal than the foreign key's. */
async function checkRoster(orgId: number, input: GameInput, db: Executor): Promise<void> {
  const ids = seats(input).map((s) => s.playerId);
  const found = await db
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.orgId, orgId), inArray(player.id, ids)));
  if (found.length !== ids.length) throw new GameError('Every player must be on this org’s roster.');
}

export async function createGame(
  orgId: number,
  input: GameInput,
  createdBy: number | null,
  db: Executor = getDb(),
): Promise<number> {
  validate(input);
  const clientKey = input.clientKey ?? null;
  if (clientKey !== null && !CLIENT_KEY.test(clientKey)) throw new GameError('This game could not be saved. Reload the page and try again.');
  return db.transaction(async (tx) => {
    await checkRoster(orgId, input, tx);
    const [row] = await tx
      .insert(game)
      .values({
        orgId,
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        redScore: input.red.score,
        blueScore: input.blue.score,
        source: input.source?.trim().slice(0, 40) || 'web',
        metadata: input.metadata ?? {},
        createdBy,
        clientKey,
      })
      .onConflictDoNothing({ target: [game.orgId, game.clientKey] })
      .returning({ id: game.id });
    if (!row) {
      // Saved already, by an earlier try of this same save.
      const [first] = await tx
        .select({ id: game.id })
        .from(game)
        .where(and(eq(game.orgId, orgId), eq(game.clientKey, clientKey!)));
      return first!.id;
    }
    await tx.insert(gamePlayer).values(seats(input).map((s) => ({ orgId, gameId: row.id, ...s })));
    return row.id;
  });
}

/** Keys from browsers: a UUID or similar, never anything long. */
const CLIENT_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Replaces a game's times, scores and seats. Source, metadata and recorder stay as they were. */
export async function updateGame(orgId: number, id: number, input: GameInput, db: Executor = getDb()): Promise<boolean> {
  validate(input);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(game)
      .set({
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        redScore: input.red.score,
        blueScore: input.blue.score,
      })
      .where(and(eq(game.orgId, orgId), eq(game.id, id)))
      .returning({ id: game.id });
    if (updated.length === 0) return false;
    await checkRoster(orgId, input, tx);
    await tx.delete(gamePlayer).where(eq(gamePlayer.gameId, id));
    await tx.insert(gamePlayer).values(seats(input).map((s) => ({ orgId, gameId: id, ...s })));
    return true;
  });
}

export async function deleteGame(orgId: number, id: number, db: Executor = getDb()): Promise<boolean> {
  const rows = await db.delete(game).where(and(eq(game.orgId, orgId), eq(game.id, id))).returning({ id: game.id });
  return rows.length > 0;
}

export async function getGame(orgId: number, id: number, db: Executor = getDb()): Promise<Game | null> {
  const games = await withSeats(orgId, await selectGames(db).where(and(eq(game.orgId, orgId), eq(game.id, id))), db);
  return games[0] ?? null;
}

export interface GameFilter {
  /** Games this player was in. */
  playerId?: number;
  /** Played at or after. */
  from?: Date;
  /** Played before. */
  to?: Date;
  source?: string;
  /** Page size, 1–100. */
  limit?: number;
  /** The `next` cursor of the previous page. */
  cursor?: string | null;
}

/** Newest first, a page at a time; `next` is null on the last page. */
export async function listGames(
  orgId: number,
  filter: GameFilter = {},
  db: Executor = getDb(),
): Promise<{ games: Game[]; next: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 25), 1), 100);
  const where: (SQL | undefined)[] = [eq(game.orgId, orgId)];
  if (filter.playerId !== undefined) {
    where.push(
      sql`exists (select 1 from ${gamePlayer} where ${gamePlayer.gameId} = ${game.id} and ${gamePlayer.playerId} = ${filter.playerId})`,
    );
  }
  if (filter.from) where.push(gte(playedAt, at(filter.from)));
  if (filter.to) where.push(lt(playedAt, at(filter.to)));
  if (filter.source) where.push(eq(game.source, filter.source));
  const after = decodeCursor(filter.cursor);
  if (after) where.push(or(lt(playedAt, at(after.playedAt)), and(eq(playedAt, at(after.playedAt)), lt(game.id, after.id))));

  const rows = await selectGames(db)
    .where(and(...where))
    .orderBy(desc(playedAt), desc(game.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    games: await withSeats(orgId, page, db),
    next: rows.length > limit && last ? encodeCursor(last.playedAt, last.id) : null,
  };
}

// ---------------------------------------------------------------- assembly

const selectGames = (db: Executor) =>
  db
    .select({
      id: game.id,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      playedAt,
      source: game.source,
      metadata: game.metadata,
      createdBy: game.createdBy,
      recordedBy: appUser.name,
      redScore: game.redScore,
      blueScore: game.blueScore,
    })
    .from(game)
    .leftJoin(appUser, eq(appUser.id, game.createdBy))
    .$dynamic();

type GameRow = Awaited<ReturnType<ReturnType<typeof selectGames>['execute']>>[number];

async function withSeats(orgId: number, rows: GameRow[], db: Executor): Promise<Game[]> {
  if (rows.length === 0) return [];
  const seatRows = await db
    .select({
      gameId: gamePlayer.gameId,
      team: gamePlayer.team,
      position: gamePlayer.position,
      id: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
    })
    .from(gamePlayer)
    .innerJoin(player, eq(player.id, gamePlayer.playerId))
    .where(and(eq(gamePlayer.orgId, orgId), inArray(gamePlayer.gameId, rows.map((r) => r.id))));

  const byGame = new Map<number, Map<string, PlayerRef>>();
  for (const s of seatRows) {
    const seats = byGame.get(s.gameId) ?? new Map<string, PlayerRef>();
    seats.set(`${s.team}.${s.position}`, { id: s.id, name: fullName(s.firstName, s.lastName) });
    byGame.set(s.gameId, seats);
  }
  return rows.map(({ redScore, blueScore, ...r }) => {
    const seats = byGame.get(r.id)!;
    const side = (team: Team, score: number): Side<PlayerRef> => ({
      score,
      offense: seats.get(`${team}.offense`)!,
      defense: seats.get(`${team}.defense`)!,
    });
    return { ...r, red: side('red', redScore), blue: side('blue', blueScore) };
  });
}

function encodeCursor(at: Date, id: number): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): { playedAt: Date; id: number } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const playedAt = new Date(iso ?? '');
  const n = Number(id);
  return Number.isNaN(playedAt.getTime()) || !Number.isInteger(n) ? null : { playedAt, id: n };
}
