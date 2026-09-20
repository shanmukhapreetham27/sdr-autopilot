-- Initial schema for the SDR Autopilot control plane.
--
-- Mirrors the domain model in lib/types.ts. Campaign configuration, prompt
-- history, prospects and the agent activity log all live here so that state
-- is shared across visitors and survives a browser reload.

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create table campaigns (
  id                   text primary key,
  name                 text        not null,
  description          text        not null default '',
  owner                text        not null,
  status               text        not null
                         check (status in ('draft','live','paused','completed','archived')),

  icp_label            text        not null,
  icp_geography        text        not null default '',
  icp_target_roles     text[]      not null default '{}',
  icp_company_criteria text        not null default '',
  icp_exclusions       text        not null default '',

  -- Max autonomous outreach actions per day.
  daily_limit          integer     not null default 40,

  -- CampaignPolicy: thresholds, cadence and the policy text handed to the
  -- DronaHQ agents as their declared input variables. Stored as a document
  -- because the agents' contracts own its shape, not this schema.
  policy               jsonb       not null,

  -- Which prompt version the agents are currently running.
  -- Constrained after prompt_versions exists; see the deferrable FK below.
  active_version_id    text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Prompt / harness versions
-- ---------------------------------------------------------------------------
--
-- Immutable. Editing prompts writes a new row; older rows stay for rollback,
-- and every activity event records which version produced it.

create table prompt_versions (
  id            text        primary key,
  campaign_id   text        not null references campaigns(id) on delete cascade,
  version       integer     not null,
  author        text        not null,
  note          text        not null default '',
  system_prompt text        not null,
  -- One entry per agent key. A document, because the set of agents is owned
  -- by the agent catalogue rather than by the database.
  agent_prompts jsonb       not null,
  created_at    timestamptz not null default now(),
  unique (campaign_id, version)
);

-- Deferred so a campaign and its first version can be inserted in one
-- transaction without ordering games.
alter table campaigns
  add constraint campaigns_active_version_fk
  foreign key (active_version_id) references prompt_versions(id)
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Per-campaign operational control
-- ---------------------------------------------------------------------------
--
-- Split into their own tables rather than columns on campaigns: pausing one
-- channel or one agent is a targeted write, and the levels of control in the
-- problem statement are independent of each other.

create table campaign_channels (
  campaign_id text    not null references campaigns(id) on delete cascade,
  channel     text    not null check (channel in ('email','linkedin','sms','voice')),
  enabled     boolean not null default false,
  paused      boolean not null default false,
  primary key (campaign_id, channel)
);

create table campaign_agents (
  campaign_id text    not null references campaigns(id) on delete cascade,
  agent_key   text    not null,
  enabled     boolean not null default true,
  paused      boolean not null default false,
  primary key (campaign_id, agent_key)
);

-- ---------------------------------------------------------------------------
-- Prospects
-- ---------------------------------------------------------------------------

create table prospects (
  id              text        primary key,
  campaign_id     text        not null references campaigns(id) on delete cascade,

  name            text        not null,
  title           text        not null default '',
  company         text        not null,
  location        text        not null default '',
  email           text        not null,
  linkedin        text        not null default '',

  -- Funnel stage, or 'rejected' once the ICP agent removes them.
  state           text        not null
                    check (state in ('discovered','researched','qualified','contacted',
                                     'engaged','meeting','opportunity','rejected')),
  fit_score       integer     not null default 0 check (fit_score between 0 and 100),

  -- Sequence state the outreach and follow-up agents reason over.
  touched         text[]      not null default '{}',
  touch_count     integer     not null default 0,
  last_touch_at   timestamptz,
  angles_used     text[]      not null default '{}',

  last_action     text        not null default '',
  last_action_at  timestamptz not null default now(),

  -- Research Agent output, carried forward so downstream agents write from
  -- verified context instead of inventing facts.
  research_brief  text,
  dossier         jsonb
);

create index prospects_campaign_state_idx on prospects (campaign_id, state);
-- Cross-campaign conflict detection keys on email: the only identifier that
-- is stable across sources.
create index prospects_email_idx on prospects (email);

-- ---------------------------------------------------------------------------
-- Agent activity log
-- ---------------------------------------------------------------------------

create table activity_events (
  id            text        primary key,
  -- Not a foreign key: platform-wide events (the kill switch) use '*'.
  campaign_id   text        not null,
  ts            timestamptz not null default now(),

  agent         text        not null,
  channel       text,
  prospect_id   text,
  prospect_name text,

  summary       text        not null,
  -- Full agent output: the generated message, or the dossier.
  message       text,

  status        text        not null
                  check (status in ('success','failed','pending_approval')),

  -- Audit trail: which harness version produced this action.
  version_id    text,

  tokens        integer     not null default 0,
  latency_ms    integer,
  -- Recorded so the UI can never claim a DronaHQ agent ran when it did not.
  source        text        not null check (source in ('dronahq','simulated'))
);

create index activity_events_campaign_ts_idx on activity_events (campaign_id, ts desc);
create index activity_events_ts_idx on activity_events (ts desc);

-- ---------------------------------------------------------------------------
-- Platform-wide control
-- ---------------------------------------------------------------------------
--
-- Single row, enforced by the primary key check: there is exactly one global
-- kill switch for the whole platform.

create table platform_control (
  id          boolean     primary key default true check (id),
  kill_switch boolean     not null default false,
  updated_at  timestamptz not null default now()
);

insert into platform_control (id, kill_switch) values (true, false);
