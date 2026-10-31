import { getDb } from '#lib/server/db/index.ts';
import { org } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

// Railway's deploy health check: a new release takes traffic only once it
// answers here, which needs the database reachable and migrated. Public, and
// reveals nothing but "ok".
export const GET: RequestHandler = async () => {
  try {
    await getDb().select({ id: org.id }).from(org).limit(1);
    return new Response('ok', { headers: { 'cache-control': 'no-store' } });
  } catch {
    return new Response('database unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
};
