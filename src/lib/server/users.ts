import { randomBytes } from 'node:crypto';
import { asc, count, eq } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { appUser, authCredential, org, orgMember } from './db/schema.ts';

export interface User {
  id: number;
  name: string;
  webauthnId: Uint8Array<ArrayBuffer>;
}

export class UserError extends Error {}

/**
 * A WebAuthn user handle that survives password managers which treat it as
 * UTF-8 text (NordPass): 128 random bits as 32 ASCII hex characters.
 */
export function newUserHandle(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(randomBytes(16).toString('hex'), 'ascii'));
}

/** A person's name as shown to others: trimmed, single-spaced, at most 40 characters. */
export function cleanUserName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) throw new UserError('A name is needed.');
  return clean;
}

const userColumns = { id: appUser.id, name: appUser.name, webauthnId: appUser.webauthnId };
const toUser = (r: { id: number; name: string; webauthnId: Buffer }): User => ({
  id: r.id,
  name: r.name,
  webauthnId: new Uint8Array(r.webauthnId),
});

export async function findUser(name: string, db: Executor = getDb()): Promise<User | null> {
  const [row] = await db.select(userColumns).from(appUser).where(eq(appUser.name, name.trim()));
  return row ? toUser(row) : null;
}

export async function getUser(id: number, db: Executor = getDb()): Promise<User | null> {
  const [row] = await db.select(userColumns).from(appUser).where(eq(appUser.id, id));
  return row ? toUser(row) : null;
}

/** Only ever called while registering the account's first passkey: there are no accounts without one. */
export async function createUser(name: string, handle: Uint8Array, db: Executor = getDb()): Promise<User> {
  const clean = cleanUserName(name);
  if (await findUser(clean, db)) throw new UserError(`Someone is already called “${clean}”. Choose another name.`);
  const [row] = await db
    .insert(appUser)
    .values({ name: clean, webauthnId: Buffer.from(handle) })
    .returning(userColumns);
  return toUser(row!);
}

export async function listUsers(
  db: Executor = getDb(),
): Promise<(User & { passkeys: number; orgs: string[] })[]> {
  const [users, passkeys, members] = await Promise.all([
    db.select(userColumns).from(appUser).orderBy(asc(appUser.id)),
    db.select({ userId: authCredential.userId, n: count() }).from(authCredential).groupBy(authCredential.userId),
    db
      .select({ userId: orgMember.userId, slug: org.slug, role: orgMember.role })
      .from(orgMember)
      .innerJoin(org, eq(org.id, orgMember.orgId))
      .orderBy(asc(org.id)),
  ]);
  const keys = new Map(passkeys.map((p) => [p.userId, p.n]));
  return users.map((u) => ({
    ...toUser(u),
    passkeys: keys.get(u.id) ?? 0,
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
