/**
 * Fixed-window request limits for the public sign-in and invite endpoints: the
 * only routes anyone on the internet can reach, and ones that write to the
 * database (a challenge row per request). Guessing cannot get past a passkey;
 * this caps floods. In memory: production runs a single replica.
 */
export interface Limits {
  perClient: number;
  global: number;
  windowMs: number;
}

export function createLimiter({ perClient, global, windowMs }: Limits, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();

  const hit = (key: string, max: number, t: number): { ok: boolean; retryAfterS: number } => {
    let w = windows.get(key);
    if (!w || t - w.start >= windowMs) {
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count++;
    return { ok: w.count <= max, retryAfterS: Math.ceil((w.start + windowMs - t) / 1000) };
  };

  return (client: string): { ok: boolean; retryAfterS: number } => {
    const t = now();
    // Old windows are dropped as they are passed, so a scan of many addresses cannot grow this forever.
    if (windows.size > 10_000) {
      for (const [key, w] of windows) if (t - w.start >= windowMs) windows.delete(key);
    }
    const mine = hit(`client:${client}`, perClient, t);
    if (!mine.ok) return mine;
    return hit('global', global, t);
  };
}
