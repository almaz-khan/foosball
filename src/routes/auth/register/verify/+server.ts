import { SESSION_COOKIE, createSession, registerPasskey } from '#foosball/auth.ts';
import { authFailure, ORG_COOKIE, orgCookie, sessionCookie, webauthn } from '#lib/server/auth.ts';
import { inviteFor } from '#lib/server/invites.ts';
import { authorityFrom } from '../authority.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const authority = authorityFrom(body, locals);
  if (!authority) return Response.json({ message: 'Sign in first.' }, { status: 401 });

  // Read before the invite is spent: which org to open once signed in.
  const joining = authority.kind === 'invite' ? await inviteFor(authority.token) : null;
  try {
    const { credentialId, userId } = await registerPasskey(
      { challengeId: String(body.challengeId), response: body.response, name: String(body.name ?? '') },
      authority,
      webauthn(),
    );
    // A link signs this browser in as the passkey's account, replacing any
    // session for someone else (e.g. on a shared computer).
    if (locals.session?.userId !== userId) {
      const session = await createSession(credentialId);
      cookies.set(SESSION_COOKIE, session.token, sessionCookie(session.expiresAt));
    }
    if (joining) cookies.set(ORG_COOKIE, joining.orgSlug, orgCookie);
    return Response.json({ ok: true });
  } catch (err) {
    return authFailure(err, 'register', request, body);
  }
};
