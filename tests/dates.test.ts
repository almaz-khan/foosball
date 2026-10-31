import { describe, expect, test } from 'bun:test';
import {
  formatDuration,
  formatWhen,
  isTimeZone,
  parseDateTime,
  parseDay,
  parseDayEnd,
  toDateInput,
  toDateTimeInput,
} from '../src/lib/dates.ts';
import { parseGameForm } from '../src/lib/server/game-form.ts';

const PRAGUE = 'Europe/Prague';

describe('wall time in a zone', () => {
  test('a day starts at local midnight, summer and winter', () => {
    expect(parseDay('2026-07-01', PRAGUE)!.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(parseDay('2026-12-01', PRAGUE)!.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(parseDay('2026-12-01', 'America/New_York')!.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  test('an inclusive "to" day ends at the next local midnight, across a DST change', () => {
    // Prague leaves summer time on 25 Oct 2026: that day is 25 hours long.
    const start = parseDay('2026-10-25', PRAGUE)!;
    const end = parseDayEnd('2026-10-25', PRAGUE)!;
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
    expect(parseDayEnd('2026-12-31', PRAGUE)!.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  test('date-time inputs round-trip through the zone', () => {
    const at = parseDateTime('2026-10-31T14:05', PRAGUE)!;
    expect(at.toISOString()).toBe('2026-10-31T13:05:00.000Z');
    expect(toDateTimeInput(at, PRAGUE)).toBe('2026-10-31T14:05');
    expect(toDateInput(at, PRAGUE)).toBe('2026-10-31');
    expect(toDateTimeInput(null, PRAGUE)).toBe('');
  });

  test('a time skipped by the spring change lands just after it', () => {
    // 29 Mar 2026: Prague jumps from 02:00 to 03:00.
    const gap = parseDateTime('2026-03-29T02:30', PRAGUE)!;
    expect(toDateTimeInput(gap, PRAGUE)).toBe('2026-03-29T03:30');
  });

  test('nonsense is refused, not guessed', () => {
    expect(parseDay('2026-02-30', PRAGUE)).toBeNull();
    expect(parseDay('31.10.2026', PRAGUE)).toBeNull();
    expect(parseDateTime('2026-10-31T24:00', PRAGUE)).toBeNull();
    expect(parseDateTime('', PRAGUE)).toBeNull();
    expect(isTimeZone('Europe/Prague')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });

  test('when a game was played, said the short way', () => {
    const now = new Date('2026-10-31T15:00:00Z'); // a Saturday, 16:00 in Prague
    expect(formatWhen(new Date('2026-10-31T13:05:00Z'), PRAGUE, now)).toBe('Today 14:05');
    expect(formatWhen(new Date('2026-10-30T08:00:00Z'), PRAGUE, now)).toBe('Yesterday 09:00');
    expect(formatWhen(new Date('2026-10-27T17:30:00Z'), PRAGUE, now)).toBe('Tue 27 Oct, 18:30');
    expect(formatWhen(new Date('2026-09-01T10:00:00Z'), PRAGUE, now)).toBe('1 Sep, 12:00');
    expect(formatWhen(new Date('2025-12-24T10:00:00Z'), PRAGUE, now)).toBe('24 Dec 2025, 11:00');
    // Just after midnight in Prague is still "today" there, though it is yesterday in UTC.
    expect(formatWhen(new Date('2026-10-30T23:30:00Z'), PRAGUE, now)).toBe('Today 00:30');
  });

  test('durations', () => {
    expect(formatDuration(8 * 60_000)).toBe('8 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
  });
});

describe('the game form', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const valid = {
    red_offense: '1', red_defense: '2', blue_offense: '3', blue_defense: '4',
    red_score: '10', blue_score: '7',
    started_at: '2026-10-01T10:00', ended_at: '2026-10-01T10:08',
  };

  test('reads seats, scores and times in the org’s zone', () => {
    const parsed = parseGameForm(form(valid), PRAGUE);
    expect('input' in parsed && parsed.input).toEqual({
      startedAt: new Date('2026-10-01T08:00:00Z'),
      endedAt: new Date('2026-10-01T08:08:00Z'),
      red: { score: 10, offense: 1, defense: 2 },
      blue: { score: 7, offense: 3, defense: 4 },
    });
  });

  test('times are optional', () => {
    const parsed = parseGameForm(form({ ...valid, started_at: '', ended_at: '' }), PRAGUE);
    expect('input' in parsed && parsed.input.startedAt).toBeNull();
  });

  test('says what is wrong', () => {
    const error = (over: Record<string, string>) => {
      const parsed = parseGameForm(form({ ...valid, ...over }), PRAGUE);
      return 'error' in parsed ? parsed.error : null;
    };
    expect(error({ red_score: '' })).toMatch(/red score/);
    expect(error({ blue_score: '100' })).toMatch(/blue score/);
    expect(error({ blue_score: '1.5' })).toMatch(/blue score/);
    expect(error({ blue_defense: '' })).toMatch(/blue defense/);
    expect(error({ started_at: 'soon' })).toMatch(/start time/);
    expect(error({ ended_at: '2999-01-01T00:00' })).toMatch(/future/);
  });
});
