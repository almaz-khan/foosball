/**
 * Playwright's web server: a fresh e2e database with an org and invite links
 * for the specs, then the production build (`bun run build` first) on E2E_PORT.
 *
 * Its own database, foosball_e2e, so an e2e run and `bun test` never trample
 * each other's data; never the one in .env.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.E2E_PORT ?? '5182';
process.env.TEST_DB_NAME = 'foosball_e2e';

const { freshDatabase, testDatabaseUrl } = await import('../tests/helpers/testdb.ts');
const { createOrg } = await import('../src/lib/server/orgs.ts');
const { createPlayer } = await import('../src/lib/server/players.ts');
const { createInvite } = await import('../src/lib/server/invites.ts');

const db = await freshDatabase();
const office = await createOrg('Office', 'office', db);
const ann = await createPlayer(office.id, { firstName: 'Ann', lastName: 'Lee' }, db);
const links = {
  admin: (await createInvite({ orgId: office.id, invitedName: 'Ann', role: 'admin', player: { playerId: ann.id } }, db)).token,
  viewer: (await createInvite({ orgId: office.id, invitedName: 'Vic' }, db)).token,
};
await db.$client.end({ timeout: 5 });

mkdirSync(join(import.meta.dir, '.auth'), { recursive: true });
writeFileSync(join(import.meta.dir, '.auth', 'links.json'), JSON.stringify(links));

// What the built server reads at start-up. A production build assumes https
// unless PROTOCOL_HEADER says otherwise; the test browser sends that header,
// as the proxy in front of the real deployment does.
Object.assign(process.env, {
  DATABASE_URL: testDatabaseUrl(),
  FOOSBALL_ORIGIN: `http://localhost:${PORT}`,
  PROTOCOL_HEADER: 'x-forwarded-proto',
  HOST: '127.0.0.1',
  PORT,
});
// Built by `bun run build`; a path, not a specifier, so type-checking does not need it to exist yet.
await import(join(import.meta.dir, '..', 'build', 'index.js'));
