import { asc, eq } from 'drizzle-orm';
import { DEFAULT_TIME_ZONE, isTimeZone } from '../dates.ts';
import { getDb, type Executor } from './db/index.ts';
import { org, orgMember, player, type Role } from './db/schema.ts';

export interface Org {
  id: number;
  name: string;
  slug: string;
  timeZone: string;
}

/** An account's place in one org: what the request may do there. */
export interface Membership {
  orgId: number;
  orgName: string;
  orgSlug: string;
  /** The zone the org's games are shown and filtered in. */
  orgTimeZone: string;
  role: Role;
  /** Who they are at the table; null for members who only watch. */
  playerId: number | null;
  playerName: string | null;
}

export class OrgError extends Error {}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const orgColumns = { id: org.id, name: org.name, slug: org.slug, timeZone: org.timeZone };

export async function createOrg(
  name: string,
  slug: string,
  db: Executor = getDb(),
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<Org> {
  const n = name.trim();
  const s = slug.trim().toLowerCase();
  if (!n) throw new OrgError('An org needs a name.');
  if (!isTimeZone(timeZone)) throw new OrgError(`Unknown time zone "${timeZone}", e.g. Europe/Prague or America/New_York.`);
  if (!SLUG.test(s)) throw new OrgError('A slug is 1–40 lowercase letters, digits or dashes, e.g. "office".');
  if (await findOrg(s, db)) throw new OrgError(`An org with the slug "${s}" already exists.`);
  const [row] = await db.insert(org).values({ name: n, slug: s, timeZone }).returning(orgColumns);
  return row!;
}

export async function findOrg(slug: string, db: Executor = getDb()): Promise<Org | null> {
  const [row] = await db.select(orgColumns).from(org).where(eq(org.slug, slug));
  return row ?? null;
}

export async function listOrgs(db: Executor = getDb()): Promise<Org[]> {
  return db.select(orgColumns).from(org).orderBy(asc(org.id));
}

/** Every org an account belongs to, oldest first. */
export async function memberships(userId: number, db: Executor = getDb()): Promise<Membership[]> {
  const rows = await db
    .select({
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      orgTimeZone: org.timeZone,
      role: orgMember.role,
      playerId: orgMember.playerId,
      firstName: player.firstName,
      lastName: player.lastName,
    })
    .from(orgMember)
    .innerJoin(org, eq(org.id, orgMember.orgId))
    .leftJoin(player, eq(player.id, orgMember.playerId))
    .where(eq(orgMember.userId, userId))
    .orderBy(asc(orgMember.createdAt), asc(org.id));
  return rows.map(({ firstName, lastName, ...m }) => ({
    ...m,
    playerName: firstName === null ? null : fullName(firstName, lastName),
  }));
}

export const fullName = (first: string, last: string | null) => (last ? `${first} ${last}` : first);

// ---------------------------------------------------------------- permissions

/** Anyone in the org may look. */
export const canView = (m: Membership | null): m is Membership => m !== null;
/** Recording a game needs to be someone at the table: a linked player. */
export const canRecord = (m: Membership | null) => m !== null && m.playerId !== null;
/** Members, invites and the roster are the admins'. */
export const canManage = (m: Membership | null) => m?.role === 'admin';
/** A saved game is its recorder's to fix, and any admin's. */
export const canEditGame = (m: Membership | null, userId: number, createdBy: number | null) =>
  m !== null && (m.role === 'admin' || (createdBy !== null && createdBy === userId));
