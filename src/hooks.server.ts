import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, validateSession } from '#foosball/auth.ts';
import { currentMembership, ORG_COOKIE, sessionCookie } from '#lib/server/auth.ts';
import { memberships } from '#lib/server/orgs.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';

// A sign-in is two requests (options, verify); twenty a minute is generous for
// a person and useless for a flood. The global cap bounds a distributed one.
const authLimiter = createLimiter({ perClient: 20, global: 300, windowMs: 60_000 });

// Everything is for an org's members except the pages that let you become one.
const PUBLIC_ROUTES = ['/login', '/invite/', '/auth/', '/healthz'];

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  if (event.request.method === 'POST' && (path.startsWith('/auth/') || path.startsWith('/invite/'))) {
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

  const token = event.cookies.get(SESSION_COOKIE);
  const session = token ? await validateSession(token) : null;
  event.locals.session = session;
  event.locals.memberships = session ? await memberships(session.userId) : [];
  event.locals.member = currentMembership(event.locals.memberships, event.cookies.get(ORG_COOKIE));

  if (token && !session) event.cookies.delete(SESSION_COOKIE, { path: '/' });
  if (token && session?.renewed) event.cookies.set(SESSION_COOKIE, token, sessionCookie(session.expiresAt));

  const routeId = event.route.id ?? '';
  const isPublic = PUBLIC_ROUTES.some((p) => routeId === p || routeId.startsWith(p));
  if (!session && !isPublic) {
    // Form posts and data requests get a plain 401; a page view goes to sign-in and back.
    if (event.request.method !== 'GET' || event.isDataRequest) {
      return new Response('Sign in first.', { status: 401, headers: SECURITY_HEADERS });
    }
    const next = path + event.url.search;
    const location = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
    return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, location } });
  }

  const response = await resolve(event);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
};

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
