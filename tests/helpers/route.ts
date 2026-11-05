import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Membership } from '../../src/lib/server/orgs.ts';

/**
 * A request as SvelteKit hands it to a page's `load` or form action: signed
 * in as `userId`, acting as `member`, optionally posting a form. Enough of
 * RequestEvent for this app's routes, which read locals, params, url, cookies
 * and the form.
 */
export function event(options: {
  userId: number;
  /** Null: signed in, but in no org. */
  member: Membership | null;
  url?: string;
  params?: Record<string, string>;
  form?: Record<string, string>;
}) {
  const url = new URL(options.url ?? '/', 'http://localhost');
  const body = new FormData();
  for (const [name, value] of Object.entries(options.form ?? {})) body.append(name, value);
  return {
    url,
    params: options.params ?? {},
    request: new Request(url, options.form ? { method: 'POST', body } : undefined),
    locals: {
      session: { userId: options.userId, userName: 'test', expiresAt: new Date(), renewed: false, hubCheckDue: false },
      memberships: options.member ? [options.member] : [],
      member: options.member,
    },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    setHeaders: () => {},
    depends: () => {},
    parent: async () => ({}),
  } as never;
}

/** What a load or action ended with: a value, a redirect, an HTTP error or a form failure. */
export async function outcome<T>(run: () => Promise<T> | T): Promise<
  | { kind: 'ok'; value: T }
  | { kind: 'redirect'; status: number; location: string }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'fail'; status: number; data: Record<string, unknown> }
> {
  try {
    const value = await run();
    if (isActionFailure(value)) return { kind: 'fail', status: value.status, data: (value.data ?? {}) as Record<string, unknown> };
    return { kind: 'ok', value };
  } catch (err) {
    if (isRedirect(err)) return { kind: 'redirect', status: err.status, location: err.location };
    if (isHttpError(err)) return { kind: 'error', status: err.status, message: err.body.message };
    throw err;
  }
}
