#!/usr/bin/env bun
import { pgSchema, serial } from 'drizzle-orm/pg-core';
import { authConfig, createEnrollment, ENROLL_MINUTES, listPasskeys, revokePasskey } from './auth.ts';
import { closeDb, createDb, getDb, migrate, MIGRATIONS, type Db } from './lib/server/db/index.ts';
import { ROLES, type Role } from './lib/server/db/schema.ts';
import { createGame } from './lib/server/games.ts';
import { createInvite, InviteError, inviteHours, pendingInvites, revokeInvite, type InvitePlayer } from './lib/server/invites.ts';
import { linkPlayer, listMembers, MemberError, removeMember, setRole } from './lib/server/members.ts';
import { createOrg, findOrg, listOrgs, OrgError, type Org } from './lib/server/orgs.ts';
import { createPlayer, listPlayers, PlayerError } from './lib/server/players.ts';
import { findUser, listUsers, renameUser, UserError } from './lib/server/users.ts';

const USAGE = `foosball — command line for the server

  foosball migrate                         apply the drizzle/ migrations
  foosball seed                            a "demo" org with 4 players and 2 games (once)

  foosball org create <name> --slug <s> [--tz <zone>]
                                           a new org; games are shown in its time zone
                                           (default Europe/Prague)
  foosball org list

  foosball invite create --org <s> --name <name> [--admin]
                         [--player <id> | --new-player "<first> [last]"] [--hours <n>]
                                           a single-use link into the org; with no player the
                                           member can watch but not record games
  foosball invite list --org <s>           pending invites, with ids
  foosball invite revoke --org <s> <id>

  foosball member list --org <s>
  foosball member role --org <s> <user> admin|member
  foosball member link --org <s> <user> <player-id>|none
  foosball member remove --org <s> <user>

  foosball player list --org <s> [--all]   the roster, with ids (--all: archived too)
  foosball player add --org <s> <first> [last]

  foosball auth enroll --user <name>       one-time link: another passkey for an account (recovery)
  foosball auth list                       passkeys, with ids
  foosball auth revoke <id>                remove a passkey and end its sessions

  foosball user list                       accounts and their orgs
  foosball user rename <old> <new>

In production: railway ssh --service foosball -- bun run src/cli.ts <command>
`;

/** Refusals the domain explains in words: printed as they are, without a stack. */
const EXPECTED = [OrgError, InviteError, MemberError, PlayerError, UserError];

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  switch (command) {
    case 'migrate': return cmdMigrate();
    case 'seed': return cmdSeed();
    case 'org': return cmdOrg(flags, positional);
    case 'invite': return cmdInvite(flags, positional);
    case 'member': return cmdMember(flags, positional);
    case 'player': return cmdPlayer(flags, positional);
    case 'auth': return cmdAuth(flags, positional);
    case 'user': return cmdUser(positional);
    case undefined:
    case '-h':
    case '--help': process.stdout.write(USAGE); return 0;
    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

class Usage extends Error {}

type Flags = Record<string, string>;

// ---------------------------------------------------------------- database

/** The migrator's own table, declared only to count its rows; drizzle-kit never sees it. */
const migrationsTable = pgSchema(MIGRATIONS.migrationsSchema).table(MIGRATIONS.migrationsTable, { id: serial('id') });

async function cmdMigrate(): Promise<number> {
  // Migrations may run as a more privileged role than the app (MIGRATION_DATABASE_URL).
  const url = process.env.MIGRATION_DATABASE_URL;
  const db = url ? createDb(url) : getDb();
  const applied = () => db.$count(migrationsTable).catch(() => 0);
  const before = await applied();
  await migrate(db);
  const after = await applied();
  if (url) await db.$client.end({ timeout: 5 });
  console.log(after > before ? `applied ${after - before} migration(s); ${after} in total` : `schema already current (${after} migrations)`);
  return 0;
}

/** The old app's development seed, in an org of its own. Does nothing if it is already there. */
export async function seedDemo(db: Db = getDb()): Promise<'created' | 'exists'> {
  if (await findOrg('demo', db)) return 'exists';
  return db.transaction(async (tx) => {
    const demo = await createOrg('Demo', 'demo', tx);
    const [a, b, c, d] = await Promise.all(
      [
        { firstName: 'Jimmylo', lastName: 'Xoko' },
        { firstName: 'Xoko', lastName: 'Jimmylo' },
        { firstName: 'Katamon', lastName: 'Jameson' },
        { firstName: 'Jameson', lastName: 'Katamon' },
      ].map((p) => createPlayer(demo.id, p, tx)),
    );
    const now = Date.now();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
    const seats = { blue: { offense: a!.id, defense: b!.id }, red: { offense: c!.id, defense: d!.id } };
    await createGame(demo.id, { startedAt: at(40), endedAt: at(30), red: { score: 0, ...seats.red }, blue: { score: 3, ...seats.blue }, source: 'seed' }, null, tx);
    await createGame(demo.id, { startedAt: at(20), endedAt: at(10), red: { score: 3, ...seats.red }, blue: { score: 2, ...seats.blue }, source: 'seed' }, null, tx);
    return 'created' as const;
  });
}

async function cmdSeed(): Promise<number> {
  const result = await seedDemo();
  console.log(result === 'created' ? 'seeded org "demo": 4 players, 2 games' : 'org "demo" already exists; nothing changed');
  return 0;
}

// ---------------------------------------------------------------- orgs, invites, members, players

async function orgFlag(flags: Flags): Promise<Org> {
  if (!flags.org) throw new Usage('--org <slug> is required (see `foosball org list`)');
  const org = await findOrg(flags.org);
  if (!org) throw new OrgError(`no org "${flags.org}" — see \`foosball org list\``);
  return org;
}

async function cmdOrg(flags: Flags, [sub, ...names]: string[]): Promise<number> {
  switch (sub) {
    case 'create': {
      const name = names.join(' ');
      if (!name || !flags.slug) throw new Usage('foosball org create <name> --slug <slug> [--tz <zone>]');
      const org = await createOrg(name, flags.slug, undefined, flags.tz || undefined);
      console.log(`created org "${org.name}" (${org.slug}), times in ${org.timeZone}`);
      console.log(`next: foosball invite create --org ${org.slug} --name <your name> --admin`);
      return 0;
    }
    case 'list': {
      const orgs = await listOrgs();
      if (orgs.length === 0) console.log('no orgs — run `foosball org create <name> --slug <slug>`');
      for (const o of orgs) console.log(`  ${String(o.id).padStart(3)}  ${o.slug.padEnd(20)} ${o.name.padEnd(24)} ${o.timeZone}`);
      return 0;
    }
    default:
      throw new Usage('foosball org create <name> --slug <slug> | list');
  }
}

async function cmdInvite(flags: Flags, [sub, id]: string[]): Promise<number> {
  const org = await orgFlag(flags);
  switch (sub) {
    case 'create': {
      if (!flags.name) throw new Usage('foosball invite create --org <slug> --name <name> [--admin] [--player <id> | --new-player "<first> [last]"]');
      let player: InvitePlayer = null;
      if (flags.player && flags['new-player']) throw new Usage('give --player or --new-player, not both');
      if (flags.player) player = { playerId: positiveInt(flags.player, '--player') };
      if (flags['new-player']) {
        const [firstName = '', ...last] = flags['new-player'].trim().split(/\s+/);
        player = { firstName, lastName: last.join(' ') || null };
      }
      const hours = flags.hours ? positiveInt(flags.hours, '--hours') : inviteHours();
      const role: Role = 'admin' in flags ? 'admin' : 'member';
      const { token, expiresAt } = await createInvite({ orgId: org.id, invitedName: flags.name, role, player, hours });
      const { origin } = authConfig();
      console.log(`Invite for ${flags.name} to "${org.name}" as ${role}${player ? '' : ' (no player: can watch, not record)'}.`);
      console.log(`Send them this link; it works once:\n\n  ${origin}/invite/${token}\n`);
      console.log(`It expires ${expiresAt.toLocaleString()}.`);
      return 0;
    }
    case 'list': {
      const invites = await pendingInvites(org.id);
      if (invites.length === 0) console.log('no pending invites');
      for (const i of invites) {
        console.log(`  ${i.id.slice(0, 12)}  ${i.invitedName.padEnd(16)} ${i.role.padEnd(7)} ${(i.playerName ?? '—').padEnd(20)} until ${i.expiresAt.toLocaleString()}`);
      }
      return 0;
    }
    case 'revoke': {
      if (!id) throw new Usage('foosball invite revoke --org <slug> <id>   (ids from `invite list`)');
      const match = (await pendingInvites(org.id)).filter((i) => i.id.startsWith(id));
      if (match.length !== 1) {
        console.error(match.length ? `"${id}" matches ${match.length} invites; give more of the id` : `no pending invite ${id}`);
        return 1;
      }
      await revokeInvite(org.id, match[0]!.id);
      console.log(`revoked the invite for ${match[0]!.invitedName}`);
      return 0;
    }
    default:
      throw new Usage('foosball invite create | list | revoke --org <slug>');
  }
}

async function cmdMember(flags: Flags, [sub, userName, arg]: string[]): Promise<number> {
  const org = await orgFlag(flags);
  if (sub === 'list') {
    const members = await listMembers(org.id);
    if (members.length === 0) console.log('no members — invite someone with `foosball invite create`');
    for (const m of members) {
      console.log(`  ${m.userName.padEnd(20)} ${m.role.padEnd(7)} ${m.playerName ? `plays as ${m.playerName} (#${m.playerId})` : 'watches (no player)'}`);
    }
    return 0;
  }
  if (!userName) throw new Usage('foosball member role|link|remove --org <slug> <user> ...');
  const user = await findUser(userName);
  if (!user) throw new UserError(`no account "${userName}" — see \`foosball user list\``);
  const notMember = () => {
    console.error(`${user.name} is not a member of "${org.name}"`);
    return 1;
  };
  switch (sub) {
    case 'role': {
      if (!ROLES.includes(arg as Role)) throw new Usage('foosball member role --org <slug> <user> admin|member');
      if (!(await setRole(org.id, user.id, arg as Role))) return notMember();
      console.log(`${user.name} is now ${arg} of "${org.name}"`);
      return 0;
    }
    case 'link': {
      if (!arg) throw new Usage('foosball member link --org <slug> <user> <player-id>|none');
      const playerId = arg === 'none' ? null : positiveInt(arg, 'player id');
      if (!(await linkPlayer(org.id, user.id, playerId))) return notMember();
      console.log(playerId === null ? `${user.name} is no longer linked to a player` : `${user.name} now plays as player #${playerId}`);
      return 0;
    }
    case 'remove': {
      if (!(await removeMember(org.id, user.id))) return notMember();
      console.log(`removed ${user.name} from "${org.name}"`);
      return 0;
    }
    default:
      throw new Usage('foosball member list | role | link | remove --org <slug>');
  }
}

async function cmdPlayer(flags: Flags, [sub, first, ...last]: string[]): Promise<number> {
  const org = await orgFlag(flags);
  switch (sub) {
    case 'list': {
      const players = await listPlayers(org.id, { includeArchived: 'all' in flags });
      if (players.length === 0) console.log('no players');
      for (const p of players) console.log(`  ${String(p.id).padStart(4)}  ${p.name}${p.archived ? '  (archived)' : ''}`);
      return 0;
    }
    case 'add': {
      if (!first) throw new Usage('foosball player add --org <slug> <first> [last]');
      const p = await createPlayer(org.id, { firstName: first, lastName: last.join(' ') || null });
      console.log(`added ${p.name} (#${p.id}) to "${org.name}"`);
      return 0;
    }
    default:
      throw new Usage('foosball player list | add --org <slug>');
  }
}

// ---------------------------------------------------------------- accounts

async function cmdAuth(flags: Flags, [sub, arg]: string[]): Promise<number> {
  switch (sub) {
    case 'enroll': {
      if (!flags.user) throw new Usage('foosball auth enroll --user <name>   (new accounts come from `invite create`)');
      const user = await findUser(flags.user);
      if (!user) throw new UserError(`no account "${flags.user}" — see \`foosball user list\``);
      const { origin } = authConfig();
      const { token, expiresAt } = await createEnrollment(user.id);
      console.log(`This link adds a passkey to ${user.name}'s account.`);
      console.log(`Open it in the browser that should get the passkey:\n\n  ${origin}/login?enroll=${token}\n`);
      console.log(`It works once and expires at ${expiresAt.toLocaleTimeString()} (${ENROLL_MINUTES} minutes).`);
      return 0;
    }
    case 'list': {
      const keys = await listPasskeys(null);
      if (keys.length === 0) console.log('no passkeys');
      for (const k of keys) {
        const used = k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 10) : 'never';
        console.log(`  ${k.id}  ${k.userName.padEnd(16)} ${k.name.padEnd(16)} added ${k.createdAt.toISOString().slice(0, 10)}  last used ${used}`);
      }
      return 0;
    }
    case 'revoke': {
      if (!arg) throw new Usage('foosball auth revoke <id>   (ids from `auth list`)');
      if (!(await revokePasskey(arg, null))) {
        console.error(`no passkey with id ${arg}`);
        return 1;
      }
      console.log('revoked; every session it opened is signed out');
      return 0;
    }
    default:
      throw new Usage('foosball auth enroll | list | revoke');
  }
}

async function cmdUser([sub, from, to]: string[]): Promise<number> {
  switch (sub) {
    case 'list': {
      const users = await listUsers();
      if (users.length === 0) console.log('no accounts yet');
      for (const u of users) {
        console.log(`  ${String(u.id).padStart(3)}  ${u.name.padEnd(20)} ${u.passkeys} passkey(s)   ${u.orgs.join(', ') || 'no org'}`);
      }
      return 0;
    }
    case 'rename': {
      if (!from || !to) throw new Usage('foosball user rename <old> <new>');
      if (!(await renameUser(from, to))) {
        console.error(`no account "${from}"`);
        return 1;
      }
      console.log(`renamed "${from}" to "${to}"`);
      return 0;
    }
    default:
      throw new Usage('foosball user list | rename <old> <new>');
  }
}

// ---------------------------------------------------------------- arguments

function positiveInt(value: string, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Usage(`${what} must be a positive whole number, not "${value}"`);
  return n;
}

function parseArgs(args: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split('=', 2);
    // A flag followed by another flag, or by nothing, is a switch: `--admin --org x`.
    // `--admin` and `--all` never take a value, so a positional after them stays positional.
    const next = args[i + 1];
    const isSwitch = name === 'admin' || name === 'all';
    flags[name!] = inline ?? (!isSwitch && next !== undefined && !next.startsWith('--') ? (i++, next) : '');
  }
  return { flags, positional };
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof Usage) {
      process.stderr.write(`usage: ${err.message}\n`);
      process.exitCode = 2;
    } else if (EXPECTED.some((E) => err instanceof E)) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } else {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}
