ALTER TABLE "foosball"."game" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "foosball"."game" ADD CONSTRAINT "game_org_client_key" UNIQUE("org_id","client_key");