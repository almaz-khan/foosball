import { formatDuration, formatWhen } from './dates.ts';
import type { Game } from './server/games.ts';

export type Team = 'red' | 'blue';

/** A game as a page shows it: times already in the org's zone, so server and browser agree. */
export interface GameView extends Game {
  when: string;
  duration: string | null;
  winner: Team | null;
}

export function viewGame(game: Game, zone: string, now: Date = new Date()): GameView {
  const { startedAt, endedAt, red, blue } = game;
  return {
    ...game,
    when: formatWhen(game.playedAt, zone, now),
    duration: startedAt && endedAt ? formatDuration(endedAt.getTime() - startedAt.getTime()) : null,
    winner: red.score > blue.score ? 'red' : blue.score > red.score ? 'blue' : null,
  };
}

/** Which side a player was on, if they played. */
export function sideOf(game: Game, playerId: number): Team | null {
  for (const team of ['red', 'blue'] as const) {
    if (game[team].offense.id === playerId || game[team].defense.id === playerId) return team;
  }
  return null;
}
