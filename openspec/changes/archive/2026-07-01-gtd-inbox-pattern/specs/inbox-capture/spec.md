# Delta Spec: inbox-capture

## ADDED Requirements

### Requirement: Instant Draft Note Creation

The system SHALL create a Note with status `DRAFT` and a placeholder domain within 300ms of receiving a valid capture submission from an authenticated user. The endpoint SHALL NOT invoke any AI service during capture (no embeddings, no classification, no relationship creation).

#### Scenario: Successful text capture

- GIVEN an authenticated user has the CaptureOverlay open with non-empty text
- WHEN the user submits the capture form
- THEN the system creates a Note with `status: 'DRAFT'`, `domain: <placeholder>`, the submitted content, and `userId` matching the caller
- AND the response is HTTP 201 with the new note's ID within 300ms
- AND the capture modal closes
- AND a `zf:draft` CustomEvent is dispatched on `window` with the new note ID

#### Scenario: Empty or whitespace-only submission rejected client-side

- GIVEN the CaptureOverlay is open
- WHEN the user submits empty or whitespace-only text
- THEN the client MUST reject the submission without sending a network request
- AND the modal displays a validation hint

#### Scenario: Network error leaves no draft

- GIVEN the CaptureOverlay is open
- WHEN the user submits text and the network request fails before a response is received
- THEN no Note record exists in the database
- AND the modal displays a user-readable error message
- AND the modal stays open so the user can retry without re-typing

#### Scenario: Server 4xx or 5xx leaves no draft

- GIVEN the CaptureOverlay is open
- WHEN the user submits text and the server returns 4xx or 5xx
- THEN no Note record exists in the database for that submission
- AND the modal displays a user-readable error message derived from the response body

#### Scenario: No AI work performed at capture time

- GIVEN a successful draft capture
- WHEN the response is persisted
- THEN the Note has no `embedding` value
- AND no `NoteRelationship` rows reference the new note
- AND the capture request completed without any OpenAI API call

### Requirement: Authenticated Capture Endpoint

The capture endpoint SHALL require a valid authenticated session and SHALL only create notes owned by the authenticated user.

#### Scenario: Unauthenticated request rejected

- GIVEN an unauthenticated client
- WHEN it sends a capture request
- THEN the response is HTTP 401
- AND no Note record is created

#### Scenario: Note is owned by caller

- GIVEN an authenticated user submits a capture
- WHEN the draft Note is persisted
- THEN the Note's `userId` equals the caller's authenticated user ID