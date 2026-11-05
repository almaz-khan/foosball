# Foosball

Records 2v2 foosball games, red vs blue, each team with an offense and a
defense player, and shows who's winning.

A SvelteKit app (Svelte 5) served by Bun, with Postgres via Drizzle. Everything
belongs to an **org**:

- **Members** see the org's games, players and dashboard.
- **Members linked to a player** can record games.
- **Admins** manage members, invites and the roster.

`REBUILD_PLAN.md` covers the design and the remaining phases. Sign-in has
since moved to the login hub (below), replacing the plan's own passkeys.

## Accounts

Foosball keeps no passwords or passkeys of its own. It is an OpenID Connect
client of the **login hub** (https://login.almaz.dev, repo `login-hub`, local
`~/workspace/hub`), which signs people in once for all the apps on almaz.dev
and decides who may open which. In the hub, Foosball is the app `foosbal` (one l):
**passkey only**, callback `https://foosball.almaz.dev/auth/callback`, sign-out
return `https://foosball.almaz.dev/login`. The code is ported from the budget
app, which made the same move.

**Two gates**
- **The hub decides who may open Foosball at all** (admin UI → Apps → `foosbal` → access). People, their passkeys, lost devices and recovery are all the hub's: admin UI → People → "Passkey link"; someone signed in adds a device on the hub's home page.
- **Org invites decide which org someone is in**, their role and their player. Admins make invites on `/admin`, which also manages roles, player links and members. The CLI can do the same, and makes the first admin.
- So a newcomer needs both: access at the hub (with a passkey there), then an invite link.

**Invites**
- Opened signed out, an invite goes to the hub and comes back to the invite, signed in; "Join" adds the org to that account.
- An invite is single-use and expires after `INVITE_HOURS` (default 48).
- It can link the new member to an existing player, create a new player, or link no one. A member with no player can watch but not record.
- The name on the invite is only a label for the admins' list: the account keeps its own name (the hub's, at first; people can change it on `/account`).

**Accounts and the hub**
- **A first sign-in** links the account named after the hub's person key or the person's name, ignoring case, keeping its orgs and games (accounts from before the hub); from then on only the key (`app_user.hub_sub`) counts. Anyone else the hub lets in gets a new account in no org, which an invite then adds to an org.
- **The flow:** opening any page signed out goes to the hub and back to that page (`/auth/login`, `/auth/callback`; code flow with PKCE S256, state, nonce and `iss`, the client secret over Basic auth, the Ed25519 ID token checked against the hub's keys and required to say `passkey`). The sign-in in progress is a `hub_login` row, single use, 10 minutes.
- **Sessions** last 30 days from the last visit; only a SHA-256 of the cookie is stored. A page load more than a day after the hub last approved someone goes back through the hub silently (`prompt=none`): a new session while the hub session lives, the hub's sign-in when it has gone, and every session of theirs ended if the hub refuses. Form posts and the data pages fetch never go to the hub, so a game being recorded is never lost on the way.
- **Signing out** ends the session and goes on to the hub's "Sign out everywhere?", which comes back to `/login`.
- **While the hub is down**, people already signed in carry on (their daily re-check waits for it); nobody else can sign in, and `/login` says so.
- `/login` only says why a sign-in didn't complete, or that you signed out.
- `/auth/*` and invite joins are rate-limited per client.

The passkey-era tables (`auth_credential`, `auth_session`, `auth_enrollment`,
`auth_challenge`) and `app_user.webauthn_id` are unused and kept only so the
previous release could still run on the database; a later migration drops them.

### Setting up an org

```sh
foosball org create "Office" --slug office --tz Europe/Prague   # games are shown in the org's zone
foosball player add --org office Almaz K          # optional: their player, if not created by the invite
foosball invite create --org office --name Almaz --admin --player <id>
#   or: --new-player "Almaz K"   (creates the player when the invite is used)
#   or: no player at all         (a member who watches)
```

`foosball` is `bun run src/cli.ts` locally, and in production:
`railway ssh --service foosball -- bun run src/cli.ts <command>`.

The CLI also manages:
- members: `member list|role|link|remove`
- the roster: `player list|add`
- invites: `invite list|revoke`
- accounts: `user list` (with each one's hub person key) and `user rename`

`--help` lists every command.

## Develop

Requires Bun 1.3 and Docker.

```sh
bun install
cp .env.example .env
bun run db:up        # Postgres 18 on localhost:5434 (compose.yml)
bun run migrate      # apply drizzle/ migrations
bun run seed         # optional: a "demo" org with 4 players and 2 games
bun run fakehub      # a stand-in login hub on :4455 (leave it running)
bun run dev          # http://localhost:5180: signs you in as "Almaz"
```

| Command | |
|---|---|
| `bun run check` / `bun run typecheck` | svelte-check / tsc |
| `bun test` | integration tests against a throwaway `foosball_test` database on the same Postgres. Sign-ins go through a fake hub (`scripts/fakehub.ts`) |
| `bun run e2e` | builds, then Playwright in Chromium, signed in through the fake hub, against `foosball_e2e` |
| `bun run db:generate` | write a migration after changing `src/lib/server/db/schema.ts` |
| `bun run build && bun run start` | the production server (`PORT`, default 3000) |

### Environment

| Var | Local | Railway |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5434/foosball` | `${{Postgres.DATABASE_URL}}` |
| `FOOSBALL_ORIGIN` | `http://localhost:5180` | `https://foosball.almaz.dev`: the hub's callback, its sign-out return and invite links are built from it |
| `OIDC_CLIENT_SECRET` | `dev-secret` (the fake hub's) | the client secret the hub's admin UI showed once for the app `foosbal`. Without it the server refuses to start |
| `OIDC_ISSUER` | `http://localhost:4455` (`bun run fakehub`) | not set: the default is `https://login.almaz.dev` |
| `OIDC_CLIENT_ID` | – | `foosbal`: the app's client id in the hub, spelled with one l (the code's default is `foosball`) |
| `INVITE_HOURS` | `48` | `48` |
| `ADDRESS_HEADER` | – | `X-Real-IP`: the client address Railway's edge sets, for rate limiting |
| `PROTOCOL_HEADER` / `HOST_HEADER` | – | `x-forwarded-proto` / `x-forwarded-host`, so adapter-node sees the public origin |

## Deploy (Railway)

Production runs at https://foosball.almaz.dev: Railway project `foosball`, environment `production`. It has a `foosball` service built from the `Dockerfile` and a Railway Postgres.

- **Deploy:** `bun run deploy` (`scripts/deploy.sh`), from the Mac. CI only checks; it doesn't deploy.
  - It refuses to run unless the checkout is clean and exactly `origin/main`.
  - It runs svelte-check, tsc, `bun test` and the Playwright suite. `--skip-checks` skips the tests, for emergencies only.
  - Then it runs `railway up` and follows that deployment until it is live, or fails loudly if it does not go live.
  - The tests need the local Postgres (`bun run db:up`).
- **On every deploy:** the service runs `bun run src/cli.ts migrate` as its pre-deploy command, and a new release only takes traffic once `/healthz` answers. These settings live on the Railway service, not in this repo: pre-deploy `bun run src/cli.ts migrate`, health check `/healthz` (60 s), restart on failure (5 retries), `dockerfilePath: Dockerfile`. Railway no longer reads `railway.json` (deprecated config as code), so there is none. Change the settings in the Railway UI or API.
- **CLI in production:** `railway ssh --service foosball -- bun run src/cli.ts <command>`.

## Layout

- `src/sessions.ts`: sign-ins in progress, the link from a hub person to an account, sessions.
- `src/hooks.server.ts`:
  - turns the session into `locals` (session, memberships, current org);
  - rate-limits sign-ins and invite joins;
  - sends signed-out page views (and the daily re-check) through the hub;
  - sets security headers.
- `src/lib/server/`:
  - `db/`: the schema (Postgres schema `foosball`) and the connection;
  - `orgs`, `invites`, `members`, `players`, `games`, `users`: domain rules and queries, shared by pages and the CLI;
  - `hub.ts`: the login hub's protocol (oauth4webapi); `signin.ts`: starting a sign-in, cookies;
  - `auth.ts`: request guards (`requireMember`, `requireRecorder`, `requireAdmin`).
- `src/routes/`:
  - `login/`, `invite/[token]/`: why a sign-in didn't complete; joining an org;
  - `auth/login`, `auth/callback`, `auth/logout`: to the hub and back;
  - `healthz/`: Railway's health check.
- `src/cli.ts`: the server CLI.
- `drizzle/`: generated migrations, applied by `cli.ts migrate` (Railway's pre-deploy step).
- `scripts/fakehub.ts`: a stand-in login hub for dev, tests and Playwright.
- `tests/`: `bun test`. `e2e/`: Playwright.

## History

Before the rebuild this was an Express + MongoDB REST API, with a React UI that
was later removed. It's all in git history before the `rewrite` branch.
