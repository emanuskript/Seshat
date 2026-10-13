-- Existing capability URLs intentionally stop granting access after this
-- migration. New sessions receive a cryptographically random token returned
-- only to the creator and embedded in the share-link fragment.
ALTER TABLE "sessions" ADD COLUMN "access_token_hash" CHAR(64);

UPDATE "sessions"
SET "access_token_hash" = md5(random()::text || clock_timestamp()::text || "id")
                        || md5(clock_timestamp()::text || random()::text || "id");

ALTER TABLE "sessions" ALTER COLUMN "access_token_hash" SET NOT NULL;
