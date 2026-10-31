import { fail, redirect } from '@sveltejs/kit';
import { createEnrollment } from '#foosball/auth.ts';
import { formatWhen } from '#lib/dates.ts';
import { requireAdmin, requireSession, webauthn } from '#lib/server/auth.ts';
import { ROLES, type Role } from '#lib/server/db/schema.ts';
import { createInvite, InviteError, inviteHours, pendingInvites, revokeInvite, type InvitePlayer } from '#lib/server/invites.ts';
import { canIssueRecovery, linkPlayer, listMembers, MemberError, removeMember, setRole } from '#lib/server/members.ts';
import { listPlayers } from '#lib/server/players.ts';
import { UserError } from '#lib/server/users.ts';
import type { Actions, PageServerLoad } from './$types';

/** An admin's recovery link usually travels by chat: an hour, not the self-service fifteen minutes. */
const RECOVERY_MINUTES = 60;

export const load: PageServerLoad = async ({ locals }) => {
  const member = requireAdmin(locals);
  const zone = member.orgTimeZone;
  const [members, invites, players] = await Promise.all([
    listMembers(member.orgId),
    pendingInvites(member.orgId),
    listPlayers(member.orgId),
  ]);
  const linked = new Map(members.filter((m) => m.playerId !== null).map((m) => [m.playerId!, m.userName]));
  return {
    me: requireSession(locals).userId,
    members,
    invites: invites.map((i) => ({ ...i, expires: formatWhen(i.expiresAt, zone) })),
    players: players.map((p) => ({ id: p.id, name: p.name, linkedTo: linked.get(p.id) ?? null })),
    inviteHours: inviteHours(),
  };
};

const int = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Refusals the domain explains in words become a message on the page. */
async function attempt<T>(run: () => Promise<T>): Promise<T | ReturnType<typeof fail<{ message: string }>>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MemberError || err instanceof InviteError || err instanceof UserError) return fail(400, { message: err.message });
    throw err;
  }
}

export const actions: Actions = {
  invite: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    const form = await request.formData();
    const role = (ROLES as readonly string[]).includes(String(form.get('role'))) ? (String(form.get('role')) as Role) : 'member';
    let player: InvitePlayer = null;
    switch (form.get('player_mode')) {
      case 'existing': {
        const playerId = int(form.get('player_id'));
        if (!playerId) return fail(400, { message: 'Choose which player they are.' });
        player = { playerId };
        break;
      }
      case 'new':
        player = { firstName: String(form.get('first_name') ?? ''), lastName: String(form.get('last_name') ?? '') };
        break;
    }
    const invitedName = String(form.get('name') ?? '');
    return attempt(async () => {
      const { token, expiresAt } = await createInvite({
        orgId: member.orgId,
        invitedName,
        role,
        player,
        createdBy: requireSession(locals).userId,
      });
      return {
        invite: {
          name: invitedName.trim(),
          link: `${webauthn().origin}/invite/${token}`,
          expires: formatWhen(expiresAt, member.orgTimeZone),
        },
      };
    });
  },

  revokeInvite: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    await revokeInvite(member.orgId, String((await request.formData()).get('id') ?? ''));
    return { revoked: true };
  },

  setRole: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    const form = await request.formData();
    const userId = int(form.get('user_id'));
    const role = String(form.get('role'));
    if (!userId || !(ROLES as readonly string[]).includes(role)) return fail(400, { message: 'Choose a role.' });
    return attempt(async () => {
      if (!(await setRole(member.orgId, userId, role as Role))) return fail(404, { message: 'No such member.' });
      // An admin who steps down here can no longer see this page.
      if (userId === requireSession(locals).userId && role !== 'admin') redirect(303, '/');
      return { saved: true };
    });
  },

  linkPlayer: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    const form = await request.formData();
    const userId = int(form.get('user_id'));
    if (!userId) return fail(400, { message: 'No such member.' });
    const playerId = int(form.get('player_id'));
    return attempt(async () => {
      if (!(await linkPlayer(member.orgId, userId, playerId))) return fail(404, { message: 'No such member.' });
      return { saved: true };
    });
  },

  removeMember: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    const userId = int((await request.formData()).get('user_id'));
    if (!userId) return fail(400, { message: 'No such member.' });
    return attempt(async () => {
      if (!(await removeMember(member.orgId, userId))) return fail(404, { message: 'No such member.' });
      if (userId === requireSession(locals).userId) redirect(303, '/');
      return { saved: true };
    });
  },

  /** A link that adds a passkey to a member's account: for a lost or new device. */
  recoveryLink: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    const userId = int((await request.formData()).get('user_id'));
    const target = (await listMembers(member.orgId)).find((m) => m.userId === userId);
    if (!target) return fail(404, { message: 'No such member.' });
    if (!(await canIssueRecovery(requireSession(locals).userId, target.userId))) {
      return fail(403, {
        message: `${target.userName} is also in an org you don’t administer, so only an admin of every org they’re in can make this link.`,
      });
    }
    const { token } = await createEnrollment(target.userId, undefined, RECOVERY_MINUTES);
    return {
      recovery: {
        userId: target.userId,
        name: target.userName,
        link: `${webauthn().origin}/login?enroll=${token}`,
        minutes: RECOVERY_MINUTES,
      },
    };
  },
};
