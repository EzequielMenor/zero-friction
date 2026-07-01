import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySession, AUTH_COOKIE } from '@/lib/auth'

async function getUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

function maskKey(key: string | null | undefined): string | null {
  return key && key.length > 0 ? '••••••••' : null
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cfg = await prisma.lLMConfig.findUnique({ where: { userId } })
  if (!cfg) {
    return NextResponse.json(null)
  }

  return NextResponse.json({
    llmBaseUrl: cfg.llmBaseUrl,
    llmApiKey: maskKey(cfg.llmApiKey),
    llmModel: cfg.llmModel,
    embeddingModel: cfg.embeddingModel,
  })
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

  const { llmBaseUrl, llmApiKey, llmModel, embeddingModel } = body as {
    llmBaseUrl?: string | null
    llmApiKey?: string | null
    llmModel?: string | null
    embeddingModel?: string | null
  }

  // Guard: if the incoming key is the mask, preserve the stored key
  let storedKey = llmApiKey
  if (llmApiKey === '••••••••') {
    const existing = await prisma.lLMConfig.findUnique({ where: { userId } })
    storedKey = existing?.llmApiKey ?? null
  }

  const cfg = await prisma.lLMConfig.upsert({
    where: { userId },
    update: {
      llmBaseUrl: llmBaseUrl ?? null,
      llmApiKey: storedKey,
      llmModel: llmModel ?? null,
      embeddingModel: embeddingModel ?? null,
    },
    create: {
      userId,
      llmBaseUrl: llmBaseUrl ?? null,
      llmApiKey: storedKey,
      llmModel: llmModel ?? null,
      embeddingModel: embeddingModel ?? null,
    },
  })

  return NextResponse.json({
    llmBaseUrl: cfg.llmBaseUrl,
    llmApiKey: maskKey(cfg.llmApiKey),
    llmModel: cfg.llmModel,
    embeddingModel: cfg.embeddingModel,
  })
}
