import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 200 })
  }

  const { llmBaseUrl, llmApiKey, llmModel } = body as {
    llmBaseUrl?: string | null
    llmApiKey?: string | null
    llmModel?: string | null
  }

  const apiKey = llmApiKey || process.env.LLM_API_KEY
  const baseURL = llmBaseUrl || process.env.LLM_BASE_URL
  const model = llmModel || process.env.LLM_MODEL || 'gpt-4o-mini'

  try {
    const client = new OpenAI({ apiKey, baseURL })
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    })
    return NextResponse.json({ ok: true, model: completion.model })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 200 })
  }
}
