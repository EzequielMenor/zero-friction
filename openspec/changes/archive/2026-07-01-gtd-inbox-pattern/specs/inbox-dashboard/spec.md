# Delta Spec: inbox-dashboard

## ADDED Requirements

### Requirement: Inbox Section Lists DRAFT Notes

The Dashboard SHALL display an "📥 Inbox" section that lists every Note owned by the current user with `status: 'DRAFT'`, ordered most-recent-first.

#### Scenario: Inbox populated on Dashboard load

- GIVEN the current user has one or more DRAFT notes
- WHEN the Dashboard mounts
- THEN the Inbox section renders one card per DRAFT note
- AND each card shows the note's `title` (or content preview) and a "Procesar con IA" button

#### Scenario: Empty inbox state

- GIVEN the current user has zero DRAFT notes
- WHEN the Dashboard mounts
- THEN the Inbox section renders an empty state (e.g. "Inbox vacío") instead of zero cards

#### Scenario: Inbox fetches only the current user's drafts

- GIVEN the Dashboard mounts for user A
- WHEN the Inbox section fetches its data
- THEN the response contains only Notes with `userId === A` and `status: 'DRAFT'`

### Requirement: Inbox Reacts to New Drafts Without Full Reload

The Inbox section SHALL prepend newly captured draft notes when a `zf:draft` event is observed, without refetching the entire list.

#### Scenario: New draft prepended on capture event

- GIVEN the Dashboard is mounted with an existing Inbox list
- WHEN a `zf:draft` CustomEvent fires with a new note ID
- THEN the Inbox fetches and prepends that single note to the top of the list
- AND the rest of the list is not re-rendered or refetched

#### Scenario: Event for a note already in the list is ignored

- GIVEN the Inbox already contains a note with ID X
- WHEN a `zf:draft` event fires with the same ID X
- THEN the list does not duplicate the note

### Requirement: Per-Card Process Action With States

Each card in the Inbox SHALL expose a "Procesar con IA" button that transitions through observable states: `idle`, `loading`, `success`, `error`. On error the card MUST stay visible and MUST NOT delete the draft.

#### Scenario: Successful card processing

- GIVEN an Inbox card in `idle` state
- WHEN the user clicks "Procesar con IA"
- THEN the card transitions to `loading` (spinner, button disabled)
- AND on success the card is removed from the Inbox
- AND a toast displays "Guardado en Hub [Dominio]" with the assigned domain

#### Scenario: Failed card processing preserves draft

- GIVEN an Inbox card in `idle` state
- WHEN the user clicks "Procesar con IA" and the endpoint returns an error
- THEN the card transitions to `error` (red warning text, "Reintentar" button visible)
- AND the underlying Note is still `DRAFT` in the database
- AND the card is not removed from the Inbox

#### Scenario: Retry from error state

- GIVEN an Inbox card in `error` state
- WHEN the user clicks "Reintentar"
- THEN the card transitions back to `loading`
- AND the same success/error flow applies on the next response

### Requirement: Global Process All Control

The Inbox SHALL provide a "✨ Procesar todo" control that processes each draft sequentially, surfacing per-card feedback (success or error) for each one without blocking the whole list on a single failure.

#### Scenario: Global process all runs sequentially with per-card feedback

- GIVEN the Inbox contains N ≥ 2 DRAFT notes
- WHEN the user clicks "✨ Procesar todo"
- THEN the system processes each draft one at a time
- AND each card transitions through its own `loading` → `success`/`error` states
- AND a failure on one card does NOT stop processing of the remaining cards

### Requirement: Strict TypeScript and No Cascading Renders

Inbox-related components MUST be written in strict TypeScript with no `any`, and MUST NOT perform synchronous `setState` inside `useEffect` that would trigger cascading renders on mount.

#### Scenario: Inbox component has no `any` and no cascading setState

- GIVEN the Inbox component source
- WHEN the TypeScript compiler checks it with `strict: true`
- THEN it compiles without errors
- AND a code review finds no `any` annotations in the Inbox components
- AND a code review finds no `useEffect` body that calls `setState` synchronously without depending on data fetched inside that effect