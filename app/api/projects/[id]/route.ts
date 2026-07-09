// GET    /api/projects/[id] — detalle con contadores
// PATCH  /api/projects/[id] — actualizar con validación de transición (CAS)
// DELETE /api/projects/[id] — hard-delete, cascade SetNull en Note

import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { PROJECT_SELECT } from '@/lib/hubs'
import {
  formatProjectItem,
  validateTransition,
  logProjectEvent,
  mapPrismaError,
  PROJECT_TRANSITIONS,
} from '@/lib/projects'
import { rateLimit } from '@/lib/rate-limit'
import type { ProjectStatus } from '@prisma/client'

const VALID_STATUSES: ProjectStatus[] = ['IDEATION', 'ACTIVE', 'MAINTENANCE', 'ARCHIVED']

// ─── GET /api/projects/[id] ────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const userId = session.userId
  const { id } = await ctx.params

  if (!rateLimit(`get-project:${userId}`, 120, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limit', message: 'Demasiadas solicitudes. Intenta en un minuto.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  try {
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: PROJECT_SELECT,
    })

    if (!project) {
      return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Proyecto no encontrado.' } }, { status: 404 })
    }

    const [notesCount, openTasksCount] = await Promise.all([
      prisma.note.count({ where: { projectId: id } }),
      prisma.task.count({ where: { note: { projectId: id }, status: 'OPEN' } }),
    ])

    return NextResponse.json({
      ok: true,
      data: {
        ...formatProjectItem(project),
        notesCount,
        openTasksCount,
      },
    })
  } catch (e) {
    const { status, error } = mapPrismaError(e)
    return NextResponse.json({ ok: false, error }, { status })
  }
}

// ─── PATCH /api/projects/[id] ──────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const userId = session.userId
  const { id } = await ctx.params

  if (!rateLimit(`patch-project:${userId}`, 60, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limit', message: 'Demasiadas solicitudes. Intenta en un minuto.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  try {
    // Obtener estado actual
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true, userId: true, name: true, description: true, status: true, createdAt: true, updatedAt: true },
    })

    if (!project) {
      return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Proyecto no encontrado.' } }, { status: 404 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    // Validar campos
    const data: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name.length) {
        return NextResponse.json({ ok: false, error: { code: 'invalid_name', message: 'El nombre no puede estar vacío.' } }, { status: 400 })
      }
      data.name = name
    }

    if (body.description !== undefined) {
      if (body.description === null) {
        data.description = null
      } else {
        data.description = String(body.description)
      }
    }

    const hasStatusChange = typeof body.status === 'string'
    if (hasStatusChange) {
      const newStatus = body.status as string
      // Validar que es un valor de ProjectStatus (fix C3)
      if (!VALID_STATUSES.includes(newStatus as ProjectStatus)) {
        return NextResponse.json(
          { ok: false, error: { code: 'invalid_status', message: `Estado inválido: ${newStatus}`, details: { received: newStatus } } },
          { status: 400 }
        )
      }

      const targetStatus = newStatus as ProjectStatus

      // Solo validar transición si cambia realmente
      if (targetStatus !== project.status) {
        const transition = validateTransition(project.status, targetStatus)
        if (!transition.ok) {
          return NextResponse.json(
            {
              ok: false,
              error: {
                code: 'invalidTransition',
                message: `No se puede transicionar de ${project.status} a ${targetStatus}.`,
                details: {
                  from: project.status,
                  attempted: targetStatus,
                  allowedFromCurrent: transition.allowed,
                },
              },
            },
            { status: 409 }
          )
        }
        data.status = targetStatus
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true, data: formatProjectItem(project) })
    }

    // CAS solo para cambio de status; sin status → update normal (fix F3)
    if (data.status !== undefined) {
      const result = await prisma.project.updateMany({
        where: { id, userId, status: project.status },
        data,
      })

      if (result.count === 0) {
        const current = await prisma.project.findFirst({ where: { id, userId }, select: { status: true } })
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'invalidTransition',
              message: 'El estado del proyecto cambió mientras se procesaba la solicitud.',
              details: {
                from: project.status,
                attempted: data.status,
                allowedFromCurrent: current ? PROJECT_TRANSITIONS[current.status] ?? [] : [],
              },
            },
          },
          { status: 409 }
        )
      }
    } else {
      await prisma.project.update({
        where: { id, userId },
        data,
      })
    }

    // Re-leer desde DB para datos frescos
    const reRead = await prisma.project.findUnique({
      where: { id },
      select: PROJECT_SELECT,
    })

    if (hasStatusChange && data.status) {
      logProjectEvent('project.status.changed', { userId, projectId: id, from: project.status, to: data.status })
    }

    return NextResponse.json({ ok: true, data: reRead ? formatProjectItem(reRead) : null })
  } catch (e) {
    const { status, error } = mapPrismaError(e)
    return NextResponse.json({ ok: false, error }, { status })
  }
}

// ─── DELETE /api/projects/[id] ─────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: 'No autenticado' } }, { status: 401 })
  }

  const userId = session.userId
  const { id } = await ctx.params

  if (!rateLimit(`delete-project:${userId}`, 30, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limit', message: 'Demasiadas solicitudes. Intenta en un minuto.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  try {
    const project = await prisma.project.findFirst({ where: { id, userId }, select: { id: true } })
    if (!project) {
      return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Proyecto no encontrado.' } }, { status: 404 })
    }

    // Contar notes huérfanas antes de borrar
    const orphanNotesCount = await prisma.note.count({ where: { projectId: id } })

    await prisma.project.delete({ where: { id } })

    logProjectEvent('project.deleted', { userId, projectId: id, orphanNotesCount })

    return new NextResponse(null, { status: 204 })
  } catch (e) {
    const { status, error } = mapPrismaError(e)
    return NextResponse.json({ ok: false, error }, { status })
  }
}
