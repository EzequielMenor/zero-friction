import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params

  const note = await prisma.note.findFirst({ where: { id, userId: session.userId } })
  if (!note) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json()
  if (typeof body.text !== 'string' || body.text.trim() === '') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const dateStr = new Date().toLocaleDateString('es-ES')
  const appendix = `\n\n---\n*Reflexión (${dateStr}):*\n\n${body.text.trim()}`
  const updated = await prisma.note.update({
    where: { id },
    data: { content: note.content + appendix },
  })

  return NextResponse.json({ ok: true, content: updated.content })
}
