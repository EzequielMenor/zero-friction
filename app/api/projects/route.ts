// POST /api/projects — crear proyecto
// GET  /api/projects — listar proyectos del usuario

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { PROJECT_SELECT } from '@/lib/hubs'
import { formatProjectItem, logProjectEvent, mapPrismaError } from '@/lib/projects'
import { rateLimit } from '@/lib/rate-limit'
import type { ProjectStatus } from '@prisma/client'

const VALID_STATUSES: ProjectStatus[] = ['IDEATION', 'ACTIVE', 'MAINTENANCE', 'ARCHIVED']

// ─── POST /api/projects ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const userId = session.userId

  if (!rateLimit(`post-projects:${userId}`, 30, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limit', message: 'Demasiadas solicitudes. Intenta en un minuto.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.name !== 'string') {
    return NextResponse.json({ ok: false, error: { code: 'invalid_name', message: 'El nombre es obligatorio.' } }, { status: 400 })
  }

  const name = body.name.trim()
  if (!name.length) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_name', message: 'El nombre no puede estar vacío.' } }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description.trim() : null

  let status: ProjectStatus = 'IDEATION'
  if (typeof body.status === 'string' && VALID_STATUSES.includes(body.status as ProjectStatus)) {
    status = body.status as ProjectStatus
  } else if (typeof body.status === 'string') {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_status', message: `Estado inválido: ${body.status}`, details: { received: body.status } } },
      { status: 400 }
    )
  }

  try {
    const project = await prisma.project.create({
      data: { userId, name, description, status },
      select: PROJECT_SELECT,
    })

    logProjectEvent('project.created', { userId, projectId: project.id, status })

    return NextResponse.json(
      { ok: true, data: formatProjectItem(project) },
      { status: 201 }
    )
  } catch (e) {
    const { status, error } = mapPrismaError(e)
    return NextResponse.json({ ok: false, error }, { status })
  }
}

// ─── GET /api/projects ─────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const userId = session.userId

  if (!rateLimit(`get-projects:${userId}`, 120, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limit', message: 'Demasiadas solicitudes. Intenta en un minuto.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  const statusParam = req.nextUrl.searchParams.get('status')
  let statusFilter: ProjectStatus | undefined
  if (statusParam && VALID_STATUSES.includes(statusParam as ProjectStatus)) {
    statusFilter = statusParam as ProjectStatus
  } else if (statusParam) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_status', message: `Filtro status inválido: ${statusParam}` } },
      { status: 400 }
    )
  }

  try {
    const projects = await prisma.project.findMany({
      where: statusFilter ? { userId, status: statusFilter } : { userId },
      orderBy: { updatedAt: 'desc' },
      select: PROJECT_SELECT,
    })

    return NextResponse.json({ ok: true, data: projects.map(formatProjectItem) })
  } catch (e) {
    const { status, error } = mapPrismaError(e)
    return NextResponse.json({ ok: false, error }, { status })
  }
}
