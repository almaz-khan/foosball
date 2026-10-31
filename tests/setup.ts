import { testDatabaseUrl } from './helpers/testdb.ts';

// bun loads .env, so DATABASE_URL would be the real database. Anything that
// reaches getDb() without a handle passed in must land on the throwaway test
// database instead, never on real data.
process.env.DATABASE_URL = testDatabaseUrl();
