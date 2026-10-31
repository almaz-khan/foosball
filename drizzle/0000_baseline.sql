CREATE SCHEMA "foosball";
--> statement-breakpoint
CREATE TABLE "foosball"."app_user" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"webauthn_id" "bytea" DEFAULT convert_to(replace(gen_random_uuid()::text, '-', ''), 'UTF8') NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_name_unique" UNIQUE("name"),
	CONSTRAINT "app_user_webauthn_id_unique" UNIQUE("webauthn_id")
);
--> statement-breakpoint
CREATE TABLE "foosball"."auth_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"webauthn_user_id" "bytea",
	CONSTRAINT "auth_challenge_purpose_check" CHECK ("foosball"."auth_challenge"."purpose" IN ('register', 'login'))
);
--> statement-breakpoint
CREATE TABLE "foosball"."auth_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}' NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "foosball"."auth_enrollment" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "foosball"."auth_session" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foosball"."game" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"started_at" timestamp (3) with time zone,
	"ended_at" timestamp (3) with time zone,
	"red_score" integer NOT NULL,
	"blue_score" integer NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"legacy_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_org_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "game_org_legacy_key" UNIQUE("org_id","legacy_id"),
	CONSTRAINT "game_scores_non_negative" CHECK ("foosball"."game"."red_score" >= 0 AND "foosball"."game"."blue_score" >= 0),
	CONSTRAINT "game_ends_after_start" CHECK ("foosball"."game"."ended_at" IS NULL OR "foosball"."game"."started_at" IS NULL OR "foosball"."game"."ended_at" >= "foosball"."game"."started_at")
);
--> statement-breakpoint
CREATE TABLE "foosball"."game_player" (
	"org_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"team" text NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "game_player_game_id_team_position_pk" PRIMARY KEY("game_id","team","position"),
	CONSTRAINT "game_player_once_key" UNIQUE("game_id","player_id"),
	CONSTRAINT "game_player_team_check" CHECK ("foosball"."game_player"."team" IN ('red', 'blue')),
	CONSTRAINT "game_player_position_check" CHECK ("foosball"."game_player"."position" IN ('offense', 'defense'))
);
--> statement-breakpoint
CREATE TABLE "foosball"."org" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_slug_unique" UNIQUE("slug"),
	CONSTRAINT "org_slug_format" CHECK ("foosball"."org"."slug" ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "foosball"."org_invite" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invited_name" text NOT NULL,
	"player_id" integer,
	"new_player_first_name" text,
	"new_player_last_name" text,
	"created_by" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	"used_by" integer,
	CONSTRAINT "org_invite_one_player" CHECK ("foosball"."org_invite"."player_id" IS NULL OR "foosball"."org_invite"."new_player_first_name" IS NULL),
	CONSTRAINT "org_invite_role_check" CHECK ("foosball"."org_invite"."role" IN ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "foosball"."org_member" (
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"player_id" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_member_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "org_member_player_key" UNIQUE("org_id","player_id"),
	CONSTRAINT "org_member_role_check" CHECK ("foosball"."org_member"."role" IN ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "foosball"."player" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"archived_at" timestamp (3) with time zone,
	"legacy_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_org_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "player_org_legacy_key" UNIQUE("org_id","legacy_id"),
	CONSTRAINT "player_first_name_present" CHECK (length(trim("foosball"."player"."first_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "foosball"."auth_credential" ADD CONSTRAINT "auth_credential_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "foosball"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."auth_enrollment" ADD CONSTRAINT "auth_enrollment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "foosball"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."auth_session" ADD CONSTRAINT "auth_session_credential_id_auth_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "foosball"."auth_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."game" ADD CONSTRAINT "game_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "foosball"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."game" ADD CONSTRAINT "game_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "foosball"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."game_player" ADD CONSTRAINT "game_player_game_fk" FOREIGN KEY ("org_id","game_id") REFERENCES "foosball"."game"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."game_player" ADD CONSTRAINT "game_player_player_fk" FOREIGN KEY ("org_id","player_id") REFERENCES "foosball"."player"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_invite" ADD CONSTRAINT "org_invite_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "foosball"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_invite" ADD CONSTRAINT "org_invite_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "foosball"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_invite" ADD CONSTRAINT "org_invite_used_by_app_user_id_fk" FOREIGN KEY ("used_by") REFERENCES "foosball"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_invite" ADD CONSTRAINT "org_invite_player_fk" FOREIGN KEY ("org_id","player_id") REFERENCES "foosball"."player"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_member" ADD CONSTRAINT "org_member_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "foosball"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_member" ADD CONSTRAINT "org_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "foosball"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."org_member" ADD CONSTRAINT "org_member_player_fk" FOREIGN KEY ("org_id","player_id") REFERENCES "foosball"."player"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foosball"."player" ADD CONSTRAINT "player_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "foosball"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_credential_user_idx" ON "foosball"."auth_credential" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_credential_idx" ON "foosball"."auth_session" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "game_org_played_idx" ON "foosball"."game" USING btree ("org_id",coalesce("ended_at", "started_at", "created_at") DESC);--> statement-breakpoint
CREATE INDEX "game_player_player_idx" ON "foosball"."game_player" USING btree ("org_id","player_id");--> statement-breakpoint
CREATE INDEX "org_member_user_idx" ON "foosball"."org_member" USING btree ("user_id");