import { AuthError, registrationOptions, registrationSubject } from '#foosball/auth.ts';
import { webauthn } from '#lib/server/auth.ts';
import { authorityFrom } from '../authority.ts';
import type { RequestHandler } from './$types';

// A passkey is created for the account an invite will create, the account an
// enrollment link names, or else the signed-in person adding a device.
export const POST: RequestHandler = async ({ request, locals }) => {
  const authority = authorityFrom(await request.json().catch(() => ({})), locals);
  if (!authority) return Response.json({ message: 'Sign in first.' }, { status: 401 });
  try {
    return Response.json(await registrationOptions(await registrationSubject(authority), webauthn()));
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ message: err.message }, { status: 400 });
    throw err;
  }
};
