CREATE TABLE "foosball"."hub_login" (
	"id_hash" "bytea" PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"next" text DEFAULT '/' NOT NULL,
	"silent" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foosball"."user_session" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"hub_checked_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foosball"."app_user" ADD COLUMN "hub_sub" text;--> statement-breakpoint
ALTER TABLE "foosball"."user_session" ADD CONSTRAINT "user_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "foosball"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_session_user_idx" ON "foosball"."user_session" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "foosball"."app_user" ADD CONSTRAINT "app_user_hub_sub_unique" UNIQUE("hub_sub");