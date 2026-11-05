/**
 * A stand-in for the login hub (https://login.almaz.dev), for tests, the
 * Playwright run and local development. It speaks the same protocol as the
 * real one — discovery, JWKS, /authorize with PKCE S256, /token with Basic
 * auth, Ed25519-signed ID tokens, /logout — but signs in whoever it is told to,
 * without a screen.
 *
 *   bun run fakehub     # http://localhost:4455, signs in as "Almaz" with a passkey
 *
 * Then run Foosball with OIDC_ISSUER=http://localhost:4455 and OIDC_CLIENT_SECRET=dev-secret
 * (both in .env.example). Ported from the budget app's scripts/fakehub.ts.
 */
import { createHash, randomBytes } from 'node:crypto';

export interface FakePerson {
  sub: string;
  name: string;
  /** How they proved it: Foosball accepts only `passkey`. */
  amr: string[];
}

/** One-shot changes to the next ID token, for tests that need a bad one. */
export interface Tamper {
  iss?: string;
  aud?: string;
  nonce?: string;
  /** Seconds from now; negative is already expired. */
  expiresIn?: number;
  /** Signed with a key the JWKS doesn't list. */
  foreignKey?: boolean;
  /** No ID token at all in the token response. */
  noIdToken?: boolean;
}

export interface FakeHubOptions {
  port?: number;
  clientId?: string;
  clientSecret?: string;
  /** Callback URLs the app may use; any localhost URL when not given. */
  redirectUris?: string[];
  person?: FakePerson;
}

export interface FakeHub {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Who /authorize signs in next. */
  person: FakePerson;
  /** Whether the hub has a session: without one, a silent (`prompt=none`) sign-in answers login_required. */
  signedIn: boolean;
  /** When set, /authorize refuses with access_denied, as the hub does for someone without access. */
  denyAccess: boolean;
  tamper: Tamper | null;
  /** Every request's path, in order, for tests that check what was asked. */
  log: string[];
  stop(): void;
}

interface Grant {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  person: FakePerson;
  expires: number;
}

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');

async function signJwt(key: CryptoKey, kid: string, claims: Record<string, unknown>): Promise<string> {
  const input = `${b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid }))}.${b64url(JSON.stringify(claims))}`;
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}

const newKey = () => crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;

export async function startFakeHub(options: FakeHubOptions = {}): Promise<FakeHub> {
  const keys = await newKey();
  const foreign = await newKey();
  const kid = b64url(randomBytes(8));
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid, alg: 'EdDSA', use: 'sig' };
  const grants = new Map<string, Grant>();

  const hub: FakeHub = {
    issuer: '',
    clientId: options.clientId ?? 'foosball',
    clientSecret: options.clientSecret ?? 'dev-secret',
    person: options.person ?? { sub: 'Almaz', name: 'Almaz', amr: ['passkey'] },
    signedIn: false,
    denyAccess: false,
    tamper: null,
    log: [],
    stop: () => server.stop(true),
  };

  const isLocal = (uri: string) => {
    try {
      const url = new URL(uri);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  };
  const redirectAllowed = (uri: string) => (options.redirectUris ? options.redirectUris.includes(uri) : isLocal(uri));

  const back = (redirectUri: string, params: Record<string, string>) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries({ ...params, iss: hub.issuer })) url.searchParams.set(k, v);
    return Response.redirect(url.href, 302);
  };

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: 'localhost',
    async fetch(request) {
      const url = new URL(request.url);
      hub.log.push(url.pathname);
      switch (url.pathname) {
        case '/.well-known/openid-configuration':
          return Response.json({
            issuer: hub.issuer,
            authorization_endpoint: `${hub.issuer}/authorize`,
            token_endpoint: `${hub.issuer}/token`,
            jwks_uri: `${hub.issuer}/jwks.json`,
            end_session_endpoint: `${hub.issuer}/logout`,
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['EdDSA'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
            scopes_supported: ['openid', 'profile'],
            prompt_values_supported: ['none'],
            authorization_response_iss_parameter_supported: true,
          });

        case '/jwks.json':
          return Response.json({ keys: [jwk] });

        case '/authorize': {
          const q = url.searchParams;
          const redirectUri = q.get('redirect_uri') ?? '';
          // Like the hub: an unknown client or callback is an error page, never a redirect.
          if (q.get('client_id') !== hub.clientId || !redirectAllowed(redirectUri)) {
            return new Response('unknown client or redirect_uri', { status: 400 });
          }
          const state = q.get('state') ?? '';
          const fail = (error: string) => back(redirectUri, { error, state });
          if (
            q.get('response_type') !== 'code' ||
            q.get('code_challenge_method') !== 'S256' ||
            !q.get('code_challenge') ||
            !state ||
            !q.get('nonce') ||
            !q.get('scope')?.split(' ').includes('openid')
          ) {
            return fail('invalid_request');
          }
          if (q.get('prompt') === 'none' && !hub.signedIn) return fail('login_required');
          if (hub.denyAccess) return fail('access_denied');
          hub.signedIn = true;
          const code = b64url(randomBytes(24));
          grants.set(code, {
            clientId: hub.clientId,
            redirectUri,
            codeChallenge: q.get('code_challenge')!,
            nonce: q.get('nonce')!,
            person: { ...hub.person },
            expires: Date.now() + 60_000,
          });
          return back(redirectUri, { code, state });
        }

        case '/token': {
          if (request.method !== 'POST') return new Response(null, { status: 405 });
          const tokenError = (error: string, status = 400) => Response.json({ error }, { status });
          const [scheme, encoded] = (request.headers.get('authorization') ?? '').split(' ');
          const [id, secret] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
          if (decodeURIComponent(id ?? '') !== hub.clientId || decodeURIComponent(secret ?? '') !== hub.clientSecret) {
            return tokenError('invalid_client', 401);
          }
          const form = new URLSearchParams(await request.text());
          const code = form.get('code') ?? '';
          const grant = grants.get(code);
          grants.delete(code); // single use, whatever happens next
          if (!grant || grant.expires < Date.now() || form.get('grant_type') !== 'authorization_code') {
            return tokenError('invalid_grant');
          }
          if (form.get('redirect_uri') !== grant.redirectUri) return tokenError('invalid_grant');
          const verifier = form.get('code_verifier') ?? '';
          if (createHash('sha256').update(verifier).digest('base64url') !== grant.codeChallenge) {
            return tokenError('invalid_grant');
          }
          const tamper = hub.tamper ?? {};
          hub.tamper = null;
          const now = Math.floor(Date.now() / 1000);
          const idToken = await signJwt(tamper.foreignKey ? foreign.privateKey : keys.privateKey, kid, {
            iss: tamper.iss ?? hub.issuer,
            sub: grant.person.sub,
            aud: tamper.aud ?? grant.clientId,
            iat: now,
            exp: now + (tamper.expiresIn ?? 300),
            auth_time: now,
            nonce: tamper.nonce ?? grant.nonce,
            name: grant.person.name,
            amr: grant.person.amr,
          });
          return Response.json({
            access_token: b64url(randomBytes(24)),
            token_type: 'Bearer',
            expires_in: 300,
            ...(tamper.noIdToken ? {} : { id_token: idToken }),
          });
        }

        case '/logout': {
          hub.signedIn = false;
          const target = url.searchParams.get('post_logout_redirect_uri');
          return target && isLocal(target)
            ? Response.redirect(target, 302)
            : new Response('signed out');
        }

        case '/healthz':
          return new Response('ok');

        // Fake only, for Playwright: who the next sign-in is, as if someone else
        // came to the hub (its session ends, as with a different browser).
        case '/test/person': {
          if (request.method !== 'POST') return new Response(null, { status: 405 });
          const next = (await request.json()) as Partial<FakePerson>;
          if (!next.sub) return new Response('sub required', { status: 400 });
          hub.person = { sub: next.sub, name: next.name ?? next.sub, amr: next.amr ?? ['passkey'] };
          hub.signedIn = false;
          return new Response(null, { status: 204 });
        }
      }
      return new Response('not found', { status: 404 });
    },
  });
  hub.issuer = `http://localhost:${server.port}`;
  return hub;
}

if (import.meta.main) {
  const port = Number(process.env.FAKEHUB_PORT ?? 4455);
  const hub = await startFakeHub({
    port,
    person: {
      sub: process.env.FAKEHUB_SUB ?? 'Almaz',
      name: process.env.FAKEHUB_NAME ?? process.env.FAKEHUB_SUB ?? 'Almaz',
      amr: (process.env.FAKEHUB_AMR ?? 'passkey').split(','),
    },
  });
  console.log(`fake login hub at ${hub.issuer}, signing in "${hub.person.sub}" (${hub.person.amr.join(', ')})`);
  console.log(`run Foosball with OIDC_ISSUER=${hub.issuer} OIDC_CLIENT_SECRET=${hub.clientSecret}`);
}
