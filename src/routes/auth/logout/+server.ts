import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, deleteSession } from '#foosball/sessions.ts';
import { logoutUrl } from '#lib/server/hub.ts';
import { hub, toHub } from '#lib/server/signin.ts';
import type { RequestHandler } from './$types';

/** Ends Foosball's session, then goes on to the hub's "Sign out everywhere?", which comes back to /login. */
export const POST: RequestHandler = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE);
  if (token) await deleteSession(token);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  redirect(303, logoutUrl(hub()).href, toHub());
};
