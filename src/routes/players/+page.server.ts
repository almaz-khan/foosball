import { fail, redirect } from '@sveltejs/kit';
import { requireAdmin, requireMember } from '#lib/server/auth.ts';
import { listMembers } from '#lib/server/members.ts';
import { createPlayer, listPlayers, PlayerError } from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const member = requireMember(locals);
  const archived = url.searchParams.has('archived');
  const [players, members] = await Promise.all([
    listPlayers(member.orgId, { includeArchived: true }),
    listMembers(member.orgId),
  ]);
  const accountOf = new Map(members.filter((m) => m.playerId !== null).map((m) => [m.playerId!, m.userName]));
  return {
    players: players
      .filter((p) => p.archived === archived)
      .map((p) => ({ ...p, account: accountOf.get(p.id) ?? null })),
    archived,
    archivedCount: players.filter((p) => p.archived).length,
  };
};

export const actions: Actions = {
  add: async ({ locals, request }) => {
    const member = requireAdmin(locals);
    const form = await request.formData();
    let id: number;
    try {
      id = (
        await createPlayer(member.orgId, {
          firstName: String(form.get('first_name') ?? ''),
          lastName: String(form.get('last_name') ?? ''),
        })
      ).id;
    } catch (err) {
      if (err instanceof PlayerError) return fail(400, { message: err.message });
      throw err;
    }
    redirect(303, `/players/${id}`);
  },
};
