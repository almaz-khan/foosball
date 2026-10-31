import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Everything lives in its own Postgres schema.
 *
 * Data is scoped by org. Every reference between org data carries org_id in
 * its foreign key, so the database itself refuses a game pointing at another
 * org's player, or a member linked to another org's player, even if a query
 * forgets to filter.
 */
export const foosballSchema = pgSchema('foosball');

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
/**
 * Millisecond precision, what a JS Date holds: a value read back compares equal
 * to the one stored, which keeps the games list's page cursors exact.
 */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];
export const TEAMS = ['red', 'blue'] as const;
export type Team = (typeof TEAMS)[number];
export const POSITIONS = ['offense', 'defense'] as const;
export type Position = (typeof POSITIONS)[number];

// ---------------------------------------------------------------- orgs and people

export const org = foosballSchema.table('org', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** Short, URL-safe handle used by the CLI: `--org office`. */
  slug: text('slug').notNull().unique(),
  /** The IANA zone the org's games are shown and filtered in: one table, one clock. */
  timeZone: text('time_zone').notNull().default('Europe/Prague'),
  createdAt: createdAt(),
}, (t) => [check('org_slug_format', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`)]);

export const appUser = foosballSchema.table('app_user', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  // WebAuthn user handle. ASCII (32 random hex characters) rather than raw
  // bytes: some password managers (NordPass) decode user.id as UTF-8 text and
  // re-encode it, turning every non-UTF-8 byte into U+FFFD for good.
  webauthnId: bytea('webauthn_id')
    .notNull()
    .unique()
    .default(sql`convert_to(replace(gen_random_uuid()::text, '-', ''), 'UTF8')`),
  createdAt: createdAt(),
});

/** Someone who plays (or played) in an org. Needs no account: guests and imported players are rows here too. */
export const player = foosballSchema.table('player', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  /** Hidden from pickers but kept, because games reference them. */
  archivedAt: timestamptz('archived_at'),
  /** The Mongo ObjectId this row was imported from; makes re-imports idempotent. */
  legacyId: text('legacy_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique('player_org_id_key').on(t.orgId, t.id),
  unique('player_org_legacy_key').on(t.orgId, t.legacyId),
  check('player_first_name_present', sql`length(trim(${t.firstName})) > 0`),
]);

/**
 * An account's place in an org. Role says what they may manage; a linked
 * player says who they are at the table, and is what lets them record games.
 * Members without a player can only look.
 */
export const orgMember = foosballSchema.table('org_member', {
  orgId: integer('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ROLES }).notNull().default('member'),
  playerId: integer('player_id'),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.userId] }),
  // One account per player and one player per account, within an org.
  unique('org_member_player_key').on(t.orgId, t.playerId),
  // The linked player must belong to the same org. A plain SET NULL would also
  // clear org_id (part of the key), so deleting a linked player is refused here
  // and players.ts unlinks the member first, in the same transaction.
  foreignKey({ name: 'org_member_player_fk', columns: [t.orgId, t.playerId], foreignColumns: [player.orgId, player.id] }),
  check('org_member_role_check', sql`${t.role} IN ('admin', 'member')`),
  index('org_member_user_idx').on(t.userId),
]);

// ---------------------------------------------------------------- games

export const game = foosballSchema.table('game', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  startedAt: timestamptz('started_at'),
  endedAt: timestamptz('ended_at'),
  redScore: integer('red_score').notNull(),
  blueScore: integer('blue_score').notNull(),
  /** Where the game was recorded: 'web' here; 'reactApp' and others in imported history. */
  source: text('source').notNull().default('web'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  /** Who recorded it: they may edit or delete it, as may the org's admins. */
  createdBy: integer('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  legacyId: text('legacy_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique('game_org_id_key').on(t.orgId, t.id),
  unique('game_org_legacy_key').on(t.orgId, t.legacyId),
  check('game_scores_non_negative', sql`${t.redScore} >= 0 AND ${t.blueScore} >= 0`),
  check('game_ends_after_start', sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  index('game_org_played_idx').on(t.orgId, sql`coalesce(${t.endedAt}, ${t.startedAt}, ${t.createdAt}) DESC`),
]);

/** The four seats of a 2v2 game: one player per team and position, each player once. */
export const gamePlayer = foosballSchema.table('game_player', {
  orgId: integer('org_id').notNull(),
  gameId: integer('game_id').notNull(),
  playerId: integer('player_id').notNull(),
  team: text('team', { enum: TEAMS }).notNull(),
  position: text('position', { enum: POSITIONS }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.gameId, t.team, t.position] }),
  unique('game_player_once_key').on(t.gameId, t.playerId),
  foreignKey({ name: 'game_player_game_fk', columns: [t.orgId, t.gameId], foreignColumns: [game.orgId, game.id] })
    .onDelete('cascade'),
  foreignKey({ name: 'game_player_player_fk', columns: [t.orgId, t.playerId], foreignColumns: [player.orgId, player.id] })
    .onDelete('restrict'),
  check('game_player_team_check', sql`${t.team} IN ('red', 'blue')`),
  check('game_player_position_check', sql`${t.position} IN ('offense', 'defense')`),
  index('game_player_player_idx').on(t.orgId, t.playerId),
]);

// ---------------------------------------------------------------- invites

/**
 * A single-use link into an org. Opened signed out, it creates an account with
 * a passkey; opened signed in, it adds the membership to that account. It may
 * link the member to an existing player, create a new player, or neither
 * (a viewer).
 */
export const orgInvite = foosballSchema.table('org_invite', {
  tokenHash: bytea('token_hash').primaryKey(),
  orgId: integer('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ROLES }).notNull().default('member'),
  /** The name a new account gets; someone already signed in keeps theirs. */
  invitedName: text('invited_name').notNull(),
  playerId: integer('player_id'),
  newPlayerFirstName: text('new_player_first_name'),
  newPlayerLastName: text('new_player_last_name'),
  createdBy: integer('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  expiresAt: timestamptz('expires_at').notNull(),
  usedAt: timestamptz('used_at'),
  usedBy: integer('used_by').references(() => appUser.id, { onDelete: 'set null' }),
}, (t) => [
  foreignKey({ name: 'org_invite_player_fk', columns: [t.orgId, t.playerId], foreignColumns: [player.orgId, player.id] })
    .onDelete('cascade'),
  check('org_invite_one_player', sql`${t.playerId} IS NULL OR ${t.newPlayerFirstName} IS NULL`),
  check('org_invite_role_check', sql`${t.role} IN ('admin', 'member')`),
]);

// ---------------------------------------------------------------- passkeys (as in budget)

export const authCredential = foosballSchema.table('auth_credential', {
  id: text('id').primaryKey(), // base64url credential id
  userId: integer('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  publicKey: bytea('public_key').notNull(), // COSE-encoded
  counter: bigint('counter', { mode: 'number' }).notNull().default(0), // 0 forever on synced passkeys
  transports: text('transports').array().notNull().default(sql`'{}'`),
  name: text('name').notNull(), // "MacBook", "iPhone"
  createdAt: createdAt(),
  lastUsedAt: timestamptz('last_used_at'),
}, (t) => [index('auth_credential_user_idx').on(t.userId)]);

export const authSession = foosballSchema.table('auth_session', {
  tokenHash: bytea('token_hash').primaryKey(),
  credentialId: text('credential_id').notNull().references(() => authCredential.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  expiresAt: timestamptz('expires_at').notNull(),
}, (t) => [index('auth_session_credential_idx').on(t.credentialId)]);

/** A single-use link that adds a passkey to an existing account: a new device, or recovery. */
export const authEnrollment = foosballSchema.table('auth_enrollment', {
  tokenHash: bytea('token_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  expiresAt: timestamptz('expires_at').notNull(),
  usedAt: timestamptz('used_at'),
});

export const authChallenge = foosballSchema.table('auth_challenge', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose', { enum: ['register', 'login'] }).notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  webauthnUserId: bytea('webauthn_user_id'),
}, (t) => [check('auth_challenge_purpose_check', sql`${t.purpose} IN ('register', 'login')`)]);
