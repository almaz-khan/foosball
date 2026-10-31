import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as runMigrations } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything a query can run on: the database, or a transaction inside it. */
export type Executor = Db | Tx;

/**
 * The migrator's bookkeeping lives in its own, separately named table, so the
 * instance can be shared with other apps. Must match `migrations` in drizzle.config.ts.
 */
export const MIGRATIONS = { migrationsSchema: 'drizzle', migrationsTable: '__foosball_migrations' } as const;
const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'drizzle');

/** A database handle for an explicit URL: tests, scripts. The app uses getDb(). */
export function createDb(url: string): Db {
  const client = postgres(url, { onnotice: () => {}, idle_timeout: 20 });
  return drizzle(client, { schema, logger: process.env.DRIZZLE_QUERY_LOG === 'true' });
}

declare global {
  // Survives Vite's server reloads in dev.
  var foosballDb: Db | undefined;
}

export function getDb(): Db {
  if (globalThis.foosballDb) return globalThis.foosballDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run `bun run db:up`.');
  }
  return (globalThis.foosballDb = createDb(url));
}

export async function closeDb(): Promise<void> {
  const db = globalThis.foosballDb;
  globalThis.foosballDb = undefined;
  await db?.$client.end({ timeout: 5 });
}

/**
 * Applies the migrations drizzle-kit generated into ./drizzle. Runs from the
 * image (Railway's pre-deploy step), where the database is reachable, so
 * drizzle-kit is never needed in production.
 */
export async function migrate(db: Db = getDb()): Promise<void> {
  await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER, ...MIGRATIONS });
}
