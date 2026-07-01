# inbox-processing Specification

## Purpose

The inbox-processing capability converts DRAFT notes into ACTIVE notes by running AI classification, embedding, and similarity-based relationship creation on user demand. Processing is async and user-triggered from the Inbox: the user decides when each draft gets enriched. On success the note transitions to `status: 'ACTIVE'` with its real domain assigned. On failure the note stays DRAFT with no data loss, so the user can retry later. The endpoint is idempotent against duplicate or out-of-order calls, and never silently corrupts state.

## Requirements

### Requirement: Async AI Enrichment of a Draft Note

The system SHALL expose an endpoint that, given an authenticated user and a DRAFT note ID, runs AI classification, generates an embedding, assigns the real `domain`, and creates `NoteRelationship` rows linking the note to semantically similar notes owned by the same user. On success the Note MUST transition to `status: 'ACTIVE'` with the assigned `domain`.

#### Scenario: Successful processing transitions DRAFT to ACTIVE

- GIVEN an authenticated user owns a Note with `status: 'DRAFT'`
- WHEN they trigger the processing endpoint for that note
- THEN the system runs classification, embedding, and similarity lookup
- AND the Note is updated to `status: 'ACTIVE'` with the classified `domain`, an `embedding` value, and any newly created `NoteRelationship` rows
- AND the response is HTTP 200 with the updated note
- AND the caller receives enough information to display a success message naming the assigned domain (e.g. "Guardado en Hub [Dominio]")

#### Scenario: AI failure keeps note as DRAFT

- GIVEN an authenticated user owns a DRAFT note
- WHEN they trigger processing and the AI service times out or returns an error
- THEN the Note's `status`, `domain`, `content`, and `embedding` are unchanged in the database
- AND the response is HTTP 502 or 504
- AND the caller receives a user-readable error message

#### Scenario: Processing a non-DRAFT note is rejected

- GIVEN an authenticated user owns a Note with `status: 'ACTIVE'`, `'IN_PROGRESS'`, `'DONE'`, or `'NEEDS_REVIEW'`
- WHEN they trigger the processing endpoint for that note
- THEN the response is HTTP 409
- AND no AI work is performed
- AND no data is mutated

#### Scenario: Cross-user processing rejected

- GIVEN an authenticated user A
- WHEN they send a processing request referencing a Note owned by user B
- THEN the response is HTTP 403 or 404
- AND no AI work is performed

### Requirement: Processing Bounded Latency

The processing endpoint SHALL respond within a bounded window so the caller can present per-card feedback without indefinite blocking. The endpoint SHALL NOT take longer than 15 seconds before returning to the client.

#### Scenario: Processing completes under bounded latency

- GIVEN an authenticated user triggers processing on a DRAFT note
- WHEN the AI service responds normally
- THEN the endpoint returns its HTTP response within 15 seconds of the request

### Requirement: Processing Idempotency Under Retry

If the client retries the processing endpoint for the same DRAFT note while a previous processing call is in flight or has just succeeded, the system SHALL NOT create duplicate relationships or duplicate embeddings, and SHALL NOT corrupt note state.

#### Scenario: Duplicate concurrent processing does not corrupt state

- GIVEN an authenticated user triggers processing twice in rapid succession for the same DRAFT note
- WHEN both calls resolve
- THEN the Note has exactly one assigned `domain`, one `embedding`, and a consistent set of `NoteRelationship` rows (no duplicates)