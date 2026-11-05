import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { isRedirect } from '@sveltejs/kit';
import { sql as q } from 'drizzle-orm';
import { startFakeHub, type FakeHub } from '../scripts/fakehub.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { appUser, orgMember } from '../src/lib/server/db/schema.ts';
import { hubConfig } from '../src/lib/server/hub.ts';
import { createInvite } from '../src/lib/server/invites.ts';
import { createOrg, memberships, type Org } from '../src/lib/server/orgs.ts';
import { useHub } from '../src/lib/server/signin.ts';
import { validateSession } from '../src/sessions.ts';
import { freshDatabase } from './helpers/testdb.ts';

/*
 * Signing in through the login hub, end to end: the hook, the fake hub
 * (scripts/fakehub.ts, the same protocol as login.almaz.dev), the callback
 * route and the database, with a browser that keeps its cookies. Ported from
 * the budget app's tests/signin.test.ts.
 */

let db: Db;
let sql: Db['$client'];
let hub: FakeHub;
let office: Org;
/** Almaz: an account from the passkey era, the office's admin, not yet linked to the hub. */
let almaz: number;

const ORIGIN = 'http://localhost:5180';
const useFakeHub = () => useHub(hubConfig({ OIDC_ISSUER: hub.issuer, OIDC_CLIENT_SECRET: hub.clientSecret, FOOSBALL_ORIGIN: ORIGIN }));

beforeAll(async () => {
  hub = await startFakeHub();
  useFakeHub();
  db = await freshDatabase();
  sql = db.$client;
  // The routes reach the database through getDb(), which this points at the test database.
  globalThis.foosballDb = db;
});

afterAll(async () => {
  hub.stop();
  useHub(null);
  globalThis.foosballDb = undefined;
  await db.$client.end({ timeout: 5 });
});

beforeEach(async () => {
  hub.person = { sub: 'almaz', name: 'Almaz', amr: ['passkey'] };
  hub.signedIn = false;
  hub.denyAccess = false;
  hub.tamper = null;
  hub.log.length = 0;
  await db.execute(q`TRUNCATE foosball.org, foosball.app_user, foosball.hub_login RESTART IDENTITY CASCADE`);
  office = await createOrg('Office', 'office', db);
  [{ id: almaz }] = (await db.insert(appUser).values({ name: 'Almaz' }).returning({ id: appUser.id })) as [{ id: number }];
  await db.insert(orgMember).values({ orgId: office.id, userId: almaz, role: 'admin' });
});

const { handle } = await import('../src/hooks.server.ts');
const callbackRoute = await import('../src/routes/auth/callback/+server.ts');
const loginRoute = await import('../src/routes/auth/login/+server.ts');
const loginPage = await import('../src/routes/login/+page.server.ts');
const invitePage = await import('../src/routes/invite/[token]/+page.server.ts');

/** A browser: its cookies (name → value, with the path each was set for), and where it went. */
class Browser {
  cookies = new Map<string, { value: string; path: string }>();
  trail: string[] = [];

  /** The cookies SvelteKit hands a route or the hook, recording what it changes into the jar. */
  jar(pathname: string) {
    const sent = () =>
      Object.fromEntries([...this.cookies].filter(([, c]) => pathname.startsWith(c.path)).map(([n, c]) => [n, c.value]));
    const store = (name: string, value: string, options: { path?: string; maxAge?: number; expires?: Date }) => {
      const gone = options.maxAge === 0 || (options.expires && options.expires.getTime() < Date.now()) || value === '';
      if (gone) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: options.path ?? '/' });
    };
    return {
      get: (name: string) => sent()[name],
      getAll: () => Object.entries(sent()).map(([name, value]) => ({ name, value })),
      set: store,
      delete: (name: string, options: { path?: string }) => store(name, '', { ...options, maxAge: 0 }),
      serialize: (name: string, value: string, options: { path?: string; maxAge?: number; expires?: Date }) =>
        JSON.stringify({ name, value, ...options }),
    };
  }

  /** Set-Cookie headers on a response the hook built itself (serialized by jar().serialize above). */
  absorb(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const { name, value, ...options } = JSON.parse(header);
      this.jar('/').set(name, value, options);
    }
  }

  session() {
    return this.cookies.get('foosball_session')?.value;
  }

  /** Opens a page: through the hook, and wherever its redirects lead, until a page or an error page. */
  async open(path: string, options: { dataRequest?: boolean; method?: string; routeId?: string } = {}): Promise<{ status: number; at: string }> {
    let url = new URL(path, ORIGIN);
    for (let hop = 0; hop < 10; hop++) {
      this.trail.push(
        url.origin !== ORIGIN ? `hub${url.pathname}` : url.pathname === '/auth/callback' ? url.pathname : url.pathname + url.search,
      );
      let next: string | null;
      if (url.origin === hub.issuer) {
        const response = await fetch(url, { redirect: 'manual' });
        next = response.headers.get('location');
        if (!next) return { status: response.status, at: `hub${url.pathname}` };
      } else if (url.pathname === '/auth/callback' || url.pathname === '/auth/login' || url.pathname === '/login') {
        next = await this.route(url);
        if (!next) return { status: 200, at: url.pathname + url.search };
      } else {
        const response = await this.hook(url, options);
        if (response.status !== 303) return { status: response.status, at: url.pathname + url.search };
        next = response.headers.get('location');
      }
      url = new URL(next!, url);
      options = {};
    }
    throw new Error(`redirect loop: ${this.trail.join(' → ')}`);
  }

  /** The locals the hook made for the last page it let through. */
  locals: App.Locals | null = null;

  async hook(url: URL, options: { dataRequest?: boolean; method?: string; routeId?: string }): Promise<Response> {
    const event = {
      url,
      request: new Request(url, { method: options.method ?? 'GET' }),
      route: { id: options.routeId ?? url.pathname },
      isDataRequest: options.dataRequest ?? false,
      cookies: this.jar(url.pathname),
      locals: {} as App.Locals,
      getClientAddress: () => '203.0.113.50',
    };
    const response = await handle({
      event: event as never,
      resolve: (async () => {
        this.locals = event.locals;
        return new Response('the page');
      }) as never,
    });
    this.absorb(response);
    return response;
  }

  /** The sign-in routes, called as SvelteKit would after the hook. Returns where they redirect, or null for a page. */
  async route(url: URL): Promise<string | null> {
    const cookies = this.jar(url.pathname);
    const token = cookies.get('foosball_session');
    const session = token ? await validateSession(token) : null;
    const event = { url, cookies, locals: { session, memberships: [], member: null }, request: new Request(url) } as never;
    try {
      if (url.pathname === '/auth/callback') await callbackRoute.GET(event);
      else if (url.pathname === '/auth/login') await loginRoute.GET(event);
      else {
        this.page = await loginPage.load(event);
        return null;
      }
    } catch (err) {
      if (isRedirect(err)) return err.location;
      throw err;
    }
    throw new Error(`${url.pathname} answered without a redirect`);
  }

  page: unknown = null;
}

const userCount = async () => ((await sql`SELECT count(*)::int AS n FROM foosball.app_user`) as unknown as [{ n: number }])[0].n;

test('opening a page signed out goes through the hub and back to it, linking the existing account', async () => {
  const browser = new Browser();
  expect(await browser.open('/games?from=2026-01-01')).toEqual({ status: 200, at: '/games?from=2026-01-01' });
  expect(browser.trail).toEqual(['/games?from=2026-01-01', 'hub/authorize', '/auth/callback', '/games?from=2026-01-01']);
  expect(await validateSession(browser.session()!, db)).toMatchObject({ userId: almaz, userName: 'Almaz', hubCheckDue: false });
  const [row] = await sql`SELECT hub_sub FROM foosball.app_user WHERE id = ${almaz}`;
  expect(row!.hub_sub).toBe('almaz');
  // Still the office's admin: the hook found the membership.
  expect(browser.locals!.member).toMatchObject({ orgSlug: 'office', role: 'admin' });
  // The sign-in in progress is used up, and its cookie gone.
  expect(browser.cookies.has('foosball_login')).toBe(false);
  expect(((await sql`SELECT count(*)::int AS n FROM foosball.hub_login`) as unknown as [{ n: number }])[0].n).toBe(0);
});

test('the hub is asked for a sign-in for Foosball, with PKCE, and no secret in the URL', async () => {
  const browser = new Browser();
  const response = await browser.hook(new URL('/players', ORIGIN), {});
  const target = new URL(response.headers.get('location')!);
  expect(target.origin + target.pathname).toBe(`${hub.issuer}/authorize`);
  expect(target.searchParams.get('client_id')).toBe('foosball');
  expect(target.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
  expect(target.searchParams.get('code_challenge_method')).toBe('S256');
  expect(target.searchParams.has('prompt')).toBe(false);
  expect(browser.cookies.get('foosball_login')?.path).toBe('/auth/callback');
  expect(response.headers.get('x-frame-options')).toBe('DENY');
});

test('an invite opened signed out goes through the hub, and the new account joins with it', async () => {
  hub.person = { sub: 'ben', name: 'Ben Ng', amr: ['passkey'] };
  const { token } = await createInvite({ orgId: office.id, invitedName: 'Ben', player: { firstName: 'Ben', lastName: 'Ng' } }, db);
  const browser = new Browser();
  expect(await browser.open(`/invite/${token}`, { routeId: '/invite/[token]' })).toEqual({ status: 200, at: `/invite/${token}` });
  expect(browser.trail).toEqual([`/invite/${token}`, 'hub/authorize', '/auth/callback', `/invite/${token}`]);
  const session = (await validateSession(browser.session()!, db))!;
  expect(session.userName).toBe('Ben Ng');
  // Signed in, but in no org until they join.
  expect(browser.locals!.memberships).toEqual([]);
  const page = (await invitePage.load({ params: { token }, locals: browser.locals! } as never)) as {
    invite: { orgName: string; playerName: string } | null;
    signedInAs: string;
    alreadyMember: boolean;
  };
  expect(page).toMatchObject({ invite: { orgName: 'Office', playerName: 'Ben Ng' }, signedInAs: 'Ben Ng', alreadyMember: false });

  const join = await Promise.resolve()
    .then(() => invitePage.actions.join!({ params: { token }, locals: browser.locals!, cookies: browser.jar('/') } as never))
    .catch((err: unknown) => err);
  expect(isRedirect(join) && join.location).toBe('/');
  expect((await memberships(session.userId, db)).map((m) => [m.orgSlug, m.role, m.playerName])).toEqual([['office', 'member', 'Ben Ng']]);
  expect(browser.cookies.get('foosball_org')?.value).toBe('office');
});

test('someone new the hub lets in, without an invite, has an account in no org', async () => {
  hub.person = { sub: 'bob', name: 'Bob', amr: ['passkey'] };
  const browser = new Browser();
  expect((await browser.open('/')).at).toBe('/');
  expect(await userCount()).toBe(2);
  expect(browser.locals!.memberships).toEqual([]);
});

test('someone the hub refuses lands on /login with why, and no session', async () => {
  hub.denyAccess = true;
  const browser = new Browser();
  expect(await browser.open('/players')).toEqual({ status: 200, at: '/login?error=denied&next=%2Fplayers' });
  expect(browser.session()).toBeUndefined();
  expect(browser.page).toMatchObject({ error: 'denied', signInHref: '/auth/login?next=%2Fplayers' });
  expect(await userCount()).toBe(1);
});

test('a sign-in with Telegram alone is not enough', async () => {
  hub.person = { sub: 'almaz', name: 'Almaz', amr: ['telegram'] };
  const browser = new Browser();
  expect((await browser.open('/')).at).toBe('/login?error=method');
  expect(browser.session()).toBeUndefined();
});

test('a callback with no sign-in behind it (reloaded, or from another browser) goes to /login', async () => {
  const browser = new Browser();
  expect((await browser.open('/auth/callback?code=x&state=y')).at).toBe('/login?error=expired');
});

test('a forged callback is refused, and the sign-in it hijacked is used up', async () => {
  const victim = new Browser();
  await victim.hook(new URL('/', ORIGIN), {});
  // The attacker's own code, delivered to the victim's browser.
  const attacker = new Browser();
  const start = await attacker.hook(new URL('/', ORIGIN), {});
  const attackerCallback = (await fetch(start.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!;
  expect((await victim.open(attackerCallback)).at).toBe('/login?error=failed');
  expect(victim.session()).toBeUndefined();
});

test('/login with a session and nothing to report goes back to the app', async () => {
  const browser = new Browser();
  await browser.open('/');
  expect((await browser.open('/login?next=%2Fplayers')).at).toBe('/players');
});

test('"Sign in" on /login starts a sign-in at the hub', async () => {
  const browser = new Browser();
  expect((await browser.open('/auth/login?next=%2Faccount')).at).toBe('/account');
  expect(browser.trail).toEqual(['/auth/login?next=%2Faccount', 'hub/authorize', '/auth/callback', '/account']);
});

test('a day after the hub approved them, a page load re-checks silently and gets a new session', async () => {
  const browser = new Browser();
  await browser.open('/');
  const old = browser.session()!;
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '25 hours'`;
  expect((await browser.open('/players')).at).toBe('/players');
  expect(browser.trail.slice(-4)).toEqual(['/players', 'hub/authorize', '/auth/callback', '/players']);
  expect(browser.session()).not.toBe(old);
  expect(await validateSession(old, db)).toBeNull();
  expect((await validateSession(browser.session()!, db))!.hubCheckDue).toBe(false);
});

test('the re-check never interrupts a form post (a game being recorded) or a page’s data', async () => {
  const browser = new Browser();
  await browser.open('/');
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '25 hours'`;
  expect((await browser.open('/play', { method: 'POST' })).status).toBe(200);
  expect((await browser.open('/games/__data.json', { dataRequest: true, routeId: '/games' })).status).toBe(200);
});

test('signed out, a form post or a page’s data gets a plain 401, not a trip to the hub', async () => {
  const browser = new Browser();
  expect((await browser.open('/play', { method: 'POST' })).status).toBe(401);
  expect((await browser.open('/games/__data.json', { dataRequest: true, routeId: '/games' })).status).toBe(401);
  expect(hub.log).not.toContain('/authorize');
});

test('a re-check after the hub session has gone becomes a real sign-in at the hub', async () => {
  const browser = new Browser();
  await browser.open('/');
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '25 hours'`;
  hub.signedIn = false;
  expect((await browser.open('/players')).at).toBe('/players');
  expect(browser.trail.slice(-6)).toEqual(['/players', 'hub/authorize', '/auth/callback', 'hub/authorize', '/auth/callback', '/players']);
});

test('a re-check the hub refuses ends every session that person has', async () => {
  const phone = new Browser();
  const laptop = new Browser();
  await phone.open('/');
  await laptop.open('/');
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '25 hours'`;
  hub.denyAccess = true;
  expect((await laptop.open('/players')).at).toBe('/login?error=denied&next=%2Fplayers');
  expect(await validateSession(phone.session()!, db)).toBeNull();
  expect(laptop.session()).toBeUndefined();
});

test('while the hub is down, someone signed in carries on and someone signed out is told', async () => {
  const browser = new Browser();
  await browser.open('/');
  await sql`UPDATE foosball.user_session SET hub_checked_at = now() - interval '25 hours'`;
  useHub(hubConfig({ OIDC_ISSUER: 'http://localhost:9', OIDC_CLIENT_SECRET: 'x', FOOSBALL_ORIGIN: ORIGIN }));
  try {
    expect(await browser.open('/players')).toEqual({ status: 200, at: '/players' });
    expect((await new Browser().open('/players')).at).toBe('/login?error=unavailable&next=%2Fplayers');
  } finally {
    useFakeHub();
  }
});
