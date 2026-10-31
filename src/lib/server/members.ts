import { and, asc, count, eq, ne } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { appUser, org, orgMember, player, type Role } from './db/schema.ts';
import { fullName } from './orgs.ts';

export interface Member {
  userId: number;
  userName: string;
  role: Role;
  playerId: number | null;
  playerName: string | null;
  joinedAt: Date;
}

export class MemberError extends Error {}

export async function listMembers(orgId: number, db: Executor = getDb()): Promise<Member[]> {
  const rows = await db
    .select({
      userId: appUser.id,
      userName: appUser.name,
      role: orgMember.role,
      playerId: orgMember.playerId,
      firstName: player.firstName,
      lastName: player.lastName,
      joinedAt: orgMember.createdAt,
    })
    .from(orgMember)
    .innerJoin(appUser, eq(appUser.id, orgMember.userId))
    .leftJoin(player, eq(player.id, orgMember.playerId))
    .where(eq(orgMember.orgId, orgId))
    .orderBy(asc(orgMember.createdAt), asc(appUser.id));
  return rows.map(({ firstName, lastName, ...m }) => ({
    ...m,
    playerName: firstName === null ? null : fullName(firstName, lastName),
  }));
}

/** An org always keeps an admin: someone has to be able to invite and fix things. */
async function assertAnotherAdmin(orgId: number, userId: number, db: Executor): Promise<void> {
  const [others] = await db
    .select({ n: count() })
    .from(orgMember)
    .where(and(eq(orgMember.orgId, orgId), eq(orgMember.role, 'admin'), ne(orgMember.userId, userId)));
  if ((others?.n ?? 0) === 0) throw new MemberError('An org needs at least one admin. Make someone else admin first.');
}

/** Role changes in one org run one at a time, so two admins demoting each other cannot both succeed. */
async function lockOrg(orgId: number, db: Executor): Promise<void> {
  await db.select({ id: org.id }).from(org).where(eq(org.id, orgId)).for('update');
}

async function roleOf(orgId: number, userId: number, db: Executor): Promise<Role | null> {
  const [row] = await db
    .select({ role: orgMember.role })
    .from(orgMember)
    .where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)));
  return row?.role ?? null;
}

export async function setRole(orgId: number, userId: number, role: Role, db: Executor = getDb()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockOrg(orgId, tx);
    const current = await roleOf(orgId, userId, tx);
    if (current === null) return false;
    if (current === 'admin' && role !== 'admin') await assertAnotherAdmin(orgId, userId, tx);
    await tx.update(orgMember).set({ role }).where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)));
    return true;
  });
}

/** Who a member is at the table; null unlinks them, leaving them able only to watch. */
export async function linkPlayer(
  orgId: number,
  userId: number,
  playerId: number | null,
  db: Executor = getDb(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (playerId !== null) {
      const [p] = await tx
        .select({ archivedAt: player.archivedAt })
        .from(player)
        .where(and(eq(player.orgId, orgId), eq(player.id, playerId)));
      if (!p) throw new MemberError('That player is not on this org’s roster.');
      if (p.archivedAt) throw new MemberError('That player is archived. Restore them first.');
      const [taken] = await tx
        .select({ userId: orgMember.userId })
        .from(orgMember)
        .where(and(eq(orgMember.orgId, orgId), eq(orgMember.playerId, playerId), ne(orgMember.userId, userId)));
      if (taken) throw new MemberError('That player is already linked to another member.');
    }
    const rows = await tx
      .update(orgMember)
      .set({ playerId })
      .where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)))
      .returning({ userId: orgMember.userId });
    return rows.length > 0;
  });
}

export async function removeMember(orgId: number, userId: number, db: Executor = getDb()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockOrg(orgId, tx);
    const current = await roleOf(orgId, userId, tx);
    if (current === null) return false;
    if (current === 'admin') await assertAnotherAdmin(orgId, userId, tx);
    await tx.delete(orgMember).where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)));
    return true;
  });
}

/**
 * Whether an admin may hand out a link that adds a passkey to someone's
 * account. That link opens the whole account, in every org it belongs to,
 * so it is only theirs to give if they are an admin wherever that person is
 * a member. Otherwise an admin of one org could take over a member of another.
 */
export async function canIssueRecovery(adminUserId: number, targetUserId: number, db: Executor = getDb()): Promise<boolean> {
  const theirs = await db.select({ orgId: orgMember.orgId }).from(orgMember).where(eq(orgMember.userId, targetUserId));
  if (theirs.length === 0) return false;
  const mine = await db
    .select({ orgId: orgMember.orgId })
    .from(orgMember)
    .where(and(eq(orgMember.userId, adminUserId), eq(orgMember.role, 'admin')));
  const adminOf = new Set(mine.map((m) => m.orgId));
  return theirs.every((m) => adminOf.has(m.orgId));
}
