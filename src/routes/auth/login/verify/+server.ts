import { SESSION_COOKIE, createSession, verifyLogin } from '#foosball/auth.ts';
import { authFailure, safeNext, sessionCookie, webauthn } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  try {
    const { credentialId } = await verifyLogin(
      { challengeId: String(body.challengeId), response: body.response },
      webauthn(),
    );
    const session = await createSession(credentialId);
    cookies.set(SESSION_COOKIE, session.token, sessionCookie(session.expiresAt));
    return Response.json({ next: safeNext(body.next) });
  } catch (err) {
    return authFailure(err, 'login', request, body);
  }
};
