import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status}).`);
  return data as T;
}

/** Turns browser and server failures into a sentence for the person at the keyboard. */
export function describe(err: unknown): string {
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This device already has a passkey for this account.';
    if (err.code === 'ERROR_INVALID_DOMAIN') return 'Passkeys don’t work on this address. Open the app at its proper address.';
  }
  if (err instanceof Error && err.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export async function signIn(next: string | null): Promise<string> {
  const { challengeId, options } = await post<{ challengeId: string; options: never }>('/auth/login/options', {});
  const response = await startAuthentication({ optionsJSON: options });
  const result = await post<{ next: string }>('/auth/login/verify', { challengeId, response, next });
  return result.next;
}

/** What gives the right to create this passkey; none means the signed-in person adds a device. */
export type PasskeyFor = { invite: string; userName: string } | { enroll: string } | Record<string, never>;

export async function createPasskey(deviceName: string, via: PasskeyFor = {}): Promise<void> {
  const { challengeId, options } = await post<{ challengeId: string; options: never }>('/auth/register/options', via);
  const response = await startRegistration({ optionsJSON: options });
  await post('/auth/register/verify', { ...via, challengeId, response, name: deviceName });
}

/** A sensible default name for the passkey being created on this device. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}
