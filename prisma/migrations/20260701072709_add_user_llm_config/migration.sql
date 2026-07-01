-- Add LLMConfig model for user-specific AI settings
CREATE TABLE "LLMConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "llmBaseUrl" TEXT,
    "llmApiKey" TEXT,
    "llmModel" TEXT,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LLMConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LLMConfig_userId_key" UNIQUE ("userId"),
    CONSTRAINT "LLMConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LLMConfig_userId_idx" ON "LLMConfig"("userId");
