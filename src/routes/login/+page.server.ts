import { redirect } from '@sveltejs/kit';
import { enrollmentFor, hasPasskeys } from '#foosball/auth.ts';
import { safeNext, webauthn } from '#lib/server/auth.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
  const enroll = url.searchParams.get('enroll');
  const next = safeNext(url.searchParams.get('next'));
  if (locals.session && !enroll) redirect(303, next);

  // A bad FOOSBALL_ORIGIN makes every passkey call fail; say why up front.
  let configError: string | null = null;
  let origin: string | null = null;
  try {
    origin = webauthn().origin;
  } catch (err) {
    configError = (err as Error).message;
  }

  const target = enroll ? await enrollmentFor(enroll) : null;
  return {
    next,
    enroll,
    /** Whose account the link adds a passkey to; null when the link is spent or unknown. */
    enrollName: target?.name ?? null,
    hasPasskeys: await hasPasskeys(),
    configError,
    // Opened on 127.0.0.1 or another host than the configured origin: passkeys
    // are bound to the origin's hostname, so point at the address that works.
    wrongOrigin: origin && origin !== url.origin ? origin : null,
  };
};
