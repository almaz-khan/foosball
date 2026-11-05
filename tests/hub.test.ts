import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { startFakeHub, type FakeHub } from '../scripts/fakehub.ts';
import {
  appOrigin,
  finishLogin,
  hubConfig,
  HubLoginError,
  logoutUrl,
  startLogin,
  type HubConfig,
  type HubLoginErrorCode,
} from '../src/lib/server/hub.ts';

describe('hubConfig', () => {
  const secret = { OIDC_CLIENT_SECRET: 's3cret' };

  test('defaults to the live hub and the client id foosball', () => {
    const config = hubConfig({ ...secret, FOOSBALL_ORIGIN: 'https://foosball.almaz.dev' });
    expect(config.issuer.href).toBe('https://login.almaz.dev/');
    expect(config.client.client_id).toBe('foosball');
    expect(config.client.id_token_signed_response_alg).toBe('EdDSA');
    expect(config.redirectUri).toBe('https://foosball.almaz.dev/auth/callback');
    expect(config.logoutReturnUri).toBe('https://foosball.almaz.dev/login');
  });

  test('refuses to run without the client secret', () => {
    expect(() => hubConfig({})).toThrow(/OIDC_CLIENT_SECRET/);
    expect(() => hubConfig({ OIDC_CLIENT_SECRET: '  ' })).toThrow(/OIDC_CLIENT_SECRET/);
  });

  test('takes plain http only for a hub on this machine', () => {
    expect(hubConfig({ ...secret, OIDC_ISSUER: 'http://localhost:4455' }).issuer.origin).toBe('http://localhost:4455');
    expect(() => hubConfig({ ...secret, OIDC_ISSUER: 'http://login.almaz.dev' })).toThrow(/https/);
  });

  test('the app origin is FOOSBALL_ORIGIN: https, or plain http on localhost', () => {
    expect(appOrigin({})).toBe('http://localhost:5180');
    expect(appOrigin({ FOOSBALL_ORIGIN: 'https://foosball.almaz.dev/' })).toBe('https://foosball.almaz.dev');
    expect(() => appOrigin({ FOOSBALL_ORIGIN: 'http://foosball.almaz.dev' })).toThrow(/https/);
    expect(() => appOrigin({ FOOSBALL_ORIGIN: 'foosball' })).toThrow(/not a URL/);
  });

  test('builds the hub sign-out link from the issuer, back to /login', () => {
    const url = logoutUrl(hubConfig({ ...secret, FOOSBALL_ORIGIN: 'https://foosball.almaz.dev' }));
    expect(url.origin + url.pathname).toBe('https://login.almaz.dev/logout');
    expect(url.searchParams.get('client_id')).toBe('foosball');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://foosball.almaz.dev/login');
  });
});

describe('a sign-in through the hub', () => {
  let hub: FakeHub;
  let config: HubConfig;

  beforeAll(async () => {
    hub = await startFakeHub();
    config = hubConfig({ OIDC_ISSUER: hub.issuer, OIDC_CLIENT_SECRET: hub.clientSecret, FOOSBALL_ORIGIN: 'http://localhost:5180' });
  });
  afterAll(() => hub.stop());
  beforeEach(() => {
    hub.person = { sub: 'Almaz', name: 'Almaz Khan', amr: ['passkey'] };
    hub.signedIn = false;
    hub.denyAccess = false;
    hub.tamper = null;
  });

  /** What the browser does: follow the authorize link to the hub, and land on the callback URL. */
  async function visitHub(url: URL): Promise<URL> {
    const response = await fetch(url, { redirect: 'manual' });
    expect(response.status).toBe(302);
    return new URL(response.headers.get('location')!);
  }

  async function signIn(options: { silent?: boolean } = {}) {
    const { url, pending } = await startLogin(config, options);
    return finishLogin(config, await visitHub(url), pending);
  }

  async function failure(run: Promise<unknown>): Promise<{ code: HubLoginErrorCode; reason: string }> {
    try {
      await run;
    } catch (err) {
      if (err instanceof HubLoginError) return { code: err.code, reason: err.reason };
      throw err;
    }
    throw new Error('expected the sign-in to fail');
  }

  test('asks for the code flow with PKCE S256, state and nonce', async () => {
    const { url, pending } = await startLogin(config);
    expect(url.origin + url.pathname).toBe(`${hub.issuer}/authorize`);
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('foosball');
    expect(q.get('redirect_uri')).toBe('http://localhost:5180/auth/callback');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid profile');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBe(pending.state);
    expect(q.get('nonce')).toBe(pending.nonce);
    // The verifier itself never leaves the server.
    expect(url.href).not.toContain(pending.codeVerifier);
    expect(q.has('prompt')).toBe(false);
  });

  test('comes back with who signed in', async () => {
    expect(await signIn()).toEqual({ sub: 'Almaz', name: 'Almaz Khan', amr: ['passkey'] });
  });

  test('falls back to the person key when the hub sends no name', async () => {
    hub.person = { sub: 'bob', name: '', amr: ['passkey'] };
    expect((await signIn()).name).toBe('bob');
  });

  test('a silent re-check passes while the hub session lives, and says login_required once it has gone', async () => {
    await signIn();
    expect((await signIn({ silent: true })).sub).toBe('Almaz');
    hub.signedIn = false;
    expect((await failure(signIn({ silent: true }))).code).toBe('login_required');
  });

  test('someone the hub refuses is access_denied', async () => {
    hub.denyAccess = true;
    expect((await failure(signIn())).code).toBe('access_denied');
  });

  test('a Telegram-only proof is not enough', async () => {
    hub.person = { sub: 'Almaz', name: 'Almaz', amr: ['telegram'] };
    expect((await failure(signIn())).code).toBe('wrong_method');
  });

  test('a callback from another sign-in (wrong state) is refused before the code is used', async () => {
    const first = await startLogin(config);
    const second = await startLogin(config);
    const callback = await visitHub(first.url);
    expect((await failure(finishLogin(config, callback, second.pending))).code).toBe('failed');
    // The code was never exchanged, so the right sign-in can still finish it.
    expect((await finishLogin(config, callback, first.pending)).sub).toBe('Almaz');
  });

  test('a code is good once', async () => {
    const { url, pending } = await startLogin(config);
    const callback = await visitHub(url);
    await finishLogin(config, callback, pending);
    const again = await failure(finishLogin(config, callback, pending));
    expect(again).toMatchObject({ code: 'failed', reason: expect.stringContaining('invalid_grant') });
  });

  test('the PKCE verifier must match', async () => {
    const { url, pending } = await startLogin(config);
    const callback = await visitHub(url);
    const wrong = { ...pending, codeVerifier: (await startLogin(config)).pending.codeVerifier };
    expect((await failure(finishLogin(config, callback, wrong))).reason).toContain('invalid_grant');
  });

  test('a wrong client secret is refused by the hub', async () => {
    const { url, pending } = await startLogin(config);
    const callback = await visitHub(url);
    const wrong = { ...config, clientSecret: 'nope' };
    expect((await failure(finishLogin(wrong, callback, pending))).reason).toContain('invalid_client');
  });

  test('a callback without the hub as iss is refused', async () => {
    const { url, pending } = await startLogin(config);
    const callback = await visitHub(url);
    callback.searchParams.delete('iss');
    expect((await failure(finishLogin(config, callback, pending))).code).toBe('failed');
  });

  for (const [what, tamper] of [
    ['another issuer', { iss: 'https://evil.example' }],
    ['another audience', { aud: 'budget' }],
    ['another nonce', { nonce: 'replayed' }],
    ['an expired token', { expiresIn: -120 }],
    ['a key the hub does not list', { foreignKey: true }],
    ['no ID token', { noIdToken: true }],
  ] as const) {
    test(`an ID token with ${what} is refused`, async () => {
      hub.tamper = tamper;
      expect((await failure(signIn())).code).toBe('failed');
    });
  }

  test('an error page on the hub, a hub that is down, fails cleanly', async () => {
    const down = hubConfig({ OIDC_ISSUER: 'http://localhost:1', OIDC_CLIENT_SECRET: 'x' });
    await expect(startLogin(down)).rejects.toThrow();
    const failed = await failure(finishLogin(down, new URL('http://localhost:5180/auth/callback?code=x&state=y'), {
      state: 'y',
      nonce: 'n',
      codeVerifier: 'v',
    }));
    expect(failed.code).toBe('failed');
  });
});
