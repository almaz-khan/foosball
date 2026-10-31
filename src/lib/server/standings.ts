import { sql } from 'drizzle-orm';
import { getDb, type Executor } from './db/index.ts';
import { fullName } from './orgs.ts';

/** Games together before a partnership counts as someone's "best". */
export const MIN_PAIR_GAMES = 3;
/** Games played before someone is ranked rather than listed as provisional. */
export const MIN_RANKED_GAMES = 3;

export interface Tally {
  played: number;
  won: number;
}

export interface Standing extends Tally {
  playerId: number;
  name: string;
  lost: number;
  drawn: number;
  /** 0–1; null before any game. */
  winRate: number | null;
  goalsFor: number;
  goalsAgainst: number;
  asOffense: Tally;
  asDefense: Tally;
  /** The teammate they win most with, over at least MIN_PAIR_GAMES together. */
  bestPartner: (Tally & { playerId: number; name: string }) | null;
  /** Fewer than MIN_RANKED_GAMES: listed after the ranked players. */
  provisional: boolean;
}

export interface Period {
  /** Played at or after. */
  from?: Date;
  /** Played before. */
  to?: Date;
}

const playedAt = sql`coalesce(g.ended_at, g.started_at, g.created_at)`;

/**
 * Everyone who played in the period, best first: win rate, then goal
 * difference, then games played. One seat row per player per game, scored
 * from their own side.
 */
export async function standings(orgId: number, period: Period = {}, db: Executor = getDb()): Promise<Standing[]> {
  const where = sql`g.org_id = ${orgId}
    ${period.from ? sql`and ${playedAt} >= ${period.from.toISOString()}::timestamptz` : sql``}
    ${period.to ? sql`and ${playedAt} < ${period.to.toISOString()}::timestamptz` : sql``}`;
  const seats = sql`
    select gp.player_id, gp.team, gp.position, gp.game_id,
           case when gp.team = 'red' then g.red_score else g.blue_score end as gf,
           case when gp.team = 'red' then g.blue_score else g.red_score end as ga
      from foosball.game_player gp
      join foosball.game g on g.id = gp.game_id and g.org_id = gp.org_id
     where ${where}`;

  const [totals, pairs] = await Promise.all([
    db.execute<{
      player_id: number; first_name: string; last_name: string | null;
      played: number; won: number; lost: number; gf: number; ga: number;
      off_played: number; off_won: number; def_played: number; def_won: number;
    }>(sql`
      with seats as (${seats})
      select s.player_id, p.first_name, p.last_name,
             count(*)::int as played,
             count(*) filter (where gf > ga)::int as won,
             count(*) filter (where gf < ga)::int as lost,
             sum(gf)::int as gf, sum(ga)::int as ga,
             count(*) filter (where position = 'offense')::int as off_played,
             count(*) filter (where position = 'offense' and gf > ga)::int as off_won,
             count(*) filter (where position = 'defense')::int as def_played,
             count(*) filter (where position = 'defense' and gf > ga)::int as def_won
        from seats s
        join foosball.player p on p.id = s.player_id
       group by s.player_id, p.first_name, p.last_name`),
    db.execute<{ player_id: number; partner_id: number; first_name: string; last_name: string | null; played: number; won: number }>(sql`
      with seats as (${seats})
      select a.player_id, b.player_id as partner_id, p.first_name, p.last_name,
             count(*)::int as played,
             count(*) filter (where a.gf > a.ga)::int as won
        from seats a
        join seats b on b.game_id = a.game_id and b.team = a.team and b.player_id <> a.player_id
        join foosball.player p on p.id = b.player_id
       group by a.player_id, b.player_id, p.first_name, p.last_name
      having count(*) >= ${MIN_PAIR_GAMES}`),
  ]);

  const best = new Map<number, Standing['bestPartner']>();
  for (const pair of pairs) {
    const current = best.get(pair.player_id);
    const rate = pair.won / pair.played;
    if (!current || rate > current.won / current.played || (rate === current.won / current.played && pair.played > current.played)) {
      best.set(pair.player_id, {
        playerId: pair.partner_id,
        name: fullName(pair.first_name, pair.last_name),
        played: pair.played,
        won: pair.won,
      });
    }
  }

  const rows: Standing[] = totals.map((r) => ({
    playerId: r.player_id,
    name: fullName(r.first_name, r.last_name),
    played: r.played,
    won: r.won,
    lost: r.lost,
    drawn: r.played - r.won - r.lost,
    winRate: r.played ? r.won / r.played : null,
    goalsFor: r.gf,
    goalsAgainst: r.ga,
    asOffense: { played: r.off_played, won: r.off_won },
    asDefense: { played: r.def_played, won: r.def_won },
    bestPartner: best.get(r.player_id) ?? null,
    provisional: r.played < MIN_RANKED_GAMES,
  }));

  return rows.sort(
    (a, b) =>
      Number(a.provisional) - Number(b.provisional) ||
      (b.winRate ?? 0) - (a.winRate ?? 0) ||
      b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
      b.played - a.played ||
      a.name.localeCompare(b.name),
  );
}
