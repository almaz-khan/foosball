/**
 * Playwright's web server: a fresh e2e database with an org, players, a few
 * games and invite links for the specs, a fake login hub (scripts/fakehub.ts)
 * that signs in whoever the specs name (e2e/hub.ts), then the production
 * build (`bun run build` first) on E2E_PORT.
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
const { createGame } = await import('../src/lib/server/games.ts');
const { startFakeHub } = await import('../scripts/fakehub.ts');
const { HUB_PORT } = await import('./hub.ts');

const db = await freshDatabase();
const office = await createOrg('Office', 'office', db);
const [ann, cat, dan, eve] = await Promise.all(
  [
    { firstName: 'Ann', lastName: 'Lee' },
    { firstName: 'Cat' },
    { firstName: 'Dan' },
    { firstName: 'Eve' },
  ].map((p) => createPlayer(office.id, p, db)),
);
// Three past games, as if imported: no recorder, so only an admin may change them.
const day = (d: number, h: number) => new Date(Date.UTC(2026, 9, d, h));
const seats = { red: { offense: ann!.id, defense: cat!.id }, blue: { offense: dan!.id, defense: eve!.id } };
await createGame(office.id, { startedAt: day(5, 9), endedAt: day(5, 10), red: { score: 10, ...seats.red }, blue: { score: 4, ...seats.blue }, source: 'reactApp' }, null, db);
await createGame(office.id, { startedAt: day(6, 9), endedAt: day(6, 10), red: { score: 6, ...seats.red }, blue: { score: 10, ...seats.blue } }, null, db);
await createGame(office.id, { startedAt: day(7, 9), endedAt: day(7, 10), red: { score: 10, offense: eve!.id, defense: cat!.id }, blue: { score: 9, offense: dan!.id, defense: ann!.id } }, null, db);

const links = {
  admin: (await createInvite({ orgId: office.id, invitedName: 'Ann', role: 'admin', player: { playerId: ann!.id } }, db)).token,
  newcomer: (await createInvite({ orgId: office.id, invitedName: 'Ben', player: { firstName: 'Ben', lastName: 'Ng' } }, db)).token,
  viewer: (await createInvite({ orgId: office.id, invitedName: 'Vic' }, db)).token,
};
await db.$client.end({ timeout: 5 });

mkdirSync(join(import.meta.dir, '.auth'), { recursive: true });
writeFileSync(join(import.meta.dir, '.auth', 'links.json'), JSON.stringify(links));

// Ann until a spec names someone else (e2e/hub.ts hubSignsIn).
const hub = await startFakeHub({ port: HUB_PORT, person: { sub: 'ann', name: 'Ann', amr: ['passkey'] } });

// What the built server reads at start-up. A production build assumes https
// unless PROTOCOL_HEADER says otherwise; the test browser sends that header,
// as the proxy in front of the real deployment does.
Object.assign(process.env, {
  DATABASE_URL: testDatabaseUrl(),
  FOOSBALL_ORIGIN: `http://localhost:${PORT}`,
  OIDC_ISSUER: hub.issuer,
  OIDC_CLIENT_SECRET: hub.clientSecret,
  PROTOCOL_HEADER: 'x-forwarded-proto',
  HOST: '127.0.0.1',
  PORT,
});
// Built by `bun run build`; a path, not a specifier, so type-checking does not need it to exist yet.
await import(join(import.meta.dir, '..', 'build', 'index.js'));
