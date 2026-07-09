-- AddNoteRelationshipMetadata: enum NoteRelationshipType + relationshipType + reason
-- en NoteRelationship

-- Create enum NoteRelationshipType
CREATE TYPE "NoteRelationshipType" AS ENUM (
  'RELATED',
  'SUPPORTS',
  'CONTRADICTS',
  'EXAMPLE_OF',
  'CONTINUES',
  'RELATED_PROJECT',
  'REFERENCES'
);

-- Add columns to NoteRelationship (default RELATED, reason nullable)
ALTER TABLE "NoteRelationship"
  ADD COLUMN "relationshipType" "NoteRelationshipType" NOT NULL DEFAULT 'RELATED',
  ADD COLUMN "reason" TEXT;
