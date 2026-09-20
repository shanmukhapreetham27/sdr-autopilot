-- Escalation resolution: give the human in the loop something to actually do.
--
-- Before this, an escalation was a log line and nothing more. A prospect the
-- ICP agent returned NEEDS_REVIEW on kept its stage, so the next tick selected
-- it again, re-scored it to the same deterministic verdict, and logged another
-- escalation. The same prospect could escalate indefinitely and could never
-- reach 'qualified', because nothing in the system could clear the verdict.

-- ---------------------------------------------------------------------------
-- Prospects: parked pending a human verdict
-- ---------------------------------------------------------------------------
--
-- Deliberately a flag rather than a funnel stage. The prospect has not moved
-- anywhere — it is held at whatever stage it reached, and resuming must put it
-- back exactly there. A 'needs_review' stage would corrupt the funnel counts
-- and force every stage-ordered query to special-case it.

alter table prospects
  add column needs_review boolean not null default false;

-- The agent loop asks "what can I work on right now?" on every tick, and the
-- answer excludes parked prospects.
create index prospects_actionable_idx
  on prospects (campaign_id, state)
  where needs_review = false;

-- ---------------------------------------------------------------------------
-- Activity events: who resolved an escalation, and when
-- ---------------------------------------------------------------------------
--
-- The event keeps status = 'pending_approval' forever. Resolution is recorded
-- alongside it rather than by overwriting the status, because the log is an
-- audit trail: "this was escalated, and Priya approved it" is the fact worth
-- keeping, and rewriting the status to 'success' would erase the escalation
-- ever having happened.

alter table activity_events
  add column resolved_at timestamptz,
  add column resolved_by text;

-- "Awaiting human" counts open escalations, on every page load.
create index activity_events_open_escalations_idx
  on activity_events (campaign_id)
  where status = 'pending_approval' and resolved_at is null;
