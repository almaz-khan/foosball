import { parseDay, parseDayEnd } from '#lib/dates.ts';
import { viewGame } from '#lib/game-view.ts';
import { requireMember } from '#lib/server/auth.ts';
import { listGames } from '#lib/server/games.ts';
import { listPlayers } from '#lib/server/players.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const member = requireMember(locals);
  const zone = member.orgTimeZone;
  const q = url.searchParams;
  const playerId = Number(q.get('player')) || undefined;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';

  const [page, players] = await Promise.all([
    listGames(member.orgId, {
      playerId,
      from: parseDay(from, zone) ?? undefined,
      to: parseDayEnd(to, zone) ?? undefined,
      cursor: q.get('cursor'),
      limit: 30,
    }),
    listPlayers(member.orgId, { includeArchived: true }),
  ]);

  const now = new Date();
  return {
    games: page.games.map((g) => viewGame(g, zone, now)),
    next: page.next,
    paged: q.has('cursor'),
    players,
    filter: { player: playerId ?? null, from, to },
  };
};
