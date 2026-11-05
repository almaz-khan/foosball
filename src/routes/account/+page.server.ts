import { fail, redirect } from '@sveltejs/kit';
import { ORG_COOKIE, orgCookie, requireSession } from '#lib/server/auth.ts';
import { hub } from '#lib/server/signin.ts';
import { renameUserById, UserError } from '#lib/server/users.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requireSession(locals);
  return {
    // Passkeys live at the hub; its home page adds and removes them.
    hubUrl: hub().issuer.href,
    hubHost: hub().issuer.host,
    orgs: locals.memberships.map((m) => ({
      slug: m.orgSlug,
      name: m.orgName,
      role: m.role,
      playerName: m.playerName,
      current: m.orgId === locals.member?.orgId,
    })),
  };
};

export const actions: Actions = {
  rename: async ({ locals, request }) => {
    const session = requireSession(locals);
    try {
      await renameUserById(session.userId, String((await request.formData()).get('name') ?? ''));
    } catch (err) {
      if (err instanceof UserError) return fail(400, { nameError: err.message });
      throw err;
    }
    return { renamed: true };
  },

  switchOrg: async ({ locals, request, cookies }) => {
    requireSession(locals);
    const slug = String((await request.formData()).get('org') ?? '');
    if (!locals.memberships.some((m) => m.orgSlug === slug)) return fail(404, { orgError: 'You are not a member of that org.' });
    cookies.set(ORG_COOKIE, slug, orgCookie);
    redirect(303, '/');
  },
};
