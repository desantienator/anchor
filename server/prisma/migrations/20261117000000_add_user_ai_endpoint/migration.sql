-- AlterTable
-- A person's own AI destination: the effective configuration is the person's
-- value when set, otherwise the server's environment.
ALTER TABLE "UserAiPreferences" ADD COLUMN "baseUrl" TEXT;
ALTER TABLE "UserAiPreferences" ADD COLUMN "model" TEXT;
ALTER TABLE "UserAiPreferences" ADD COLUMN "apiKey" TEXT;
