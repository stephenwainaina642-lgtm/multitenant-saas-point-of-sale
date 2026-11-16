-- Additive only: tokens issued before this moment are rejected. NULL (every existing user) means "no cut-off".
ALTER TABLE "users" ADD COLUMN "sessions_valid_after" TIMESTAMPTZ(6);
