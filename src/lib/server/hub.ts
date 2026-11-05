import * as oauth from 'oauth4webapi';

/**
 * Foosball signs people in through the login hub (https://login.almaz.dev), an
 * OpenID Connect provider: code flow, PKCE S256, state and nonce, the client
 * secret over Basic auth, Ed25519-signed ID tokens. The hub decides who may
 * open Foosball; this module only runs the protocol and says who came back.
 * Ported from the budget app (~/workspace/budget/src/lib/server/hub.ts).
 */

/** How someone must have proved who they are at the hub: a passkey, as Foosball always asked for. */
export const ACCEPTED_METHODS: readonly string[] = ['passkey'];

export interface HubConfig {
  issuer: URL;
  client: oauth.Client;
  clientSecret: string;
  /** Where the hub sends the browser back with a code: listed exactly in the hub. */
  redirectUri: string;
  /** Where the hub's sign-out returns to: listed exactly in the hub. */
  logoutReturnUri: string;
}

const isLocalhost = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

/**
 * The exact address people open Foosball at (FOOSBALL_ORIGIN): the hub's
 * callback and sign-out return are built from it, and so are invite links.
 * Needs no secret, so the CLI can use it too.
 */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.FOOSBALL_ORIGIN?.trim() || 'http://localhost:5180';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`FOOSBALL_ORIGIN is not a URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !isLocalhost(url)) {
    throw new Error(`FOOSBALL_ORIGIN must be https unless it is localhost (${raw}).`);
  }
  return url.origin;
}

/**
 * Read from the environment. No secret, no Foosball: the server refuses to start
 * rather than serve pages nobody can sign in to.
 */
export function hubConfig(env: Record<string, string | undefined> = process.env): HubConfig {
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    throw new Error('OIDC_CLIENT_SECRET is not set: the login hub shows it once when the app `foosball` is added or its secret rotated.');
  }
  const issuer = new URL(env.OIDC_ISSUER?.trim() || 'https://login.almaz.dev');
  if (issuer.protocol !== 'https:' && !isLocalhost(issuer)) {
    throw new Error(`OIDC_ISSUER must be https unless it is localhost (${issuer.href}).`);
  }
  const origin = appOrigin(env);
  return {
    issuer,
    // The hub signs with EdDSA only; saying so means a token signed any other way is refused.
    client: { client_id: env.OIDC_CLIENT_ID?.trim() || 'foosball', id_token_signed_response_alg: 'EdDSA' },
    clientSecret,
    redirectUri: `${origin}/auth/callback`,
    logoutReturnUri: `${origin}/login`,
  };
}

/** Every request to the hub: bounded in time, and plain http only to a hub on this machine (tests, dev). */
function requestOptions(config: HubConfig) {
  return {
    signal: () => AbortSignal.timeout(10_000),
    [oauth.allowInsecureRequests]: config.issuer.protocol === 'http:',
  };
}

// Discovery is fetched once per issuer and kept; a failed fetch is forgotten, so the next sign-in tries again.
const servers = new Map<string, Promise<oauth.AuthorizationServer>>();

function authorizationServer(config: HubConfig): Promise<oauth.AuthorizationServer> {
  const key = config.issuer.href;
  let server = servers.get(key);
  if (!server) {
    server = oauth
      .discoveryRequest(config.issuer, { algorithm: 'oidc', ...requestOptions(config) })
      .then((response) => oauth.processDiscoveryResponse(config.issuer, response));
    server.catch(() => servers.delete(key));
    servers.set(key, server);
  }
  return server;
}

/** What a sign-in in progress must remember until the hub sends the browser back. Secret: never in a URL. */
export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Where to send the browser to sign in. `silent` asks the hub not to show
 * anything (`prompt=none`): it answers at once, with a code or with
 * `login_required` / `access_denied`. Used for the daily re-check.
 */
export async function startLogin(config: HubConfig, options: { silent?: boolean } = {}): Promise<{ url: URL; pending: PendingLogin }> {
  const server = await authorizationServer(config);
  if (!server.authorization_endpoint) throw new HubLoginError('failed', 'the hub lists no authorization endpoint');
  const pending: PendingLogin = {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    codeVerifier: oauth.generateRandomCodeVerifier(),
  };
  const url = new URL(server.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.client.client_id,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(pending.codeVerifier),
    code_challenge_method: 'S256',
    ...(options.silent ? { prompt: 'none' } : {}),
  }).toString();
  return { url, pending };
}

/** Who the hub says came back. `sub` is the hub's person key: stable, never renamed. */
export interface HubIdentity {
  sub: string;
  name: string;
  amr: string[];
}

/**
 * Why a sign-in did not complete. `login_required` and `access_denied` are the
 * hub's own answers; `wrong_method` is a proof Foosball does not accept; anything
 * else, a broken or forged exchange, is `failed`, with the reason for the log.
 */
export type HubLoginErrorCode = 'login_required' | 'access_denied' | 'wrong_method' | 'failed';

export class HubLoginError extends Error {
  constructor(
    readonly code: HubLoginErrorCode,
    readonly reason: string,
  ) {
    super(`${code}: ${reason}`);
  }
}

/**
 * The browser is back at the callback URL. Checks the response belongs to this
 * sign-in (state, `iss`), exchanges the code with the secret and the PKCE
 * verifier, and checks the ID token: its signature against the hub's keys,
 * issuer, audience, expiry, nonce, and that it was proved with a passkey.
 */
export async function finishLogin(config: HubConfig, callbackUrl: URL, pending: PendingLogin): Promise<HubIdentity> {
  let server: oauth.AuthorizationServer;
  try {
    server = await authorizationServer(config);
  } catch (err) {
    throw new HubLoginError('failed', `discovery: ${describe(err)}`);
  }

  let params: URLSearchParams;
  try {
    params = oauth.validateAuthResponse(server, config.client, callbackUrl, pending.state);
  } catch (err) {
    if (err instanceof oauth.AuthorizationResponseError) {
      if (err.error === 'login_required' || err.error === 'access_denied') throw new HubLoginError(err.error, err.error);
      throw new HubLoginError('failed', `hub answered ${err.error}`);
    }
    throw new HubLoginError('failed', `callback: ${describe(err)}`);
  }

  let claims: oauth.IDToken;
  try {
    const options = requestOptions(config);
    const response = await oauth.authorizationCodeGrantRequest(
      server,
      config.client,
      oauth.ClientSecretBasic(config.clientSecret),
      params,
      config.redirectUri,
      pending.codeVerifier,
      options,
    );
    const tokens = await oauth.processAuthorizationCodeResponse(server, config.client, response, {
      expectedNonce: pending.nonce,
      requireIdToken: true,
    });
    // The token came straight from the hub over TLS, which already vouches for
    // it; checking the signature too costs one cached key fetch.
    await oauth.validateApplicationLevelSignature(server, response, options);
    claims = oauth.getValidatedIdTokenClaims(tokens)!;
  } catch (err) {
    throw new HubLoginError('failed', `token: ${describe(err)}`);
  }

  const amr = Array.isArray(claims.amr) ? claims.amr.filter((m): m is string => typeof m === 'string') : [];
  if (!amr.some((m) => ACCEPTED_METHODS.includes(m))) {
    throw new HubLoginError('wrong_method', `amr ${JSON.stringify(amr)}`);
  }
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : claims.sub;
  return { sub: claims.sub, name, amr };
}

/**
 * The hub's "Sign out everywhere?", which comes back to Foosball's /login. Built
 * from the issuer, not discovery, so signing out works even while the hub is down.
 */
export function logoutUrl(config: HubConfig): URL {
  const url = new URL('logout', config.issuer.href.endsWith('/') ? config.issuer : `${config.issuer.href}/`);
  url.search = new URLSearchParams({
    client_id: config.client.client_id,
    post_logout_redirect_uri: config.logoutReturnUri,
  }).toString();
  return url;
}

function describe(err: unknown): string {
  if (err instanceof oauth.ResponseBodyError) return `${err.error}${err.error_description ? ` (${err.error_description})` : ''}`;
  if (err instanceof Error) return 'code' in err && err.code ? `${err.code}: ${err.message}` : err.message;
  return String(err);
}
