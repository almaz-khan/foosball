import { parseDateTime } from '../dates.ts';
import { POSITIONS, TEAMS } from './db/schema.ts';
import { MAX_SCORE, type GameInput } from './games.ts';

/** The form's field for a seat or a score, e.g. `red_offense`, `blue_score`. */
export const seatField = (team: string, position: string) => `${team}_${position}`;

/**
 * Reads a game form: four seats, two scores, and optional start and end times
 * entered in the org's zone. Returns what is wrong in words, for the form to
 * show; the rules that need the database (roster) are games.ts's.
 */
export function parseGameForm(form: FormData, zone: string): { input: GameInput } | { error: string } {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const sides = {} as Record<(typeof TEAMS)[number], GameInput['red']>;
  for (const team of TEAMS) {
    const scoreText = text(seatField(team, 'score'));
    const score = Number(scoreText);
    if (scoreText === '' || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
      return { error: `The ${team} score must be a whole number from 0 to ${MAX_SCORE}.` };
    }
    const seats = {} as Record<(typeof POSITIONS)[number], number>;
    for (const position of POSITIONS) {
      const id = Number(text(seatField(team, position)));
      if (!Number.isInteger(id) || id <= 0) return { error: `Choose the ${team} ${position} player.` };
      seats[position] = id;
    }
    sides[team] = { score, ...seats };
  }

  const times: Record<'startedAt' | 'endedAt', Date | null> = { startedAt: null, endedAt: null };
  for (const [key, name, label] of [
    ['startedAt', 'started_at', 'start'],
    ['endedAt', 'ended_at', 'end'],
  ] as const) {
    const value = text(name);
    if (!value) continue;
    // A person types wall time in the org's zone; the live scoreboard sends the exact instant.
    const parsed = INSTANT.test(value) ? new Date(value) : parseDateTime(value, zone);
    if (!parsed || Number.isNaN(parsed.getTime())) return { error: `The ${label} time is not a valid date and time.` };
    times[key] = parsed;
  }
  if (times.endedAt && times.endedAt.getTime() > Date.now() + 5 * 60_000) {
    return { error: 'A game cannot end in the future.' };
  }
  const clientKey = text('client_key') || null;
  return { input: { ...times, red: sides.red, blue: sides.blue, ...(clientKey ? { clientKey } : {}) } };
}

/** An ISO 8601 instant with its offset, as `Date.prototype.toISOString` writes it. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
