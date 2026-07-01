import { NextResponse, type NextRequest } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { verifySession, AUTH_COOKIE } from '@/lib/auth'

async function getUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 200 })
  }

  const { llmBaseUrl, llmApiKey, llmModel } = body as {
    llmBaseUrl?: string | null
    llmApiKey?: string | null
    llmModel?: string | null
  }

  // Resolve the UI mask '••••••••' against the stored key.
  // The bullet is not a valid HTTP header ByteString, so passing it
  // to the OpenAI client throws "Cannot convert argument to a ByteString".
  let apiKey = llmApiKey
  if (llmApiKey === '••••••••') {
    const existing = await prisma.lLMConfig.findUnique({ where: { userId } })
    apiKey = existing?.llmApiKey ?? null
  }
  apiKey = apiKey || process.env.LLM_API_KEY

  const baseURL = llmBaseUrl || process.env.LLM_BASE_URL
  const model = llmModel || process.env.LLM_MODEL || 'gpt-4o-mini'

  try {
    const client = new OpenAI({ apiKey, baseURL })
    // Verify connection by listing models (requires no model parameter and proves key/URL validity)
    await client.models.list()
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 200 })
  }
}
