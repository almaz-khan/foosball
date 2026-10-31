import { fail, redirect } from '@sveltejs/kit';
import { createEnrollment, ENROLL_MINUTES, listPasskeys, renamePasskey, revokePasskey, SESSION_COOKIE } from '#foosball/auth.ts';
import { ORG_COOKIE, orgCookie, requireSession, webauthn } from '#lib/server/auth.ts';
import { DEFAULT_TIME_ZONE, formatDay } from '#lib/dates.ts';
import { renameUserById, UserError } from '#lib/server/users.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const session = requireSession(locals);
  const passkeys = await listPasskeys(session.userId);
  const zone = locals.member?.orgTimeZone ?? DEFAULT_TIME_ZONE;
  return {
    passkeys: passkeys.map((p) => ({
      id: p.id,
      name: p.name,
      current: p.id === session.credentialId,
      added: formatDay(p.createdAt, zone),
      lastUsed: p.lastUsedAt ? formatDay(p.lastUsedAt, zone) : null,
    })),
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

  renamePasskey: async ({ locals, request }) => {
    const session = requireSession(locals);
    const form = await request.formData();
    await renamePasskey(String(form.get('id') ?? ''), session.userId, String(form.get('name') ?? ''));
    return { passkeyRenamed: true };
  },

  /** Never the last one: with no passkey there is no way back in but an admin's link. */
  revokePasskey: async ({ locals, request, cookies }) => {
    const session = requireSession(locals);
    const id = String((await request.formData()).get('id') ?? '');
    const mine = await listPasskeys(session.userId);
    if (!mine.some((p) => p.id === id)) return fail(404, { passkeyError: 'No such passkey.' });
    if (mine.length === 1) {
      return fail(400, { passkeyError: 'This is your only passkey. Add another before removing it, or you’ll be locked out.' });
    }
    await revokePasskey(id, session.userId);
    // Removing the passkey this browser signed in with signs this browser out too.
    if (id === session.credentialId) {
      cookies.delete(SESSION_COOKIE, { path: '/' });
      redirect(303, '/login');
    }
    return { passkeyRevoked: true };
  },

  /** A short-lived link to open on another device (one without this browser's passkeys). */
  enrollLink: async ({ locals }) => {
    const session = requireSession(locals);
    const { token, expiresAt } = await createEnrollment(session.userId);
    return { enrollLink: `${webauthn().origin}/login?enroll=${token}`, enrollMinutes: ENROLL_MINUTES, enrollExpires: expiresAt };
  },

  switchOrg: async ({ locals, request, cookies }) => {
    requireSession(locals);
    const slug = String((await request.formData()).get('org') ?? '');
    if (!locals.memberships.some((m) => m.orgSlug === slug)) return fail(404, { orgError: 'You are not a member of that org.' });
    cookies.set(ORG_COOKIE, slug, orgCookie);
    redirect(303, '/');
  },
};
