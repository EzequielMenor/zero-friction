// Rate-limit en memoria con Map. Por instancia serverless (single-user).
// ponytail: Map en memoria; en multi-tenant futuro usar Redis o Vercel KV.

const store = new Map<string, { count: number; resetAt: number }>()

/** Retorna `true` si la request está dentro del límite, `false` si se excedió. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count < limit) {
    entry.count++
    return true
  }

  return false
}
