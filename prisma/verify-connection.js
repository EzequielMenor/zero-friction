// Script para verificar la conexión con la base de datos
// Usage: node prisma/verify-connection.js

require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const pg = require('pg')

// Force IPv4 to avoid IPv6 issues on some networks
const connectionString = (process.env.DATABASE_URL ?? 'postgresql://postgres:xikmid-qyjgy1-tavmaQ@db.medyvfhznlpimxbwfymk.supabase.co:5432/postgres?sslmode=require').replace('.supabase.co:5432', '.supabase.co:5432?host=db.medyvfhznlpimxbwfymk.supabase.co')

async function main() {
  console.log('Verificando conexión a la base de datos...\n')

  const pool = new pg.Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  try {
    await prisma.$connect()
    console.log('✅ Conexión establecida')
  } catch (e) {
    console.error('❌ Error de conexión:', e.message)
    process.exit(1)
  }

  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
  `
  console.log('\nTablas:')
  tables.forEach(t => console.log('  -', t.table_name))

  const enums = await prisma.$queryRaw`
    SELECT typname, enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE typname IN ('Domain', 'NoteStatus') ORDER BY typname, enumsortorder
  `
  console.log('\nEnums:')
  const groups = {}
  enums.forEach(e => {
    if (!groups[e.typname]) groups[e.typname] = []
    groups[e.typname].push(e.enumlabel)
  })
  Object.entries(groups).forEach(([k, v]) => console.log('  -', k + ':', v.join(', ')))

  const vector = await prisma.$queryRaw`SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`
  console.log('\nVector:', vector[0] ? `${vector[0].extname} v${vector[0].extversion}` : '❌ NO')

  try {
    const m = await prisma.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`
    console.log('Migración:', m[0] ? `${m[0].migration_name} (${m[0].finished_at})` : 'NINGUNA')
  } catch {}

  await prisma.$disconnect()
  await pool.end()
  console.log('\n✅ Verificación completa')
}

main().catch(e => { console.error(e.message); process.exit(1) })
