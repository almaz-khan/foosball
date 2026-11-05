import type { Cookies } from '@sveltejs/kit';
import { LOGIN_COOKIE, LOGIN_MINUTES, saveLogin } from '#foosball/sessions.ts';
import { hubConfig, startLogin, type HubConfig } from './hub.ts';

let config: HubConfig | null = null;

/** Read once: a missing secret or a bad issuer fails loudly on the first request (and at start, see hooks). */
export function hub(): HubConfig {
  return (config ??= hubConfig());
}

/** Tests point Foosball at a fake hub (scripts/fakehub.ts); null goes back to the environment. */
export function useHub(next: HubConfig | null): void {
  config = next;
}

/** SvelteKit redirects off the site only to origins it is told about: the hub's. */
export const toHub = () => ({ external: [hub().issuer.origin] });

/** Whether cookies need `secure`: everywhere but plain-http localhost. */
const secure = () => hub().redirectUri.startsWith('https:');

export const sessionCookie = (expires: Date) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  // SvelteKit already drops `secure` on http://localhost only.
  secure: secure(),
  expires,
});

/** Only the callback ever reads it. Lax is enough: the hub sends the browser back with a top-level GET. */
export const loginCookie = () => ({
  path: '/auth/callback',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: secure(),
  maxAge: LOGIN_MINUTES * 60,
});

/** Only ever follow a local path after sign-in — never an absolute URL. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/**
 * Starts a sign-in at the hub and remembers it. Returns where to send the
 * browser, and the id the browser must bring back in LOGIN_COOKIE (set it with
 * loginCookie()). Throws when the hub can't be reached.
 */
export async function beginLogin(next: string, silent: boolean): Promise<{ target: string; loginId: string }> {
  const { url, pending } = await startLogin(hub(), { silent });
  const loginId = await saveLogin({ ...pending, next: safeNext(next), silent });
  return { target: url.href, loginId };
}

/** For a route: start a sign-in, set its cookie, and say where to go. */
export async function redirectToHub(cookies: Cookies, next: string, silent: boolean): Promise<string> {
  const { target, loginId } = await beginLogin(next, silent);
  cookies.set(LOGIN_COOKIE, loginId, loginCookie());
  return target;
}

/** Why /login is shown: the hub's answer, or something on the way. */
export const LOGIN_ERRORS = ['denied', 'method', 'failed', 'expired', 'unavailable'] as const;
export type LoginErrorCode = (typeof LOGIN_ERRORS)[number];

export function loginPage(error: LoginErrorCode | null, next = '/'): string {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  if (safeNext(next) !== '/') params.set('next', safeNext(next));
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}
