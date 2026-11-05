import { redirect } from '@sveltejs/kit';
import { LOGIN_ERRORS, hub, safeNext, type LoginErrorCode } from '#lib/server/signin.ts';
import type { PageServerLoad } from './$types';

/**
 * Seen only when a sign-in didn't complete, or after signing out: anyone else
 * goes straight to the hub from whatever page they opened.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
  const next = safeNext(url.searchParams.get('next'));
  const raw = url.searchParams.get('error');
  const error = LOGIN_ERRORS.includes(raw as LoginErrorCode) ? (raw as LoginErrorCode) : null;
  if (locals.session && !error) redirect(303, next);
  return {
    error,
    signInHref: next === '/' ? '/auth/login' : `/auth/login?next=${encodeURIComponent(next)}`,
    hubHost: hub().issuer.host,
  };
};
