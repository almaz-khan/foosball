import { fail, redirect } from '@sveltejs/kit';
import { ORG_COOKIE, orgCookie, webauthn } from '#lib/server/auth.ts';
import { acceptInvite, inviteFor, InviteError } from '#lib/server/invites.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const invite = await inviteFor(params.token);
  let wrongOrigin: string | null = null;
  try {
    const { origin } = webauthn();
    if (origin !== url.origin) wrongOrigin = origin;
  } catch {
    // The sign-in page explains a misconfigured origin; here the link just can't be used.
  }
  return {
    invite,
    signedInAs: locals.session?.userName ?? null,
    alreadyMember: invite !== null && locals.memberships.some((m) => m.orgId === invite.orgId),
    wrongOrigin,
  };
};

export const actions: Actions = {
  /** Someone already signed in joins with the account they have: no new passkey. */
  join: async ({ params, locals, cookies }) => {
    if (!locals.session) return fail(401, { message: 'Sign in first, or create an account with this invite.' });
    const invite = await inviteFor(params.token);
    try {
      await acceptInvite(params.token, locals.session.userId);
    } catch (err) {
      if (err instanceof InviteError) return fail(400, { message: err.message });
      throw err;
    }
    if (invite) cookies.set(ORG_COOKIE, invite.orgSlug, orgCookie);
    redirect(303, '/');
  },
};
