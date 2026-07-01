# Design: Arquitectura Relacional de Cuentas y Saldos

## 1. Objetivo

Vincular transacciones a cuentas financieras (`Account`) para permitir saldos observables por cuenta y un balance global que incluye saldos iniciales.

## 2. Esquema de Datos

### 2.1 Nuevo modelo: `Account`

```prisma
model Account {
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String        // Ej: "Banco Principal", "Efectivo"
  initialBalance Float         @default(0)
  currency       String        @default("EUR")
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  transactions   Transaction[]
}
```

### 2.2 Modificación: `Transaction`

Agregar:

```prisma
  accountId      String?
  account        Account?      @relation(fields: [accountId], references: [id], onDelete: SetNull)
```

La relación es **opcional** para compatibilidad con datos históricos. Transacciones sin `accountId` continúan sumando al balance global pero no se atribuyen a ninguna cuenta específica.

## 3. Backend: API Routes

### 3.1 `GET /api/accounts`

Lista cuentas del usuario autenticado. Para cada cuenta calcula:

```
currentBalance = initialBalance + sum(amount de TODAS las transacciones históricas vinculadas a esa cuenta, sin filtro de fecha)
```

⚠️ El saldo de una cuenta es un estado acumulado histórico absoluto. NO filtrar por `startOfCycle`.

### 3.2 `POST /api/accounts`

Body: `{ name: string, initialBalance?: number }`

Validaciones: `name` requerido y no vacío. `initialBalance` opcional, default `0`.

### 3.3 `DELETE /api/accounts/:id`

Elimina la cuenta. Transacciones vinculadas quedan con `accountId: null` por `onDelete: SetNull`.

### 3.4 Modificación: `GET /api/registros/finanzas`

Extender respuesta:

- Incluir `accounts: { id, name, initialBalance, currentBalance }[]`
- `totalInitialBalance = sum(initialBalance de todas las cuentas)`
- `netBalance = totalInitialBalance + totalIncome - totalExpenses`
- Transacciones sin `accountId` siguen contando en `totalIncome`/`totalExpenses`

### 3.5 Modificación: `POST /api/registros/finanzas`

- Aceptar campo opcional `accountId: string` en body
- Si se envía y existe la cuenta, vincular la transacción
- Si no se envía o no existe, crear sin `accountId`

## 4. Frontend: `app/(app)/hubs/registros/finanzas/page.tsx`

### 4.1 Panel "Mis Cuentas / Carteras"

- Lista de cuentas con: nombre, saldo inicial, **saldo actual calculado**, botón eliminar
- Estado vacío cuando no hay cuentas: mensaje + CTA "+ Nueva Cuenta"
- Form inline/modal para crear: Nombre + Saldo Inicial

### 4.2 Formulario de Transacción (`QuickAddTransaction`)

- Agregar `<select>` de cuentas obtenidas del `GET /api/registros/finanzas`
- Label: "Cuenta (opcional)"
- Si no hay cuentas, select oculto o placeholder deshabilitado

### 4.3 Balance Global

- `BalanceCallout` usa `netBalance = totalInitialBalance + income - expenses`
- Muestra el total inicial como contexto adicional debajo del balance neto

## 5. Edge Cases & Reglas

| Escenario | Comportamiento |
|---|---|
| Sin cuentas creadas | Panel vacío con CTA. Transacciones sin `accountId` suman al global. UI no rompe. |
| Cuenta eliminada | Transacciones pasan a `accountId: null`. Balance global intacto. |
| `accountId` inválido en POST | Se ignora, transacción se crea sin cuenta. |
| Sin transacciones en cuenta | `currentBalance === initialBalance` |
| Datos históricos (pre-cuentas) | Transacciones existentes con `accountId: null` siguen en el cálculo global. |

## 6. Límites Intencionales (Ponytail)

- No edición de cuenta (nombre/saldo inicial) en esta iteración. Se puede agregar después sin tocar la DB.
- No transferencias entre cuentas. Una transferencia es dos transacciones.
- No múltiples monedas con conversión. `currency` es informativo; todos los cálculos usan valores crudos.

## 7. Testing Mínimo

- Un test del API `GET /api/accounts` verifica que `currentBalance` sea `initialBalance + sum(transactions.amount)`.
- Un test del API `POST /api/registros/finanzas` verifica que `accountId` opcional funcione.
