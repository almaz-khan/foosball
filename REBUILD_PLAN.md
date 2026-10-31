# Foosball — Rebuild Plan

## 1. What the current app does

A small REST API (Express 4 + Mongoose 6 + MongoDB, Node 16) for recording 2v2 foosball games. The repo is API-only today. A React (CRA + reactstrap) frontend lived in `public/` and was removed in `ab33a4a`.

### Domain
| Entity | Fields | Notes |
|---|---|---|
| **Player** | `firstName` (required), `lastName` | People who play. Not linked to login users. |
| **Game** | `startDate`, `endDate`, `source` (string, e.g. `"reactApp"`), `metadata` (free-form object), `red: {score, offense, defense}`, `blue: {score, offense, defense}` | Each team has an offense and a defense player (refs to Player). Both scores are required. |
| **User** | `username` (unique), `password` (bcrypt) | Only used to log in. |

### Endpoints
| Method & path | Behaviour |
|---|---|
| `GET /api/players` | List all players |
| `POST /api/players` | Create a player |
| `GET/PUT/DELETE /api/players/:id` | Read, merge-update or delete a player |
| `GET /api/games` | List games with all 4 players populated. Filters: `source`, `startDate[$gte/$lte]`, `endDate[$gte/$lte]`, `skip`, `limit` |
| `POST /api/games` | Create a game and return it with players populated |
| `GET/PUT/DELETE /api/games/:id` | Read, merge-update or delete a game |
| `POST /auth/signin` | Check username and password, return a JWT (HS256, 10-day expiry) |
| `/swagger/api-docs` | Swagger UI generated from JSDoc comments |
| *(written but never mounted)* `/api/users` | Signup (returns a token), `me`, list, update, delete |

### Removed frontend (from git history)
- Log in, then store the JWT in `localStorage`.
- Pick 4 players from a list. They fill red-defense, red-offense, blue-defense and blue-offense in that order.
- **Start game** records the start time. Each team gets a `+` button and a number input for its score. **Finish game** POSTs the game with `source: "reactApp"`.

### Dev and ops
- `docker-compose-dev.yml`: app plus `mongo:3.6`. In development, `seed.js` **wipes the DB on every boot** and inserts 4 players and 2 games.
- Deployed to Heroku (`Procfile`). Config comes from `MONGODB_URI`, `JWT` and `PORT`.

### Problems the rewrite should fix
1. **No auth on games or players.** `checkUser` is defined in `gameRoutes.js` but never applied, so anyone can create or delete data.
2. **No way to create a user.** The user router is never mounted in `api/api.js`, so signup is unreachable.
3. **`userController.getOne` crashes**: it calls `toJson()` twice.
4. **NoSQL operator injection.** `GET /api/games` passes `req.query` straight into `Game.find()`.
5. **Mass assignment.** `PUT` handlers `_.merge` the raw body into the document, with no validation.
6. **Insecure defaults.** The JWT secret falls back to `'gumball'`, and tokens are accepted in the query string.
7. **Wrong status codes.** A missing ID returns 500 `"Oops"` instead of 404. Nothing returns 400 for validation errors.
8. **No integrity checks.** Deleting a player leaves games pointing at nothing. There is no check that the 4 players are distinct, that scores are ≥ 0, or that `endDate ≥ startDate`.
9. **Swagger is maintained by hand.** It lives in JSDoc comments, so it drifts from the code.
10. **Outdated runtime and dependencies.** Node 16 and Mongo 3.6 are EOL. `body-parser` and `method-override` aren't needed. `csv-express` and `flatten` are imported but unused (CSV export was probably planned). There are zero tests.

---

## 2. Decisions

| | Decision |
|---|---|
| App | **One SvelteKit app (Svelte 5), full-stack**: pages, form actions and server code in one codebase. No separate backend |
| Template | **The budget app** (`~/workspace/budget`): same runtime, database layer, passkey auth, CLI, tests, CI and Railway setup |
| Runtime | **Bun** (`adapter-node` build served by Bun) |
| Database | **PostgreSQL** with **Drizzle ORM** + drizzle-kit migrations, in its own `foosball` schema |
| Accounts | **Invite-only, passkeys only** (budget's `auth.ts`). Accounts are global; access comes from org membership |
| Orgs | An **org** (e.g. "the office") owns its players and games. Schema and permissions are org-scoped from day one. Launches with **one org**, created from the CLI. The org switcher appears only for someone in 2+ orgs |
| Membership | `org_member(org, user, role: admin\|member, player_id?)`. **Nothing is public**: every page needs a member of the org |
| Permissions | **View** games, players and dashboard: any member. **Record** a game: a member linked to a player, for any game in the org. **Edit/delete** a game: its creator or an org admin. **Manage** members, invites and players: org admins. A member with no linked player is a viewer |
| Players | Belong to an org and **don't need an account** (imported players, guests). Admins link them to members, at most one per member and one per player within an org |
| Dashboard | Recent games + standings per player: played, won, win %, goals for/against, best partner. Plain SQL, no rating system yet |
| Mongo data | One-off import command once the backups are available |
| Other `source`s | Ignored for now. Games keep `source` and `metadata`, so a JSON API with API keys can be added later |
| Hosting | **Railway**: one service plus Railway Postgres, at **`foosball.almaz.dev`**. Passkeys are bound to this hostname, so set it before enrolling anyone |

---

## 3. Stack (mirrors budget)

| Concern | Choice |
|---|---|
| Framework | SvelteKit 3 (`@sveltejs/adapter-node`), Svelte 5 runes, TypeScript strict (`noUncheckedIndexedAccess`) |
| Runtime / package manager | Bun 1.3 (`bun.lock`) |
| DB | `postgres` (postgres.js) + `drizzle-orm`. Migrations generated by `drizzle-kit generate` into `drizzle/` and applied by `bun run src/cli.ts migrate` (Railway pre-deploy) |
| Passkeys | `@simplewebauthn/server` + `@simplewebauthn/browser`, ported from budget. Keeps: ASCII user handles, discoverable credentials with UV required, the user identified by credential id + signature, single-use challenges, hashed session tokens with a 30-day sliding expiry, and sessions ending when their passkey is revoked |
| Rate limiting | Budget's in-memory fixed-window limiter on `POST /auth/*` (one replica) |
| UI | Plain CSS with custom properties (light + dark), like budget. No component library |
| Unit / integration tests | `bun test` against a throwaway Postgres database (`tests/helpers/testdb.ts`) |
| E2E | Playwright against the production build, signed in through Chromium's virtual authenticator |
| CI / deploy | GitHub Actions: `svelte-check`, `tsc`, migrations-in-sync check, `bun test`, build, Playwright. Then `railway up` on `main` |
| Container | `oven/bun` image. The CLI ships alongside the server so `railway ssh` can run it |

---

## 4. Layout

```
foosball/
├─ src/
│  ├─ auth.ts                    passkeys, enrollment links, sessions (from budget)
│  ├─ cli.ts                     migrate · seed · org · invite · member · auth · user · import-mongo
│  ├─ hooks.server.ts            session → locals, rate limit, write guard, security headers
│  ├─ lib/
│  │  ├─ passkeys.ts             browser side of sign-in and enrollment
│  │  ├─ server/
│  │  │  ├─ db/index.ts          createDb / getDb / migrate
│  │  │  ├─ db/schema.ts         Drizzle schema (pg schema "foosball")
│  │  │  ├─ auth.ts              cookie options, safeNext, authFailure, requireUser/requireAdmin
│  │  │  ├─ rate-limit.ts
│  │  │  ├─ orgs.ts              orgs, memberships, permission rules (canView/canRecord/canManage/canEditGame)
│  │  │  ├─ invites.ts           org invites: create, describe, accept
│  │  │  ├─ users.ts             findUser, getUser, listUsers, renameUser
│  │  │  ├─ players.ts           list, get, create, update, archive/delete
│  │  │  ├─ games.ts             list (filters + paging), get, create, update, delete, validation
│  │  │  └─ standings.ts         dashboard stats
│  │  └─ components/             Scoreboard, PlayerPicker, GameRow, …
│  └─ routes/
│     ├─ +page                   dashboard: recent games + standings
│     ├─ play/                   pick 4 players → live scoreboard → save
│     ├─ games/  games/[id]/     history with filters; one game (edit/delete when signed in)
│     ├─ players/ players/[id]/  roster; one player's games
│     ├─ login/                  sign in, or add a passkey from ?enroll=<token>
│     ├─ invite/[token]/         join an org (and create an account) from an invite
│     ├─ account/                my passkeys: add, rename, revoke
│     ├─ admin/                  invites, members, roles, player links (org admins)
│     ├─ auth/{login,register}/{options,verify}, auth/logout
│     └─ healthz/
├─ drizzle/                      generated migrations
├─ tests/                        bun test (domain + auth against Postgres)
├─ e2e/                          Playwright
├─ Dockerfile · railway.json · compose.yml (local Postgres) · .env.example
└─ .github/workflows/ci.yml
```

### Data model (`foosball` schema)
```
org              id serial pk, name text not null, slug text unique not null,
                 time_zone text not null default 'Europe/Prague' (games are shown and filtered in it), created_at
app_user         id serial pk, name text unique, webauthn_id bytea unique (ASCII handle), created_at
org_member       org_id → org (cascade), user_id → app_user (cascade), role ('admin'|'member'),
                 player_id → player null (set null), created_at,
                 pk (org_id, user_id), unique (org_id, player_id)
                 -- player_id's org must equal org_id: composite FK (org_id, player_id) → player (org_id, id)
player           id serial pk, org_id → org (cascade), first_name text not null, last_name text,
                 archived_at timestamptz, legacy_id text, created_at, updated_at,
                 unique (org_id, id), unique (org_id, legacy_id)
game             id serial pk, org_id → org (cascade), started_at, ended_at,
                 red_score int not null ≥0, blue_score int not null ≥0,
                 source text not null default 'web', metadata jsonb not null default '{}',
                 created_by int → app_user (set null), legacy_id text, created_at, updated_at,
                 unique (org_id, id), unique (org_id, legacy_id),
                 check (ended_at is null or started_at is null or ended_at >= started_at)
game_player      org_id, game_id, player_id, team ('red'|'blue'), position ('offense'|'defense'),
                 pk (game_id, team, position), unique (game_id, player_id),
                 fk (org_id, game_id) → game (org_id, id) cascade,
                 fk (org_id, player_id) → player (org_id, id) restrict
auth_credential  as budget (id, user_id, public_key, counter, transports, name, created_at, last_used_at)
auth_session     as budget (token_hash, credential_id → cascade, created_at, expires_at)
auth_challenge   as budget
auth_enrollment  as budget: a single-use link to add a passkey to an existing account (recovery, new device)
org_invite       token_hash pk, org_id, role, player_id null, new_player_name null, invited_name,
                 created_by → app_user, expires_at, used_at, used_by → app_user
```
- **Data stays inside its org:** composite foreign keys that include `org_id` stop the database from attaching a game to another org's players or a member to another org's player, even if a query forgets to filter. Budget does the same with `budget_id`.
- **Distinct players:** the database enforces "4 different players, one per slot".
- **Deleting a player:** a player with games is archived; a player without games is deleted.
- **Game shape:** the old `{red:{score,offense,defense}, blue:{…}}` shape is assembled in `games.ts`.

### Access rules (`hooks.server.ts` + `requireMember` / `requireRecorder` / `requireAdmin`)
- **Public:** only `/login`, `/invite/[token]`, `/auth/*` and `/healthz`.
- **Signed out:** pages redirect to `/login?next=…`; writes get 401.
- **Signed in, no org:** a page saying "ask for an invite".
- **One org:** routes act on it.
- **2+ orgs:** the current org is kept in a cookie and can be switched from the header.
- **Checks:**
  - recording needs `member.player_id`;
  - editing or deleting a game needs `created_by = me` or role admin;
  - `/admin` needs role admin.

### Accounts and invites
- **Setting up the first org** (CLI only, through `railway ssh --service foosball -- bun run src/cli.ts …`):
  - `org create "Office" --slug office`
  - `invite create --org office --name Almaz --admin [--player <id> | --new-player "Almaz K"]`
  This prints `/invite/<token>`, valid for 48h.
- **Opening an invite:**
  - Someone signed out names the device and creates a passkey. That creates the account, adds the membership and signs them in.
  - Someone already signed in just joins the org. There is no second account.
- **What an invite can link to:**
  - an existing player (e.g. one imported from Mongo);
  - a new player it creates;
  - no player at all, which makes the person a viewer.
- **Admin page:** `/admin` creates invites, changes roles, links and unlinks players, and removes members.
- **Recovery:** an admin, or `auth enroll --user <name>` in the CLI, makes an "add a passkey" link for an existing account. Signed-in people add devices from `/account`.
- **CLI parity with budget:** `auth list|revoke`, `user list|rename`, `org list`, `member list|role|link`.

---

## 5. Phases

| # | Phase | Contents |
|---|---|---|
| 0 | Scaffold | `rewrite` branch, old Express code removed, SvelteKit + Bun + Drizzle wired, `compose.yml` Postgres, `/healthz`, Dockerfile, `railway.json`, `.env.example` |
| 1 | Schema | Tables above, first migration, `cli.ts migrate` + idempotent `seed` (a "Demo" org with the old 4 players and 2 games), test DB helper, domain tests for games, players and org isolation |
| 2 | Auth & orgs | Port `auth.ts`, the auth routes, `/login`, hooks, rate limit. Add org invites, `/invite/[token]`, membership checks, CLI `org`/`invite`/`member`/`auth`/`user`. Tests |
| 3 | Players & games | `/players`, `/games` (filters: player, date range; paging), `/games/[id]` edit and delete (creator or admin) |
| 4 | Play | `/play` (linked members only): 4 labelled slots (tap to fill, swap), Start → big scoreboard with +/− and clock, Finish saves. A game in progress survives a refresh (`localStorage`) |
| 5 | Dashboard | `/`: recent games + standings (played, won, win %, goals for/against, best partner), filterable by period |
| 6 | Account & admin | `/account` passkeys and orgs. `/admin`: invites, members, roles, player links |
| 7 | E2E + CI | Playwright: invite → passkey → link player → play → dashboard; viewer can't record; revoke. GitHub Actions as in budget |
| 8 | Railway | Project, Postgres, env vars, `foosball.almaz.dev`, first org and admin, `RAILWAY_TOKEN` for CI deploys |
| 9 | Mongo import | `cli.ts import-mongo <path> --org <slug>`: reads `mongoexport` JSON or `mongodump` BSON, dry run by default, `legacy_id` makes re-runs idempotent, bad games are reported and skipped |

**Later:**
- ELO/TrueSkill ratings and per-position stats.
- CSV export.
- A JSON API with API keys for other `source`s.
- A live scoreboard over SSE.
- A read-only "TV" link for an office screen.
- Creating orgs from the app.

---

## 6. Environment

| Var | Local | Railway |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5434/foosball` | `${{Postgres.DATABASE_URL}}` |
| `FOOSBALL_ORIGIN` | `http://localhost:5180` | `https://foosball.almaz.dev` |
| `ADDRESS_HEADER` | – | `X-Real-IP` (client address for rate limiting) |
| `PROTOCOL_HEADER` / `HOST_HEADER` | – | `x-forwarded-proto` / `x-forwarded-host` (adapter-node behind Railway's edge) |
| `INVITE_HOURS` | `48` | `48` |
