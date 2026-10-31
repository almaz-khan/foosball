import { fail, redirect } from '@sveltejs/kit';
import { requireRecorder, requireSession } from '#lib/server/auth.ts';
import { parseGameForm } from '#lib/server/game-form.ts';
import { createGame, GameError } from '#lib/server/games.ts';
import { createPlayer, listPlayers, PlayerError } from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const member = requireRecorder(locals);
  return {
    players: await listPlayers(member.orgId),
    me: member.playerId,
    /** Where this browser keeps the game in progress: one per org. */
    storageKey: `foosball.play.${member.orgSlug}`,
  };
};

export const actions: Actions = {
  /** A guest at the table: anyone who records may add them; the roster's admins tidy up later. */
  addPlayer: async ({ locals, request }) => {
    const member = requireRecorder(locals);
    const form = await request.formData();
    try {
      const player = await createPlayer(member.orgId, {
        firstName: String(form.get('first_name') ?? ''),
        lastName: String(form.get('last_name') ?? ''),
      });
      return { added: { id: player.id, name: player.name } };
    } catch (err) {
      if (err instanceof PlayerError) return fail(400, { addError: err.message });
      throw err;
    }
  },

  save: async ({ locals, request }) => {
    const member = requireRecorder(locals);
    const parsed = parseGameForm(await request.formData(), member.orgTimeZone);
    if ('error' in parsed) return fail(400, { saveError: parsed.error });
    let id: number;
    try {
      id = await createGame(member.orgId, { ...parsed.input, source: 'web' }, requireSession(locals).userId);
    } catch (err) {
      if (err instanceof GameError) return fail(400, { saveError: err.message });
      throw err;
    }
    redirect(303, `/games/${id}?saved`);
  },
};
