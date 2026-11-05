import { asc, eq } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { appUser, org, orgMember } from './db/schema.ts';

export interface User {
  id: number;
  name: string;
  /** Their person key at the login hub; null until their first sign-in there. */
  hubSub: string | null;
}

export class UserError extends Error {}

/** A person's name as shown to others: trimmed, single-spaced, at most 40 characters. */
export function cleanUserName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) throw new UserError('A name is needed.');
  return clean;
}

const userColumns = { id: appUser.id, name: appUser.name, hubSub: appUser.hubSub };

export async function findUser(name: string, db: Executor = getDb()): Promise<User | null> {
  const [row] = await db.select(userColumns).from(appUser).where(eq(appUser.name, name.trim()));
  return row ?? null;
}

export async function getUser(id: number, db: Executor = getDb()): Promise<User | null> {
  const [row] = await db.select(userColumns).from(appUser).where(eq(appUser.id, id));
  return row ?? null;
}

/** Every account and its orgs; accounts are made at their first sign-in through the hub (sessions.ts). */
export async function listUsers(db: Executor = getDb()): Promise<(User & { orgs: string[] })[]> {
  const [users, members] = await Promise.all([
    db.select(userColumns).from(appUser).orderBy(asc(appUser.id)),
    db
      .select({ userId: orgMember.userId, slug: org.slug, role: orgMember.role })
      .from(orgMember)
      .innerJoin(org, eq(org.id, orgMember.orgId))
      .orderBy(asc(org.id)),
  ]);
  return users.map((u) => ({
    ...u,
    orgs: members.filter((m) => m.userId === u.id).map((m) => (m.role === 'admin' ? `${m.slug} (admin)` : m.slug)),
  }));
}

export async function renameUser(from: string, to: string, db: Executor = getDb()): Promise<boolean> {
  const clean = cleanUserName(to);
  if (await findUser(clean, db)) throw new UserError(`Someone is already called “${clean}”.`);
  const rows = await db.update(appUser).set({ name: clean }).where(eq(appUser.name, from)).returning({ id: appUser.id });
  return rows.length > 0;
}

/** A person renaming themselves. */
export async function renameUserById(userId: number, to: string, db: Executor = getDb()): Promise<void> {
  const clean = cleanUserName(to);
  const taken = await findUser(clean, db);
  if (taken && taken.id !== userId) throw new UserError(`Someone is already called “${clean}”.`);
  await db.update(appUser).set({ name: clean }).where(eq(appUser.id, userId));
}
