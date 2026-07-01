import { NextResponse, type NextRequest } from 'next/server'
import OpenAI from 'openai'
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { llmBaseUrl, llmApiKey } = body as {
    llmBaseUrl?: string | null
    llmApiKey?: string | null
  }

  if (!llmBaseUrl || !llmApiKey) {
    return NextResponse.json(
      { error: 'Faltan llmBaseUrl o llmApiKey' },
      { status: 400 }
    )
  }

  try {
    const client = new OpenAI({ apiKey: llmApiKey, baseURL: llmBaseUrl })
    const page = await client.models.list()
    const ids = page.data.map((m) => m.id).sort()

    const embeddingModels = ids.filter((id) => id.toLowerCase().includes('embed'))
    const chatModels = embeddingModels.length > 0
      ? ids.filter((id) => !id.toLowerCase().includes('embed'))
      : ids

    return NextResponse.json({ chatModels, embeddingModels })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 200 })
  }
}