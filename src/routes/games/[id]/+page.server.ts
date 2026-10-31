import { error, fail, redirect } from '@sveltejs/kit';
import { toDateTimeInput } from '#lib/dates.ts';
import { viewGame } from '#lib/game-view.ts';
import { requireMember, requireSession } from '#lib/server/auth.ts';
import { parseGameForm } from '#lib/server/game-form.ts';
import { deleteGame, GameError, getGame, updateGame } from '#lib/server/games.ts';
import { canEditGame, type Membership } from '#lib/server/orgs.ts';
import { listPlayers } from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

const gameId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) error(404, 'No such game.');
  return id;
};

/** The game, if this person may change it: its recorder, or an admin. */
async function editable(member: Membership, userId: number, id: number) {
  const game = await getGame(member.orgId, id);
  if (!game) error(404, 'No such game.');
  if (!canEditGame(member, userId, game.createdBy)) error(403, 'Only whoever recorded this game, or an admin, can change it.');
  return game;
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const member = requireMember(locals);
  const session = requireSession(locals);
  const game = await getGame(member.orgId, gameId(params.id));
  if (!game) error(404, 'No such game.');
  const zone = member.orgTimeZone;
  const canEdit = canEditGame(member, session.userId, game.createdBy);

  // The pickers offer the active roster, plus anyone archived who played in this game.
  const seated = new Set([game.red.offense.id, game.red.defense.id, game.blue.offense.id, game.blue.defense.id]);
  const players = canEdit
    ? (await listPlayers(member.orgId, { includeArchived: true })).filter((p) => !p.archived || seated.has(p.id))
    : [];

  return {
    game: viewGame(game, zone),
    canEdit,
    players,
    times: { startedAt: toDateTimeInput(game.startedAt, zone), endedAt: toDateTimeInput(game.endedAt, zone) },
    zone,
  };
};

export const actions: Actions = {
  save: async ({ locals, params, request }) => {
    const member = requireMember(locals);
    const id = gameId(params.id);
    await editable(member, requireSession(locals).userId, id);
    const parsed = parseGameForm(await request.formData(), member.orgTimeZone);
    if ('error' in parsed) return fail(400, { message: parsed.error });
    try {
      await updateGame(member.orgId, id, parsed.input);
    } catch (err) {
      if (err instanceof GameError) return fail(400, { message: err.message });
      throw err;
    }
    return { saved: true };
  },

  delete: async ({ locals, params }) => {
    const member = requireMember(locals);
    const id = gameId(params.id);
    await editable(member, requireSession(locals).userId, id);
    await deleteGame(member.orgId, id);
    redirect(303, '/games');
  },
};
