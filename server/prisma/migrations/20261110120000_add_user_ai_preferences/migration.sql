-- CreateTable
-- Opt-in AI consent, scoped to the person and the provider configuration
-- they agreed to. All AI flags default to off or conservative.
CREATE TABLE "UserAiPreferences" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "taggingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "spellingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "onSaveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoApplyTags" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "consentedConfigKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAiPreferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserAiPreferences" ADD CONSTRAINT "UserAiPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
