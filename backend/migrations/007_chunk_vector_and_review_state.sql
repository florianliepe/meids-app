BEGIN;

ALTER TABLE knowledge.chunk
  ADD COLUMN IF NOT EXISTS content_vector jsonb;

UPDATE knowledge.chunk chunk_row
SET content_vector = event.payload -> 'document' -> 'content_vector'
FROM runtime.outbox_event event
WHERE event.aggregate_type = 'knowledge.concept'
  AND event.event_type = 'knowledge.revision.staged'
  AND event.aggregate_id = chunk_row.concept_id::text
  AND (event.payload ->> 'revision')::int = chunk_row.revision
  AND jsonb_typeof(event.payload -> 'document' -> 'content_vector') = 'array'
  AND chunk_row.content_vector IS NULL;

COMMIT;
