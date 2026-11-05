import { redirect } from '@sveltejs/kit';
import { LOGIN_COOKIE, SESSION_COOKIE, createSession, deleteSession, deleteUserSessions, takeLogin, userForHubPerson } from '#foosball/sessions.ts';
import { HubLoginError, finishLogin } from '#lib/server/hub.ts';
import { redirectToHub, hub, loginCookie, loginPage, sessionCookie, toHub, type LoginErrorCode } from '#lib/server/signin.ts';
import type { RequestHandler } from './$types';

const ERROR_PAGE: Record<Exclude<HubLoginError['code'], 'login_required'>, LoginErrorCode> = {
  access_denied: 'denied',
  wrong_method: 'method',
  failed: 'failed',
};

/** The hub sends the browser back here, with a code or with why not. */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const id = cookies.get(LOGIN_COOKIE);
  cookies.delete(LOGIN_COOKIE, { path: loginCookie().path });
  const login = id ? await takeLogin(id) : null;
  if (!login) {
    // Reloaded, or opened in another browser: nothing to finish. Someone signed in just carries on.
    redirect(303, locals.session ? '/' : loginPage('expired'));
  }

  let person;
  try {
    person = await finishLogin(hub(), url, login);
  } catch (err) {
    if (!(err instanceof HubLoginError)) throw err;
    console.warn(JSON.stringify({ event: 'hub_login_refused', code: err.code, reason: err.reason, silent: login.silent }));
    // The silent re-check found no hub session: now a real sign-in, at the hub.
    if (err.code === 'login_required') {
      let target: string;
      try {
        target = await redirectToHub(cookies, login.next, false);
      } catch {
        redirect(303, loginPage('unavailable', login.next));
      }
      redirect(303, target, toHub());
    }
    // The hub says this person may no longer open Foosball: every session of theirs ends.
    if (err.code === 'access_denied' && locals.session) await deleteUserSessions(locals.session.userId);
    if (err.code !== 'failed') {
      const token = cookies.get(SESSION_COOKIE);
      if (token) await deleteSession(token);
      cookies.delete(SESSION_COOKIE, { path: '/' });
    }
    redirect(303, loginPage(ERROR_PAGE[err.code], login.next));
  }

  const { userId, created, linked } = await userForHubPerson(person);
  // A new session for every sign-in: the old cookie's, if any, ends.
  const old = cookies.get(SESSION_COOKIE);
  if (old) await deleteSession(old);
  const session = await createSession(userId);
  cookies.set(SESSION_COOKIE, session.token, sessionCookie(session.expiresAt));
  console.info(JSON.stringify({ event: 'hub_login', sub: person.sub, userId, created, linked, silent: login.silent }));
  redirect(303, login.next);
};
