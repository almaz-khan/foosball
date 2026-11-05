import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { org, orgInvite, orgMember, player, type Role } from './db/schema.ts';
import { fullName } from './orgs.ts';
import { createPlayer } from './players.ts';
import { hashToken, inMinutes, newToken, now } from './tokens.ts';
import { cleanUserName } from './users.ts';

/** How long an invite works, from INVITE_HOURS (default two days: long enough to be sent over chat). */
export function inviteHours(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.INVITE_HOURS ?? 48);
  return Number.isFinite(hours) && hours > 0 ? hours : 48;
}

export class InviteError extends Error {}

/** Who the person will be at the table: an existing player, a new one, or nobody (they only watch). */
export type InvitePlayer = { playerId: number } | { firstName: string; lastName?: string | null } | null;

export interface InviteInput {
  orgId: number;
  /** Who it is for, as the admins' list shows it; the account that joins keeps the name it has. */
  invitedName: string;
  role?: Role;
  player?: InvitePlayer;
  createdBy?: number | null;
  hours?: number;
}

export async function createInvite(
  input: InviteInput,
  db: Executor = getDb(),
): Promise<{ token: string; expiresAt: Date }> {
  const invitedName = cleanUserName(input.invitedName);
  const p = input.player ?? null;
  let playerId: number | null = null;
  let newPlayer: { first: string; last: string | null } | null = null;
  if (p && 'playerId' in p) {
    const [found] = await db
      .select({ id: player.id, archivedAt: player.archivedAt, linked: orgMember.userId })
      .from(player)
      .leftJoin(orgMember, and(eq(orgMember.orgId, player.orgId), eq(orgMember.playerId, player.id)))
      .where(and(eq(player.orgId, input.orgId), eq(player.id, p.playerId)));
    if (!found) throw new InviteError('That player is not on this org’s roster.');
    if (found.archivedAt) throw new InviteError('That player is archived. Restore them first.');
    if (found.linked !== null) throw new InviteError('That player is already linked to a member.');
    playerId = found.id;
  } else if (p) {
    const first = p.firstName.trim();
    if (!first) throw new InviteError('A new player needs a first name.');
    newPlayer = { first, last: p.lastName?.trim() || null };
  }

  const token = newToken();
  const [row] = await db
    .insert(orgInvite)
    .values({
      tokenHash: hashToken(token),
      orgId: input.orgId,
      role: input.role ?? 'member',
      invitedName,
      playerId,
      newPlayerFirstName: newPlayer?.first ?? null,
      newPlayerLastName: newPlayer?.last ?? null,
      createdBy: input.createdBy ?? null,
      expiresAt: inMinutes(Math.round((input.hours ?? inviteHours()) * 60)),
    })
    .returning({ expiresAt: orgInvite.expiresAt });
  return { token, expiresAt: row!.expiresAt };
}

export interface InviteInfo {
  orgId: number;
  orgName: string;
  orgSlug: string;
  invitedName: string;
  role: Role;
  /** Who they will play as, if anyone. */
  playerName: string | null;
}

const live = (token: string) =>
  and(eq(orgInvite.tokenHash, hashToken(token)), isNull(orgInvite.usedAt), gt(orgInvite.expiresAt, now));

/** What an unused, unexpired invite would do, or null if it would do nothing. */
export async function inviteFor(token: string, db: Executor = getDb()): Promise<InviteInfo | null> {
  const [row] = await db
    .select({
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      invitedName: orgInvite.invitedName,
      role: orgInvite.role,
      firstName: player.firstName,
      lastName: player.lastName,
      newFirst: orgInvite.newPlayerFirstName,
      newLast: orgInvite.newPlayerLastName,
    })
    .from(orgInvite)
    .innerJoin(org, eq(org.id, orgInvite.orgId))
    .leftJoin(player, eq(player.id, orgInvite.playerId))
    .where(live(token));
  if (!row) return null;
  const { firstName, lastName, newFirst, newLast, ...info } = row;
  return {
    ...info,
    playerName: firstName !== null ? fullName(firstName, lastName) : newFirst !== null ? fullName(newFirst, newLast) : null,
  };
}

/**
 * Spends the invite on an account: a membership in its org, with the player it
 * names (or creates). All or nothing: a refusal leaves the invite unused.
 */
export async function acceptInvite(token: string, userId: number, db: Executor = getDb()): Promise<{ orgId: number }> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .update(orgInvite)
      .set({ usedAt: now, usedBy: userId })
      .where(live(token))
      .returning({
        orgId: orgInvite.orgId,
        role: orgInvite.role,
        playerId: orgInvite.playerId,
        newFirst: orgInvite.newPlayerFirstName,
        newLast: orgInvite.newPlayerLastName,
      });
    if (!invite) throw new InviteError('This invite was already used or has expired. Ask for a new one.');

    const [already] = await tx
      .select({ userId: orgMember.userId })
      .from(orgMember)
      .where(and(eq(orgMember.orgId, invite.orgId), eq(orgMember.userId, userId)));
    if (already) throw new InviteError('You are already a member of this org.');

    let playerId = invite.playerId;
    if (playerId !== null) {
      const [taken] = await tx
        .select({ userId: orgMember.userId })
        .from(orgMember)
        .where(and(eq(orgMember.orgId, invite.orgId), eq(orgMember.playerId, playerId)));
      if (taken) throw new InviteError('The player this invite is for is already linked to someone else. Ask for a new invite.');
    } else if (invite.newFirst !== null) {
      playerId = (await createPlayer(invite.orgId, { firstName: invite.newFirst, lastName: invite.newLast }, tx)).id;
    }

    await tx.insert(orgMember).values({ orgId: invite.orgId, userId, role: invite.role, playerId });
    return { orgId: invite.orgId };
  });
}

export interface PendingInvite {
  /** Identifies the invite for revoking; the hash of its token, never the token. */
  id: string;
  invitedName: string;
  role: Role;
  playerName: string | null;
  expiresAt: Date;
}

export async function pendingInvites(orgId: number, db: Executor = getDb()): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      tokenHash: orgInvite.tokenHash,
      invitedName: orgInvite.invitedName,
      role: orgInvite.role,
      expiresAt: orgInvite.expiresAt,
      firstName: player.firstName,
      lastName: player.lastName,
      newFirst: orgInvite.newPlayerFirstName,
      newLast: orgInvite.newPlayerLastName,
    })
    .from(orgInvite)
    .leftJoin(player, eq(player.id, orgInvite.playerId))
    .where(and(eq(orgInvite.orgId, orgId), isNull(orgInvite.usedAt), gt(orgInvite.expiresAt, now)))
    .orderBy(asc(orgInvite.createdAt));
  return rows.map((r) => ({
    id: r.tokenHash.toString('hex'),
    invitedName: r.invitedName,
    role: r.role,
    expiresAt: r.expiresAt,
    playerName: r.firstName !== null ? fullName(r.firstName, r.lastName) : r.newFirst !== null ? fullName(r.newFirst, r.newLast) : null,
  }));
}

export async function revokeInvite(orgId: number, id: string, db: Executor = getDb()): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(id)) return false;
  const rows = await db
    .delete(orgInvite)
    .where(and(eq(orgInvite.orgId, orgId), eq(orgInvite.tokenHash, Buffer.from(id, 'hex')), isNull(orgInvite.usedAt)))
    .returning({ orgId: orgInvite.orgId });
  return rows.length > 0;
}
