// LLM clients configured from env — supports any OpenAI-compatible provider
// (OpenAI, DeepSeek, OpenRouter, Groq, …) via LLM_BASE_URL + LLM_API_KEY.
//
// ponytail: lazy singletons, not eager construction. The OpenAI SDK throws at
// construction time when no API key is present, and `next build` evaluates route
// modules to collect page data — constructing eagerly would break the build when
// the key isn't set yet. Clients are created on first request use instead.
// No factory, no provider abstraction: one llm + one whisper, that's it.

import OpenAI from 'openai'

let _llm: OpenAI | null = null
let _whisper: OpenAI | null = null

export function getLlm(): OpenAI {
  if (!_llm) {
    _llm = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    })
  }
  return _llm
}

// Whisper needs an OpenAI-compatible /audio/transcriptions endpoint. Most alt
// providers don't serve audio, so this falls back to OpenAI's endpoint unless
// WHISPER_BASE_URL is set.
export function getWhisper(): OpenAI {
  if (!_whisper) {
    _whisper = new OpenAI({
      apiKey: process.env.WHISPER_API_KEY || process.env.LLM_API_KEY,
      baseURL: process.env.WHISPER_BASE_URL ?? 'https://api.openai.com/v1',
    })
  }
  return _whisper
}

export const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini'
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'whisper-1'
