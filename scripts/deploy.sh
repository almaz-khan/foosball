#!/usr/bin/env bash
# Deploy the current commit to production on Railway, from this machine.
#
#   bun run deploy           checks, unit + browser tests, deploy, wait until live
#   bun run deploy --quick   skip the tests (svelte-check and tsc still run)
#
# Railway builds the Dockerfile, runs `bun run src/cli.ts migrate` before the
# new release starts, and only switches traffic once /healthz answers (see
# README, "Deploy"). This script follows that deployment to the end and fails
# if it does.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE=foosball
URL=https://foosball.almaz.dev
quick=false
[[ "${1:-}" == "--quick" ]] && quick=true

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v railway >/dev/null || die "The Railway CLI is not installed: brew install railway"
railway whoami >/dev/null 2>&1 || die "Not logged in to Railway: railway login"

# Only committed code goes out, so production is always a commit you can name.
[[ -z "$(git status --porcelain)" ]] || die "Uncommitted changes. Commit or stash them first."
commit=$(git rev-parse --short HEAD)
branch=$(git rev-parse --abbrev-ref HEAD)
say "Deploying $commit ($branch): $(git log -1 --format=%s)"

say "Checks"
bun install --frozen-lockfile >/dev/null
bun run check
bun run typecheck

if ! $quick; then
  # The tests need the local Postgres from compose.yml.
  nc -z localhost 5434 2>/dev/null || die "Local Postgres is not running on :5434. Start it: docker compose up -d --wait postgres"
  say "Unit and integration tests"
  bun test
  say "Browser tests"
  bun run e2e
fi

# A message no other deployment has, to find this one in the list afterwards.
message="deploy $commit $(date -u +%Y%m%dT%H%M%SZ)"
say "Uploading and building on Railway"
railway up --ci --service "$SERVICE" --message "$message"

say "Waiting for the release: migrations, then the health check"
status=""
for _ in $(seq 1 90); do
  status=$(railway deployment list --service "$SERVICE" --limit 10 --json 2>/dev/null |
    bun -e 'const m = process.argv[1]; const d = JSON.parse(await Bun.stdin.text());
            process.stdout.write(d.find((x) => x.meta?.cliMessage === m)?.status ?? "")' "$message" || true)
  case "$status" in
    SUCCESS) break ;;
    FAILED | CRASHED | REMOVED | SKIPPED)
      die "Deployment $status. Production still runs the previous release. Logs: railway logs --service $SERVICE --deployment" ;;
  esac
  sleep 5
done
[[ "$status" == "SUCCESS" ]] || die "Still not live after 7 minutes (last status: ${status:-unknown}). Check: railway deployment list --service $SERVICE"

health=$(curl -fsS --max-time 10 "$URL/healthz" 2>/dev/null || true)
[[ -n "$health" ]] || health="not reachable from here, but the Railway health check passed"
say "Live: $commit at $URL (healthz: $health)"
