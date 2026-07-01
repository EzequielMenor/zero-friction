# Finanzas Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular transacciones a cuentas financieras con saldos observables por cuenta y balance global correcto.

**Architecture:** API Routes (Next.js App Router) con Prisma ORM. Mantener patrón existente: fetch() desde cliente 'use client'. El saldo por cuenta es acumulado histórico absoluto (sin filtro de fecha); el balance del hub sigue filtrado por ciclo mensual.

**Tech Stack:** Next.js 14+ App Router, Prisma, PostgreSQL, React, Tailwind CSS, Playwright (e2e tests existentes)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `Account` model; add `accountId` to `Transaction` |
| `app/api/accounts/route.ts` | Create | GET list accounts + POST create account |
| `app/api/accounts/[id]/route.ts` | Create | DELETE account by id |
| `app/api/registros/finanzas/route.ts` | Modify | Include accounts in GET; accept accountId in POST |
| `app/(app)/hubs/registros/finanzas/page.tsx` | Modify | Add accounts panel, account selector in transaction form |
| `tests/e2e.spec.ts` | Modify | Add minimal e2e assertions for accounts feature |

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add Account model and Transaction relation**

Insertar nuevo modelo `Account` después de `Transaction`:

```prisma
model Account {
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  initialBalance Float         @default(0)
  currency       String        @default("EUR")
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  transactions   Transaction[]
}
```

Agregar al modelo `Transaction` (después de `subscriptionId`/`subscription`):

```prisma
  accountId      String?
  account        Account?      @relation(fields: [accountId], references: [id], onDelete: SetNull)
```

Agregar a `User` model en la lista de relaciones:

```prisma
  accounts      Account[]
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add_account_model
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add Account model and Transaction relation"
```

---

### Task 2: GET /api/accounts

**Files:**
- Create: `app/api/accounts/route.ts`

- [ ] **Step 1: Implement GET handler**

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

export async function GET(): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const accounts = await prisma.account.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { transactions: true },
  })

  const output = accounts.map((acc) => {
    const transactionSum = acc.transactions.reduce((sum, t) => sum + t.amount, 0)
    return {
      id: acc.id,
      name: acc.name,
      initialBalance: acc.initialBalance,
      currentBalance: acc.initialBalance + transactionSum,
      currency: acc.currency,
      createdAt: acc.createdAt.toISOString(),
    }
  })

  return NextResponse.json({ accounts: output }, { headers: { 'Cache-Control': 'no-store' } })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/accounts/route.ts
git commit -m "feat(api): add GET /api/accounts with currentBalance calculation"
```

---

### Task 3: POST /api/accounts

**Files:**
- Modify: `app/api/accounts/route.ts`

- [ ] **Step 1: Add POST handler to same file**

Append after GET:

```typescript
export async function POST(req: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: { name?: unknown; initialBalance?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { name, initialBalance } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name (string) is required' }, { status: 400 })
  }

  const balanceNum = typeof initialBalance === 'number' ? initialBalance : 0

  const account = await prisma.account.create({
    data: {
      userId,
      name: name.trim(),
      initialBalance: balanceNum,
    },
  })

  return NextResponse.json(
    {
      id: account.id,
      name: account.name,
      initialBalance: account.initialBalance,
      currentBalance: account.initialBalance,
      currency: account.currency,
      createdAt: account.createdAt.toISOString(),
    },
    { status: 201 }
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/accounts/route.ts
git commit -m "feat(api): add POST /api/accounts to create accounts"
```

---

### Task 4: DELETE /api/accounts/:id

**Files:**
- Create: `app/api/accounts/[id]/route.ts`

- [ ] **Step 1: Implement DELETE handler**

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE, verifySession } from '@/lib/auth'

async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  return session?.userId ?? null
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params

  // Verify ownership
  const account = await prisma.account.findFirst({
    where: { id, userId },
  })

  if (!account) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  await prisma.account.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/accounts/
git commit -m "feat(api): add DELETE /api/accounts/:id"
```

---

### Task 5: Modify GET /api/registros/finanzas

**Files:**
- Modify: `app/api/registros/finanzas/route.ts`

- [ ] **Step 1: Add accounts to GET response**

After subscriptions query (around line 97), add:

```typescript
  // Fetch accounts with all historical transactions
  const accounts = await prisma.account.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { transactions: true },
  })

  const accountOutputs = accounts.map((acc) => {
    const transactionSum = acc.transactions.reduce((sum, t) => sum + t.amount, 0)
    return {
      id: acc.id,
      name: acc.name,
      initialBalance: acc.initialBalance,
      currentBalance: acc.initialBalance + transactionSum,
      currency: acc.currency,
    }
  })

  const totalInitialBalance = accountOutputs.reduce((sum, a) => sum + a.initialBalance, 0)
```

Change netBalance calculation (line 82):

```typescript
  const netBalance = totalInitialBalance + totalIncome - totalExpenses
```

Add `accounts` and `totalInitialBalance` to response JSON:

```typescript
  return NextResponse.json(
    {
      transactions: transactionOutputs,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netBalance: Math.round(netBalance * 100) / 100,
      totalInitialBalance: Math.round(totalInitialBalance * 100) / 100,
      categoryDistribution,
      subscriptions: subscriptionOutputs,
      accounts: accountOutputs,
      startOfCycle: startOfCycle.toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
```

- [ ] **Step 2: Commit**

```bash
git add app/api/registros/finanzas/route.ts
git commit -m "feat(api): include accounts and totalInitialBalance in finanzas GET"
```

---

### Task 6: Modify POST /api/registros/finanzas

**Files:**
- Modify: `app/api/registros/finanzas/route.ts`

- [ ] **Step 1: Accept optional accountId**

Change body type (line 136):

```typescript
  let body: { amount?: unknown; description?: unknown; date?: unknown; category?: unknown; accountId?: unknown }
```

Change destructuring (line 143):

```typescript
  const { amount, description, date, category, accountId } = body
```

Add validation for accountId after category validation:

```typescript
  let validatedAccountId: string | undefined
  if (accountId !== undefined && accountId !== null) {
    if (typeof accountId !== 'string') {
      return NextResponse.json({ error: 'accountId must be a string' }, { status: 400 })
    }
    validatedAccountId = accountId
  }
```

Add `accountId` to prisma.transaction.create (line 162):

```typescript
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      amount,
      description: description.trim(),
      date: parsedDate,
      category: category.trim(),
      accountId: validatedAccountId,
    },
  })
```

- [ ] **Step 2: Commit**

```bash
git add app/api/registros/finanzas/route.ts
git commit -m "feat(api): accept optional accountId in finanzas POST"
```

---

### Task 7: Frontend - Panel de Cuentas

**Files:**
- Modify: `app/(app)/hubs/registros/finanzas/page.tsx`

- [ ] **Step 1: Update FinanzasData interface**

Add account type and fields to interface:

```typescript
interface AccountData {
  id: string
  name: string
  initialBalance: number
  currentBalance: number
  currency: string
}

interface FinanzasData {
  transactions: Transaction[]
  totalIncome: number
  totalExpenses: number
  netBalance: number
  totalInitialBalance: number
  categoryDistribution: CategoryDistribution[]
  subscriptions: Subscription[]
  accounts: AccountData[]
  startOfCycle: string
}
```

- [ ] **Step 2: Add AccountsPanel component**

Insertar antes de `BalanceCallout` o después, según diseño. Recomendado: después del header, antes del balance.

```typescript
function AccountsPanel({ accounts, onAdd, onDelete }: {
  accounts: AccountData[]
  onAdd: () => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [initialBalance, setInitialBalance] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const formatCurrency = (n: number) =>
    n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 })

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)

    if (!name.trim()) {
      setStatus('error:El nombre es requerido')
      return
    }

    const balanceNum = parseFloat(initialBalance) || 0

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), initialBalance: balanceNum }),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al crear')
      }

      setName('')
      setInitialBalance('')
      setStatus('ok:Cuenta creada')
      setTimeout(onAdd, 600)
    } catch (err) {
      setStatus(`error:${err instanceof Error ? err.message : 'Error'}`)
    }
  }

  const statusColor = status?.startsWith('ok') ? 'text-[#34D399]' : status?.startsWith('error') ? 'text-[#F87171]' : ''
  const statusText = status?.startsWith('ok') ? status.split(':')[1] : status?.startsWith('error') ? status.split(':')[1] : null

  return (
    <div className="border border-graphite-border bg-graphite-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">Mis Cuentas / Carteras</h2>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[#5A5A5A] text-xs italic mb-3">Sin cuentas creadas. Creá tu primera cuenta para empezar a trackear por separado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between border border-graphite-border px-4 py-3">
              <div>
                <p className="text-[#E3E2E2] text-sm font-serif">{acc.name}</p>
                <p className="text-[#5A5A5A] text-xs">Inicial: {formatCurrency(acc.initialBalance)}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-serif ${acc.currentBalance >= 0 ? 'text-[#34D399]' : 'text-[#F87171]'}`}>
                  {formatCurrency(acc.currentBalance)}
                </p>
                <button
                  onClick={() => onDelete(acc.id)}
                  className="text-[#5A5A5A] hover:text-[#F87171] transition-colors text-xs mt-1"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-2 border-t border-graphite-border pt-4">
        <p className="text-[10px] uppercase tracking-wider text-[#5A5A5A] mb-2">Nueva cuenta</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (ej: Banco Principal)"
            className="flex-1 bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
          />
          <input
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            placeholder="Saldo inicial"
            step="0.01"
            className="w-32 bg-graphite-card border border-graphite-border text-[#E3E2E2] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50 placeholder-[#5A5A5A]"
          />
        </div>
        <button
          type="submit"
          className="w-full border border-[#A68966]/50 text-[#A68966] text-xs uppercase tracking-wider py-2 rounded hover:bg-[#A68966]/10 transition-colors"
        >
          + Nueva Cuenta
        </button>
        {statusText && <p className={`text-xs ${statusColor} text-center`}>{statusText}</p>}
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Wire AccountsPanel into page**

Add delete handler in main component:

```typescript
  const handleDeleteAccount = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Error al eliminar')
      load()
    } catch {
      // Silently fail
    }
  }
```

Insert `<AccountsPanel>` into the layout. Recommended placement: after the header, before `BalanceCallout`:

```tsx
      {/* Accounts Panel */}
      <AccountsPanel
        accounts={data.accounts}
        onAdd={load}
        onDelete={handleDeleteAccount}
      />
```

- [ ] **Step 4: Commit**

```bash
git add app/(app)/hubs/registros/finanzas/page.tsx
git commit -m "feat(ui): add accounts panel with create/delete and currentBalance display"
```

---

### Task 8: Frontend - Selector de Cuenta en Transacción

**Files:**
- Modify: `app/(app)/hubs/registros/finanzas/page.tsx`

- [ ] **Step 1: Add accountId state and select to QuickAddTransaction**

Add to `QuickAddTransaction` state (after `isIncome`):

```typescript
  const [accountId, setAccountId] = useState('')
```

Add `accounts` prop to component:

```typescript
function QuickAddTransaction({ accounts, onSuccess }: { accounts: AccountData[]; onSuccess: () => void }) {
```

Add account select in form (after income/expense toggle, before amount/date row):

```tsx
      {accounts.length > 0 && (
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full bg-graphite-card border border-graphite-border text-[#A1A1AA] text-sm px-3 py-2 rounded focus:outline-none focus:border-[#A68966]/50"
        >
          <option value="">Sin cuenta (opcional)</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
      )}
```

Include `accountId` in POST body (when not empty):

```typescript
      const body: Record<string, unknown> = {
        amount: isIncome ? numAmount : -numAmount,
        description: description.trim() || (isIncome ? 'Ingreso' : 'Gasto'),
        date,
        category,
      }
      if (accountId) {
        body.accountId = accountId
      }
```

And reset `accountId` on success:

```typescript
      setAccountId('')
```

- [ ] **Step 2: Pass accounts prop from parent**

Change `<QuickAddTransaction onSuccess={load} />` to:

```tsx
            <QuickAddTransaction accounts={data.accounts} onSuccess={load} />
```

- [ ] **Step 3: Commit**

```bash
git add app/(app)/hubs/registros/finanzas/page.tsx
git commit -m "feat(ui): add optional account selector to transaction form"
```

---

### Task 9: Tests Mínimos

**Files:**
- Modify: `tests/e2e.spec.ts`

- [ ] **Step 1: Add accounts assertions to existing e2e test**

After seeding subscriptions (around line 110 in existing e2e), add account seeding:

```typescript
  // Seed account
  const account = await prisma.account.create({
    data: {
      userId,
      name: 'Cuenta Test',
      initialBalance: 1000,
    },
  });

  // Seed transaction linked to account
  await prisma.transaction.create({
    data: {
      userId,
      amount: -200,
      description: 'Gasto vinculado',
      date: today,
      category: 'ALIMENTACIÓN',
      accountId: account.id,
    },
  });
```

After navigation to finanzas page, add assertions:

```typescript
  // Navigate to Finanzas hub
  await page.goto('/hubs/registros/finanzas');
  await expect(page).toHaveURL(/\/hubs\/registros\/finanzas/);

  // Verify account panel shows account with correct currentBalance (1000 - 200 = 800)
  await expect(page.getByText('Cuenta Test')).toBeVisible();
  await expect(page.getByText('$800')).toBeVisible();
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e.spec.ts
git commit -m "test(e2e): verify accounts display with currentBalance in finanzas hub"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ `Account` model created — Task 1
- ✅ `accountId` optional on `Transaction` — Task 1
- ✅ GET /api/accounts with currentBalance (histórico absoluto) — Task 2
- ✅ POST /api/accounts — Task 3
- ✅ DELETE /api/accounts/:id — Task 4
- ✅ GET /api/registros/finanzas incluye accounts y totalInitialBalance — Task 5
- ✅ POST /api/registros/finanzas acepta accountId — Task 6
- ✅ Panel de cuentas en UI con estado vacío, create, delete — Task 7
- ✅ Selector de cuenta en form de transacción — Task 8
- ✅ Tests mínimos — Task 9
- ✅ Saldo por cuenta es histórico absoluto (sin filtro de fecha) — Task 2 usa `include: { transactions: true }` sin filtro
- ✅ Balance global = totalInitialBalance + income - expenses — Task 5

**2. Placeholder scan:**
- ✅ Sin TBDs, TODOs, o referencias a "implementar después"
- ✅ Código completo en cada paso
- ✅ File paths exactos

**3. Type consistency:**
- ✅ `AccountData` interface usada consistentemente en frontend
- ✅ `accountId` string | undefined en backend
- ✅ Currency default "EUR" en schema, ARS en UI formatting (consistente con proyecto)

**Gaps:** None found.
