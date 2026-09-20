-- What knowledge grounded an agent action.
--
-- The activity log already records which harness version produced an action
-- and whether it came from DronaHQ or the fallback. Retrieval is the same
-- kind of fact: without it the app can claim it retrieved knowledge and a
-- reader has no way to check. Stored as a document because the shape belongs
-- to the knowledge layer, not to this table.
--
-- Nullable and additive: every existing row and every existing query is
-- unaffected.

alter table activity_events
  add column retrieved jsonb;
