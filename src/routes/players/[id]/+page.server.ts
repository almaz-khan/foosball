import { error, fail, redirect } from '@sveltejs/kit';
import { viewGame } from '#lib/game-view.ts';
import { requireAdmin, requireMember } from '#lib/server/auth.ts';
import { listGames } from '#lib/server/games.ts';
import { listMembers } from '#lib/server/members.ts';
import { getPlayer, PlayerError, removePlayer, restorePlayer, updatePlayer } from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

const playerId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) error(404, 'No such player.');
  return id;
};

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const member = requireMember(locals);
  const id = playerId(params.id);
  const [player, members, page] = await Promise.all([
    getPlayer(member.orgId, id),
    listMembers(member.orgId),
    listGames(member.orgId, { playerId: id, cursor: url.searchParams.get('cursor'), limit: 30 }),
  ]);
  if (!player) error(404, 'No such player.');
  const now = new Date();
  return {
    player,
    account: members.find((m) => m.playerId === id)?.userName ?? null,
    isMe: member.playerId === id,
    games: page.games.map((g) => viewGame(g, member.orgTimeZone, now)),
    next: page.next,
    paged: url.searchParams.has('cursor'),
  };
};

export const actions: Actions = {
  rename: async ({ locals, params, request }) => {
    const member = requireAdmin(locals);
    const form = await request.formData();
    try {
      const updated = await updatePlayer(member.orgId, playerId(params.id), {
        firstName: String(form.get('first_name') ?? ''),
        lastName: String(form.get('last_name') ?? ''),
      });
      if (!updated) error(404, 'No such player.');
    } catch (err) {
      if (err instanceof PlayerError) return fail(400, { message: err.message });
      throw err;
    }
    return { saved: true };
  },

  /** Archived if they have games (history stays), deleted if not. */
  remove: async ({ locals, params }) => {
    const member = requireAdmin(locals);
    const outcome = await removePlayer(member.orgId, playerId(params.id));
    if (!outcome) error(404, 'No such player.');
    redirect(303, outcome === 'archived' ? `/players/${params.id}` : '/players');
  },

  restore: async ({ locals, params }) => {
    const member = requireAdmin(locals);
    if (!(await restorePlayer(member.orgId, playerId(params.id)))) error(404, 'No such player.');
    return { restored: true };
  },
};
