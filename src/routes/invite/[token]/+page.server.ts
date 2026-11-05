import { fail, redirect } from '@sveltejs/kit';
import { ORG_COOKIE, orgCookie, requireSession } from '#lib/server/auth.ts';
import { acceptInvite, inviteFor, InviteError } from '#lib/server/invites.ts';
import type { Actions, PageServerLoad } from './$types';

/** Opened signed out, an invite goes through the hub first (hooks) and comes back here to join. */
export const load: PageServerLoad = async ({ params, locals }) => {
  const session = requireSession(locals);
  const invite = await inviteFor(params.token);
  return {
    invite,
    signedInAs: session.userName,
    alreadyMember: invite !== null && locals.memberships.some((m) => m.orgId === invite.orgId),
  };
};

export const actions: Actions = {
  /** Joins with the account the hub signed them in to. */
  join: async ({ params, locals, cookies }) => {
    if (!locals.session) return fail(401, { message: 'Sign in first.' });
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
