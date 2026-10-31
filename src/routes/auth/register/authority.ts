import type { RegisterAuthority } from '#foosball/auth.ts';

/**
 * Where the right to create a passkey comes from, for both steps of the
 * ceremony: an invite (creates the account), an enrollment link (adds to the
 * account it names), or else the signed-in person adding a device. A link is
 * spent whenever it is used, even by a browser that is already signed in.
 */
export function authorityFrom(
  body: { invite?: unknown; enroll?: unknown; userName?: unknown },
  locals: App.Locals,
): RegisterAuthority | null {
  if (body.invite) return { kind: 'invite', token: String(body.invite), userName: String(body.userName ?? '') };
  if (body.enroll) return { kind: 'enrollment', token: String(body.enroll) };
  if (locals.session) return { kind: 'session', userId: locals.session.userId };
  return null;
}
