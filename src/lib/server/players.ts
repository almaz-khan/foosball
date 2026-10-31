import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { gamePlayer, orgMember, player } from './db/schema.ts';
import { fullName } from './orgs.ts';

export interface Player {
  id: number;
  firstName: string;
  lastName: string | null;
  name: string;
  archived: boolean;
}

export interface PlayerInput {
  firstName: string;
  lastName?: string | null;
}

export class PlayerError extends Error {}

const columns = {
  id: player.id,
  firstName: player.firstName,
  lastName: player.lastName,
  archivedAt: player.archivedAt,
};

const toPlayer = (r: { id: number; firstName: string; lastName: string | null; archivedAt: Date | null }): Player => ({
  id: r.id,
  firstName: r.firstName,
  lastName: r.lastName,
  name: fullName(r.firstName, r.lastName),
  archived: r.archivedAt !== null,
});

function clean(input: PlayerInput): { firstName: string; lastName: string | null } {
  const firstName = input.firstName.trim().slice(0, 60);
  const lastName = input.lastName?.trim().slice(0, 60) || null;
  if (!firstName) throw new PlayerError('A player needs a first name.');
  return { firstName, lastName };
}

export async function listPlayers(
  orgId: number,
  { includeArchived = false } = {},
  db: Executor = getDb(),
): Promise<Player[]> {
  const rows = await db
    .select(columns)
    .from(player)
    .where(and(eq(player.orgId, orgId), includeArchived ? undefined : isNull(player.archivedAt)))
    .orderBy(asc(sql`lower(${player.firstName})`), asc(sql`lower(coalesce(${player.lastName}, ''))`), asc(player.id));
  return rows.map(toPlayer);
}

export async function getPlayer(orgId: number, id: number, db: Executor = getDb()): Promise<Player | null> {
  const [row] = await db.select(columns).from(player).where(and(eq(player.orgId, orgId), eq(player.id, id)));
  return row ? toPlayer(row) : null;
}

export async function createPlayer(orgId: number, input: PlayerInput, db: Executor = getDb()): Promise<Player> {
  const [row] = await db.insert(player).values({ orgId, ...clean(input) }).returning(columns);
  return toPlayer(row!);
}

export async function updatePlayer(
  orgId: number,
  id: number,
  input: PlayerInput,
  db: Executor = getDb(),
): Promise<Player | null> {
  const [row] = await db
    .update(player)
    .set(clean(input))
    .where(and(eq(player.orgId, orgId), eq(player.id, id)))
    .returning(columns);
  return row ? toPlayer(row) : null;
}

export async function restorePlayer(orgId: number, id: number, db: Executor = getDb()): Promise<boolean> {
  const rows = await db
    .update(player)
    .set({ archivedAt: null })
    .where(and(eq(player.orgId, orgId), eq(player.id, id)))
    .returning({ id: player.id });
  return rows.length > 0;
}

/**
 * Removes a player from the roster. Someone with games stays in the history,
 * so they are archived; someone without any is deleted, after unlinking the
 * member who was them (the link's foreign key refuses the delete otherwise).
 */
export async function removePlayer(
  orgId: number,
  id: number,
  db: Executor = getDb(),
): Promise<'archived' | 'deleted' | null> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: player.id })
      .from(player)
      .where(and(eq(player.orgId, orgId), eq(player.id, id)))
      .for('update');
    if (!found) return null;

    const [played] = await tx
      .select({ gameId: gamePlayer.gameId })
      .from(gamePlayer)
      .where(and(eq(gamePlayer.orgId, orgId), eq(gamePlayer.playerId, id)))
      .limit(1);
    if (played) {
      await tx.update(player).set({ archivedAt: sql`now()` }).where(eq(player.id, id));
      return 'archived';
    }

    await tx
      .update(orgMember)
      .set({ playerId: null })
      .where(and(eq(orgMember.orgId, orgId), eq(orgMember.playerId, id)));
    await tx.delete(player).where(eq(player.id, id));
    return 'deleted';
  });
}
