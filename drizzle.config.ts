import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
  schemaFilter: ['foosball'],
  // Must match MIGRATIONS in src/lib/server/db/index.ts.
  migrations: { schema: 'drizzle', table: '__foosball_migrations' },
  verbose: true,
  strict: true,
});
