/**
 * The game being played at the table, as the /play page keeps it: who sits
 * where, the score, and when it started. Pure functions over plain data, so
 * the page can keep it in localStorage and the rules can be tested alone.
 */

export type Team = 'red' | 'blue';
export type Position = 'offense' | 'defense';
export type SeatName = `${Team}.${Position}`;

/** The order empty seats are filled in when a player is tapped with no seat chosen. */
export const SEATS: SeatName[] = ['red.offense', 'red.defense', 'blue.offense', 'blue.defense'];

export interface Play {
  /** Bumped when the stored shape changes; an old one is dropped, not misread. */
  version: 1;
  seats: Record<SeatName, number | null>;
  /** The seat the next tapped player goes to; null fills the first empty one. */
  selected: SeatName | null;
  phase: 'setup' | 'live';
  score: Record<Team, number>;
  /** ISO instant; null when entering the result of a game played earlier. */
  startedAt: string | null;
  /** Saving twice with this key saves one game (see games.ts). */
  clientKey: string;
}

export const MAX_SCORE = 99;

export function newPlay(clientKey: string): Play {
  return {
    version: 1,
    seats: { 'red.offense': null, 'red.defense': null, 'blue.offense': null, 'blue.defense': null },
    selected: null,
    phase: 'setup',
    score: { red: 0, blue: 0 },
    startedAt: null,
    clientKey,
  };
}

/** Seats a player: in the chosen seat, else the first empty one. Someone already seated moves. */
export function seat(play: Play, playerId: number): Play {
  const target = play.selected ?? SEATS.find((s) => play.seats[s] === null);
  if (!target) return play;
  const seats = { ...play.seats };
  for (const s of SEATS) if (seats[s] === playerId) seats[s] = null;
  seats[target] = playerId;
  return { ...play, seats, selected: null };
}

/**
 * Tapping a seat chooses it for the next player; tapping a taken seat also
 * frees it, so a wrong pick is one tap to undo.
 */
export function tapSeat(play: Play, name: SeatName): Play {
  if (play.selected === name) return { ...play, selected: null };
  return { ...play, seats: { ...play.seats, [name]: null }, selected: name };
}

export function swapSides(play: Play): Play {
  const s = play.seats;
  return {
    ...play,
    seats: { 'red.offense': s['blue.offense'], 'red.defense': s['blue.defense'], 'blue.offense': s['red.offense'], 'blue.defense': s['red.defense'] },
    score: { red: play.score.blue, blue: play.score.red },
    selected: null,
  };
}

export function swapPositions(play: Play, team: Team): Play {
  return {
    ...play,
    seats: { ...play.seats, [`${team}.offense`]: play.seats[`${team}.defense`], [`${team}.defense`]: play.seats[`${team}.offense`] },
    selected: null,
  };
}

export const isSeated = (play: Play) => SEATS.every((s) => play.seats[s] !== null);

/** Live: the clock starts now. Entering a result: no clock, scores only. */
export function start(play: Play, live: boolean, now: Date = new Date()): Play {
  if (!isSeated(play)) return play;
  return { ...play, phase: 'live', startedAt: live ? now.toISOString() : null, selected: null };
}

export function addPoint(play: Play, team: Team, delta: 1 | -1): Play {
  const next = Math.min(MAX_SCORE, Math.max(0, play.score[team] + delta));
  return { ...play, score: { ...play.score, [team]: next } };
}

/** Back to choosing players, keeping them seated. */
export const backToSetup = (play: Play): Play => ({ ...play, phase: 'setup', score: { red: 0, blue: 0 }, startedAt: null });

/** A stored game, if it is one this version understands. */
export function restore(raw: string | null): Play | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Play>;
    if (p.version !== 1 || !p.seats || !p.score || typeof p.clientKey !== 'string') return null;
    if (!SEATS.every((s) => p.seats![s] === null || Number.isInteger(p.seats![s]))) return null;
    return { ...newPlay(p.clientKey), ...p } as Play;
  } catch {
    return null;
  }
}

/** The form fields the save action reads (lib/server/game-form.ts). */
export function formFields(play: Play, now: Date = new Date()): Record<string, string> {
  return {
    red_offense: String(play.seats['red.offense'] ?? ''),
    red_defense: String(play.seats['red.defense'] ?? ''),
    blue_offense: String(play.seats['blue.offense'] ?? ''),
    blue_defense: String(play.seats['blue.defense'] ?? ''),
    red_score: String(play.score.red),
    blue_score: String(play.score.blue),
    started_at: play.startedAt ?? '',
    ended_at: now.toISOString(),
    client_key: play.clientKey,
  };
}
