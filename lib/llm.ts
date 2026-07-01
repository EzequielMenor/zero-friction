// LLM clients scoped per-user with DB config + env fallback.
// No eager construction — OpenAI SDK throws when API key is absent at
// module evaluation time (breaks `next build` with missing env vars).
// Clients are created inside async functions so the key can be absent
// until first use.

import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'

const DEFAULT_LLM_MODEL = 'gpt-4o-mini'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_WHISPER_MODEL = 'whisper-1'

export async function getLlmForUser(userId: string): Promise<{
  client: OpenAI
  model: string
  embeddingModel: string
}> {
  const cfg = await prisma.lLMConfig.findUnique({ where: { userId } })
  const apiKey = cfg?.llmApiKey || process.env.LLM_API_KEY
  const baseURL = cfg?.llmBaseUrl || process.env.LLM_BASE_URL
  return {
    client: new OpenAI({ apiKey, baseURL }),
    model: cfg?.llmModel || process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
    embeddingModel:
      cfg?.embeddingModel || process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  }
}

export async function getWhisperForUser(userId: string): Promise<{
  client: OpenAI
  model: string
}> {
  const cfg = await prisma.lLMConfig.findUnique({ where: { userId } })
  const apiKey = cfg?.llmApiKey || process.env.WHISPER_API_KEY || process.env.LLM_API_KEY
  const baseURL =
    cfg?.llmBaseUrl || process.env.WHISPER_BASE_URL || 'https://api.openai.com/v1'
  return {
    client: new OpenAI({ apiKey, baseURL }),
    model: process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL,
  }
}
