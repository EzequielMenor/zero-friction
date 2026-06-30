import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'
import { getLlm, LLM_MODEL } from '@/lib/llm'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HevyRow {
  title: string
  date: Date
  duration: string
  exerciseName: string
  supersetId: string | null
  weight: number
  reps: number
  distance: number | null
  time: number | null
  setType: string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function parseHevyDate(raw: string): Date | null {
  // Hevy format: YYYY-MM-DD HH:mm:ss or ISO
  const cleaned = raw.trim()
  // Try ISO first
  let d = new Date(cleaned)
  if (!isNaN(d.getTime())) return d
  // Try YYYY-MM-DD HH:mm:ss
  d = new Date(cleaned.replace(' ', 'T'))
  if (!isNaN(d.getTime())) return d
  // Try YYYY-MM-DD
  d = new Date(cleaned.substring(0, 10))
  if (!isNaN(d.getTime())) return d
  return null
}

function parseRows(csvText: string): HevyRow[] {
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return []

  // Skip header
  const dataLines = lines.slice(1)
  const rows: HevyRow[] = []

  for (const line of dataLines) {
    const fields = parseCSVLine(line)
    if (fields.length < 10) continue

    const date = parseHevyDate(fields[1])
    if (!date) continue

    const weight = parseFloat(fields[5]) || 0
    const reps = parseInt(fields[6], 10) || 0
    const distance = fields[7] ? parseFloat(fields[7]) || null : null
    const time = fields[8] ? parseInt(fields[8], 10) || null : null

    rows.push({
      title: fields[0],
      date,
      duration: fields[2] || '',
      exerciseName: fields[3],
      supersetId: fields[4] || null,
      weight,
      reps,
      distance,
      time,
      setType: fields[9] || 'NORMAL_SET',
    })
  }

  return rows
}

// ─── Group rows by workout ────────────────────────────────────────────────────

interface WorkoutGroup {
  title: string
  date: Date
  duration: string
  sets: Omit<HevyRow, 'title' | 'date' | 'duration'>[]
}

function groupByWorkout(rows: HevyRow[]): WorkoutGroup[] {
  const map = new Map<string, WorkoutGroup>()

  for (const row of rows) {
    // Use date string key (YYYY-MM-DD) to group
    const dateKey = row.date.toISOString().substring(0, 10)
    const key = `${row.title}::${dateKey}`

    if (!map.has(key)) {
      map.set(key, {
        title: row.title,
        date: row.date,
        duration: row.duration,
        sets: [],
      })
    }

    map.get(key)!.sets.push({
      exerciseName: row.exerciseName,
      supersetId: row.supersetId,
      weight: row.weight,
      reps: row.reps,
      distance: row.distance,
      time: row.time,
      setType: row.setType,
    })
  }

  return Array.from(map.values())
}

// ─── AI Coach ─────────────────────────────────────────────────────────────────

async function updateCoachAdvice(userId: string): Promise<void> {
  const workouts = await prisma.workout.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: 10,
    include: { sets: true },
  })

  if (workouts.length === 0) return

  const summary = workouts.map((w) => {
    const totalVolume = w.sets.reduce((sum, s) => sum + s.weight * s.reps, 0)
    const topSet = w.sets.reduce(
      (best, s) => (s.weight * s.reps > best.weight * best.reps ? s : best),
      w.sets[0]
    )
    const dateStr = w.date.toISOString().substring(0, 10)
    return `Fecha: ${dateStr}, Entrenamiento: ${w.title}, Volumen total: ${totalVolume.toFixed(0)}kg, Mejor serie: ${topSet.exerciseName} ${topSet.weight}kg x ${topSet.reps}`
  }).join('\n')

  const SYSTEM_PROMPT =
    'You are an AI strength coach. Analyze the user\'s recent workouts (volume, max weights, exercise variety) and write a concise 2-3 sentence progress assessment with concrete advice on what weight or reps to adjust next session. Be specific and direct. No preamble.'

  try {
    const completion = await getLlm().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Recent workouts:\n${summary}\n\nProvide your assessment and advice.` },
      ],
      temperature: 0.3,
    })

    const content = completion.choices[0]?.message?.content?.trim()
    if (!content) return

    await prisma.coachAdvice.upsert({
      where: { userId },
      update: { content },
      create: { userId, content },
    })
  } catch (err) {
    console.error('[coachAdvice] LLM call failed:', err)
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  const csvText = await file.text()
  const rows = parseRows(csvText)
  if (rows.length === 0) {
    return NextResponse.json({ importedCount: 0, message: 'No se encontraron filas válidas en el CSV.' })
  }

  // Delta stop: find most recent workout date
  const latestWorkout = await prisma.workout.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
    select: { date: true },
  })

  const latestDate = latestWorkout?.date ?? null
  const cutoffTime = latestDate ? latestDate.getTime() : -Infinity

  // Filter rows to only those newer than latestWorkout.date
  const newRows = latestDate
    ? rows.filter((r) => r.date.getTime() > cutoffTime)
    : rows

  if (newRows.length === 0) {
    return NextResponse.json({
      importedCount: 0,
      message: 'Delta stop: todos los entrenamientos del CSV ya están en la base de datos.',
    })
  }

  const groups = groupByWorkout(newRows)
  let importedCount = 0

  for (const group of groups) {
    const workout = await prisma.workout.upsert({
      where: { userId_date: { userId, date: group.date } },
      update: {},
      create: {
        userId,
        title: group.title,
        date: group.date,
        duration: group.duration || null,
      },
    })

    for (const set of group.sets) {
      await prisma.workoutSet.create({
        data: {
          workoutId: workout.id,
          exerciseName: set.exerciseName,
          weight: set.weight,
          reps: set.reps,
          setType: set.setType,
          supersetId: set.supersetId,
        },
      })
    }

    importedCount++
  }

  // Fire-and-forget AI coach advice
  updateCoachAdvice(userId).catch((err) => console.error('[coachAdvice]', err))

  return NextResponse.json({
    importedCount,
    message: `Se importaron ${importedCount} entrenamientos nuevos.`,
  })
}
