import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';

/** A secret for a link or cookie: 256 random bits, URL-safe. */
export const newToken = () => randomBytes(32).toString('base64url');

/** What the database keeps instead of the secret itself. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Expiries are computed by the database clock, as every comparison against now() is. */
export const inMinutes = (minutes: number) => sql<Date>`now() + make_interval(mins => ${minutes})`;
export const inDays = (days: number) => sql<Date>`now() + make_interval(days => ${days})`;
export const now = sql`now()`;
