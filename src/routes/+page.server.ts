import { PERIODS, periodStart, type PeriodName } from '#lib/dates.ts';
import { viewGame } from '#lib/game-view.ts';
import { listGames } from '#lib/server/games.ts';
import { standings } from '#lib/server/standings.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const member = locals.member;
  // Signed in but in no org: the page says how to get in.
  if (!member) return { dashboard: null };

  const asked = url.searchParams.get('period');
  const period: PeriodName = PERIODS.includes(asked as PeriodName) ? (asked as PeriodName) : 'all';
  const now = new Date();
  const from = periodStart(period, member.orgTimeZone, now) ?? undefined;

  const [table, recent] = await Promise.all([
    standings(member.orgId, { from }),
    listGames(member.orgId, { from, limit: 6 }),
  ]);
  const games = table.reduce((n, s) => n + s.played, 0) / 4;

  return {
    dashboard: {
      period,
      standings: table,
      recent: recent.games.map((g) => viewGame(g, member.orgTimeZone, now)),
      games,
      me: member.playerId === null ? null : (table.find((s) => s.playerId === member.playerId) ?? null),
    },
  };
};
