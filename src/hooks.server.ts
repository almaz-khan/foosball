import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
import { LOGIN_COOKIE, SESSION_COOKIE, validateSession } from '#foosball/sessions.ts';
import { currentMembership, ORG_COOKIE } from '#lib/server/auth.ts';
import { memberships } from '#lib/server/orgs.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';
import { beginLogin, hub, loginCookie, loginPage, sessionCookie } from '#lib/server/signin.ts';

// No client secret, no Foosball: refuse to start rather than serve pages nobody
// can sign in to. A deploy without it never takes traffic.
export const init: ServerInit = () => {
  hub();
};

// A sign-in is a few requests (start, callback, perhaps a second start);
// twenty a minute is generous for a person and useless for a flood. The global
// cap bounds a distributed one. Every one of them writes a row.
const authLimiter = createLimiter({ perClient: 20, global: 300, windowMs: 60_000 });

// Everything is behind a sign-in at the hub except the routes that run it.
// An invite too: opened signed out, it goes to the hub and comes back to join.
const PUBLIC_ROUTES = ['/login', '/auth/', '/healthz'];

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const token = event.cookies.get(SESSION_COOKIE);
  const session = token ? await validateSession(token) : null;

  const routeId = event.route.id ?? '';
  const isPublic = PUBLIC_ROUTES.some((p) => routeId === p || routeId.startsWith(p));
  // A page someone opens, as opposed to a form post or the data a page fetches:
  // only these go to the hub, so a game being recorded is never lost on the way.
  const pageView = event.request.method === 'GET' && !event.isDataRequest;
  const toHub = !isPublic && pageView && (!session || session.hubCheckDue);

  if (path.startsWith('/auth/') || toHub || (event.request.method === 'POST' && path.startsWith('/invite/'))) {
    // Behind Railway the client's address arrives in X-Real-IP, which the edge
    // sets; adapter-node reads it when ADDRESS_HEADER=X-Real-IP (see README).
    let client = 'unknown';
    try {
      client = event.getClientAddress();
    } catch {
      // No address available (some dev setups): only the global cap applies.
    }
    const verdict = authLimiter(client);
    if (!verdict.ok) {
      return new Response('Too many attempts. Wait a minute and try again.', {
        status: 429,
        headers: { ...SECURITY_HEADERS, 'retry-after': String(verdict.retryAfterS) },
      });
    }
  }

  event.locals.session = session;
  event.locals.memberships = session ? await memberships(session.userId) : [];
  event.locals.member = currentMembership(event.locals.memberships, event.cookies.get(ORG_COOKIE));

  if (token && !session) event.cookies.delete(SESSION_COOKIE, { path: '/' });
  if (token && session?.renewed) event.cookies.set(SESSION_COOKIE, token, sessionCookie(session.expiresAt));

  if (toHub) {
    const response = await throughHub(event, token, session !== null);
    if (response) return response;
  }
  if (!session && !isPublic) {
    // Form posts and data requests get a plain 401: the page they came from goes to the hub on its next load.
    const headers = new Headers(SECURITY_HEADERS);
    if (token) headers.append('set-cookie', event.cookies.serialize(SESSION_COOKIE, '', { ...sessionCookie(new Date(0)), maxAge: 0 }));
    return new Response('Sign in first.', { status: 401, headers });
  }

  const response = await resolve(event);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
};

/**
 * Off to the hub and back to this page: a sign-in for someone signed out, a
 * silent re-check (prompt=none) for a session the hub approved over a day ago.
 * Kit adds cookie changes only to what resolve() returns, so a response built
 * here carries its cookies itself.
 */
async function throughHub(event: RequestEvent, token: string | undefined, signedIn: boolean): Promise<Response | null> {
  const next = event.url.pathname + event.url.search;
  const headers = new Headers(SECURITY_HEADERS);
  try {
    const { target, loginId } = await beginLogin(next, signedIn);
    headers.set('location', target);
    headers.append('set-cookie', event.cookies.serialize(LOGIN_COOKIE, loginId, loginCookie()));
  } catch (err) {
    console.warn(JSON.stringify({ event: 'hub_unreachable', reason: err instanceof Error ? err.message : String(err), recheck: signedIn }));
    // The hub is down. Someone signed in carries on, and is re-checked once
    // it is back; anyone else can't sign in now, and is told so.
    if (signedIn) return null;
    headers.set('location', loginPage('unavailable', next));
  }
  if (token && !signedIn) {
    headers.append('set-cookie', event.cookies.serialize(SESSION_COOKIE, '', { ...sessionCookie(new Date(0)), maxAge: 0 }));
  }
  return new Response(null, { status: 303, headers });
}

// Nothing here is ever framed, sniffed or referred onward, and in production
// it is only ever served over HTTPS.
const SECURITY_HEADERS: Record<string, string> = {
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  ...(process.env.FOOSBALL_ORIGIN?.startsWith('https:')
    ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
    : {}),
};
