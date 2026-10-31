import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createDb, migrate, MIGRATIONS, type Db } from '../../src/lib/server/db/index.ts';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5434/postgres';
const TEST_DB = process.env.TEST_DB_NAME ?? 'foosball_test';

export const testDatabaseUrl = () =>
  process.env.TEST_DATABASE_URL ?? ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);

/**
 * Never runs against the real database: tests get their own, created on
 * demand and migrated from scratch.
 */
export async function freshDatabase(): Promise<Db> {
  const admin = postgres(ADMIN_URL, { idle_timeout: 1, max: 1, onnotice: () => {} });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const db = createDb(testDatabaseUrl());
  await db.execute(sql`DROP SCHEMA IF EXISTS foosball CASCADE`);
  await db.execute(
    sql`DROP TABLE IF EXISTS ${sql.identifier(MIGRATIONS.migrationsSchema)}.${sql.identifier(MIGRATIONS.migrationsTable)}`,
  );
  await migrate(db);
  return db;
}
