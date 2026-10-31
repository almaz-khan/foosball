# Foosball

Records 2v2 foosball games, red vs blue, each team with an offense and a
defense player, and shows who's winning.

A SvelteKit app (Svelte 5) served by Bun, with Postgres via Drizzle. Everything
belongs to an **org**:

- **Members** see the org's games, players and dashboard.
- **Members linked to a player** can record games.
- **Admins** manage members, invites and the roster.

`REBUILD_PLAN.md` covers the design and the remaining phases.

## Accounts

Sign-in uses **passkeys only**. The WebAuthn code is ported from the budget
app (`src/auth.ts`).

**Invites**
- There is no sign-up page. An account exists once someone opens an **org invite** and creates a passkey with it.
- Admins make invites on `/admin`, which also manages roles, player links and members. The CLI can do the same, and makes the first admin.
- An invite is single-use and expires after `INVITE_HOURS` (default 48).
- It can link the new member to an existing player, create a new player, or link no one. A member with no player can watch but not record.
- Someone who already has an account just joins: opening the invite while signed in adds the org to their account.

**Recovery and extra devices**
- On `/account`, people add, rename and remove their own passkeys (never the last one), or get a 15-minute link to open on another device.
- On `/admin`, an admin can make a 60-minute recovery link for a member, but only if they are an admin in every org that member belongs to.
- `auth enroll --user <name>` prints a 15-minute link that adds another passkey to an existing account.
- `auth revoke <id>` removes a passkey and signs out every session it opened.

**Passkey details carried over from budget**
- Discoverable credentials, with user verification required.
- ASCII user handles.
- Sign-in is decided by credential id + signature, never the (unsigned) user handle, so NordPass works.
- Challenges are single-use.
- Sessions store only a SHA-256 of the cookie and have a 30-day sliding expiry.
- `POST /auth/*` and `/invite/*` are rate-limited per client.

**`FOOSBALL_ORIGIN`** must be exactly the address in the browser bar: passkeys are bound to its hostname.

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
- passkeys: `auth list|revoke|enroll`
- accounts: `user list|rename`

`--help` lists every command.

## Develop

Requires Bun 1.3 and Docker.

```sh
bun install
cp .env.example .env
bun run db:up        # Postgres 18 on localhost:5434 (compose.yml)
bun run migrate      # apply drizzle/ migrations
bun run seed         # optional: a "demo" org with 4 players and 2 games
bun run dev          # http://localhost:5180
```

| Command | |
|---|---|
| `bun run check` / `bun run typecheck` | svelte-check / tsc |
| `bun test` | integration tests against a throwaway `foosball_test` database on the same Postgres. Passkeys use a software authenticator with real P-256 signatures |
| `bun run e2e` | builds, then Playwright in Chromium with a virtual authenticator, against `foosball_e2e` |
| `bun run db:generate` | write a migration after changing `src/lib/server/db/schema.ts` |
| `bun run build && bun run start` | the production server (`PORT`, default 3000) |

### Environment

| Var | Local | Railway |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5434/foosball` | `${{Postgres.DATABASE_URL}}` |
| `FOOSBALL_ORIGIN` | `http://localhost:5180` | `https://foosball.almaz.dev` |
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

- `src/auth.ts`: passkeys, enrollment links and sessions.
- `src/hooks.server.ts`:
  - turns the session into `locals` (session, memberships, current org);
  - rate-limits the auth endpoints;
  - redirects signed-out requests;
  - sets security headers.
- `src/lib/server/`:
  - `db/`: the schema (Postgres schema `foosball`) and the connection;
  - `orgs`, `invites`, `members`, `players`, `games`, `users`: domain rules and queries, shared by pages and the CLI;
  - `auth.ts`: request guards (`requireMember`, `requireRecorder`, `requireAdmin`).
- `src/routes/`:
  - `login/`, `invite/[token]/`: getting in;
  - `auth/*`: the WebAuthn endpoints;
  - `healthz/`: Railway's health check.
- `src/cli.ts`: the server CLI.
- `drizzle/`: generated migrations, applied by `cli.ts migrate` (Railway's pre-deploy step).
- `tests/`: `bun test`. `e2e/`: Playwright.

## History

Before the rebuild this was an Express + MongoDB REST API, with a React UI that
was later removed. It's all in git history before the `rewrite` branch.
