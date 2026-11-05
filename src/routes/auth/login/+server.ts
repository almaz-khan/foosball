import { redirect } from '@sveltejs/kit';
import { redirectToHub, loginPage, safeNext, toHub } from '#lib/server/signin.ts';
import type { RequestHandler } from './$types';

/** "Sign in" on /login: off to the hub, and back to `next`. */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const next = safeNext(url.searchParams.get('next'));
  if (locals.session && !locals.session.hubCheckDue) redirect(303, next);
  let target: string;
  try {
    target = await redirectToHub(cookies, next, false);
  } catch (err) {
    console.warn(JSON.stringify({ event: 'hub_unreachable', reason: err instanceof Error ? err.message : String(err) }));
    redirect(303, loginPage('unavailable', next));
  }
  redirect(303, target, toHub());
};
