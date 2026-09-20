-- Campaign knowledge base: the corpus agents retrieve from before writing
-- anything customer-facing.
--
-- The campaign already owns its prompts, policy and targeting. It did not own
-- its knowledge, so prompts referred to a knowledge base that did not exist:
-- the India BFSI harness says "never reference a regulation unless it appears
-- in the retrieved knowledge base", and nothing was ever retrieved.
--
-- Purely additive. No existing table is altered, so every current code path
-- behaves exactly as it did before this migration.

create table knowledge_chunks (
  id          text primary key,

  -- NULL means platform-wide, which is the Global vs Campaign-level split:
  -- product facts are shared, a region's objection handling is not. Cascades
  -- so deleting a campaign cannot orphan its knowledge.
  campaign_id text references campaigns(id) on delete cascade,

  kind        text not null check (kind in
                ('product','case_study','playbook','objection',
                 'example_email','voice_script','icp_definition')),

  title       text not null,
  content     text not null,

  -- Provenance, shown in the UI beside the retrieved chunk. The same honesty
  -- rule as the simulated/DronaHQ badges: a reader can always tell whether a
  -- fact was authored for the demo, derived from campaign config, curated
  -- from real agent output, or uploaded by an operator.
  source      text not null default '',

  created_at  timestamptz not null default now(),

  -- Ranking input, maintained by Postgres. A title hit outweighs a body hit,
  -- so "Pricing objection" wins over a chunk that merely mentions pricing.
  search      tsvector generated always as (
                setweight(to_tsvector('english', title), 'A') ||
                setweight(to_tsvector('english', content), 'B')
              ) stored
);

create index knowledge_search_idx   on knowledge_chunks using gin (search);
create index knowledge_campaign_idx on knowledge_chunks (campaign_id, kind);
