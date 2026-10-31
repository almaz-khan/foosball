import { error } from '@sveltejs/kit';
import { AuthError, authConfig, type AuthConfig } from '#foosball/auth.ts';
import { canManage, canRecord, type Membership } from './orgs.ts';

let config: AuthConfig | null = null;

/** Read once: a misconfigured origin should fail loudly on the first request. */
export function webauthn(): AuthConfig {
  return (config ??= authConfig());
}

export const sessionCookie = (expires: Date) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  // SvelteKit already drops `secure` on http://localhost only.
  secure: webauthn().origin.startsWith('https:'),
  expires,
});

/** The org the person last chose, for someone in more than one. */
export const ORG_COOKIE = 'foosball_org';

export const orgCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 365,
};

/** The membership a request acts on: the one the org cookie names, else the oldest. */
export function currentMembership(all: Membership[], slug: string | undefined): Membership | null {
  return all.find((m) => m.orgSlug === slug) ?? all[0] ?? null;
}

/** Only ever follow a local path after sign-in, never an absolute URL. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/**
 * AuthError messages are written for the person; anything else is a bug and
 * stays generic. Either way the server logs why, because "my phone can't sign
 * in" is otherwise undiagnosable. Nothing logged is secret: credential ids are
 * public identifiers, and only a prefix.
 */
export function authFailure(err: unknown, ceremony: 'login' | 'register', request: Request, body: unknown) {
  const response = (body as { response?: { id?: string; rawId?: string; response?: { userHandle?: string } } })
    ?.response;
  console.warn(
    JSON.stringify({
      event: `passkey_${ceremony}_rejected`,
      reason: err instanceof Error ? err.message : String(err),
      expected: err instanceof AuthError,
      ...(err instanceof AuthError ? err.diagnostics : {}),
      credentialId: response?.id?.slice(0, 16) ?? null,
      idMatchesRawId: response ? response.id === response.rawId : null,
      userHandle: response?.response?.userHandle === undefined ? 'absent' : 'present',
      userAgent: request.headers.get('user-agent')?.slice(0, 120) ?? null,
    }),
  );
  if (err instanceof AuthError) return Response.json({ message: err.message }, { status: 400 });
  console.error(err);
  error(500, 'Something went wrong verifying the passkey.');
}

// ---------------------------------------------------------------- what a request may do

/** The signed-in person's account; hooks have already sent anyone signed out to /login. */
export function requireSession(locals: App.Locals): NonNullable<App.Locals['session']> {
  if (!locals.session) error(401, 'Sign in first.');
  return locals.session;
}

/** Any member of the current org may look. */
export function requireMember(locals: App.Locals): Membership {
  requireSession(locals);
  if (!locals.member) error(403, 'You are not a member of any org yet. Ask an admin for an invite.');
  return locals.member;
}

/** Recording games is for members who are a player. */
export function requireRecorder(locals: App.Locals): Membership & { playerId: number } {
  const member = requireMember(locals);
  if (!canRecord(member)) error(403, 'Only members linked to a player can record games. Ask an admin to link you.');
  return member as Membership & { playerId: number };
}

export function requireAdmin(locals: App.Locals): Membership {
  const member = requireMember(locals);
  if (!canManage(member)) error(403, 'Only the org’s admins can do that.');
  return member;
}
