/**
 * Postgres access — SERVER ONLY.
 *
 * Never import this from a client component: it holds the database
 * credentials. The browser talks to `/api/state`, which calls in here.
 *
 * Row shapes are mapped to the domain types in lib/types.ts at the boundary,
 * so nothing above this file deals in snake_case or SQL nulls.
 */
import { Pool, type PoolClient } from "pg";
import { SEED_CAMPAIGNS, SEED_PROSPECTS, buildSeedActivity } from "./seed";
import type { Command, StateSnapshot } from "./commands";
import type {
  ActivityEvent,
  AgentConfig,
  AgentKey,
  Campaign,
  Channel,
  ChannelConfig,
  CampaignPolicy,
  PromptVersion,
  Prospect,
  ProspectDossier,
} from "./types";

/**
 * One pool per process, reused across requests. Next.js hot-reloads modules
 * in development, so it is stashed on globalThis to avoid leaking a new pool
 * on every edit.
 */
const globalForPg = globalThis as unknown as { sdrPool?: Pool };

export function pool(): Pool {
  if (!globalForPg.sdrPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForPg.sdrPool = new Pool({
      connectionString,
      // Neon's pooler handles concurrency; keep the app's own pool small so a
      // serverless instance cannot exhaust connections.
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPg.sdrPool;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// ---------------------------------------------------------------------------
// Row -> domain mapping
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const CHANNELS: Channel[] = ["email", "linkedin", "sms", "voice"];

function emptyChannels(): Record<Channel, ChannelConfig> {
  return {
    email: { enabled: false, paused: false },
    linkedin: { enabled: false, paused: false },
    sms: { enabled: false, paused: false },
    voice: { enabled: false, paused: false },
  };
}

function toVersion(r: Row): PromptVersion {
  return {
    id: r.id as string,
    version: r.version as number,
    createdAt: (r.created_at as Date).toISOString(),
    author: r.author as string,
    note: r.note as string,
    systemPrompt: r.system_prompt as string,
    agentPrompts: r.agent_prompts as Record<AgentKey, string>,
  };
}

function toProspect(r: Row): Prospect {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    name: r.name as string,
    title: r.title as string,
    company: r.company as string,
    location: r.location as string,
    email: r.email as string,
    linkedin: r.linkedin as string,
    state: r.state as Prospect["state"],
    fitScore: r.fit_score as number,
    touched: (r.touched as Channel[]) ?? [],
    touchCount: r.touch_count as number,
    lastTouchAt: r.last_touch_at ? (r.last_touch_at as Date).toISOString() : undefined,
    anglesUsed: (r.angles_used as string[]) ?? [],
    lastAction: r.last_action as string,
    lastActionAt: (r.last_action_at as Date).toISOString(),
    researchBrief: (r.research_brief as string) ?? undefined,
    dossier: (r.dossier as ProspectDossier) ?? undefined,
  };
}

function toEvent(r: Row): ActivityEvent {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    ts: (r.ts as Date).toISOString(),
    agent: r.agent as ActivityEvent["agent"],
    channel: (r.channel as Channel) ?? undefined,
    prospectId: (r.prospect_id as string) ?? undefined,
    prospectName: (r.prospect_name as string) ?? undefined,
    summary: r.summary as string,
    message: (r.message as string) ?? undefined,
    status: r.status as ActivityEvent["status"],
    versionId: (r.version_id as string) ?? "-",
    tokens: r.tokens as number,
    latencyMs: (r.latency_ms as number) ?? undefined,
    source: r.source as ActivityEvent["source"],
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Most recent events kept in the snapshot, matching the store's own cap. */
const EVENT_LIMIT = 400;

export async function readState(): Promise<StateSnapshot> {
  const db = pool();
  const [campaignRows, versionRows, channelRows, agentRows, prospectRows, eventRows, control] =
    await Promise.all([
      db.query("select * from campaigns order by created_at"),
      db.query("select * from prompt_versions order by campaign_id, version"),
      db.query("select * from campaign_channels"),
      db.query("select * from campaign_agents"),
      db.query("select * from prospects order by campaign_id, id"),
      db.query("select * from activity_events order by ts desc limit $1", [EVENT_LIMIT]),
      db.query("select kill_switch from platform_control where id = true"),
    ]);

  const versionsByCampaign = new Map<string, PromptVersion[]>();
  for (const r of versionRows.rows) {
    const list = versionsByCampaign.get(r.campaign_id as string) ?? [];
    list.push(toVersion(r));
    versionsByCampaign.set(r.campaign_id as string, list);
  }

  const channelsByCampaign = new Map<string, Record<Channel, ChannelConfig>>();
  for (const r of channelRows.rows) {
    const id = r.campaign_id as string;
    const cfg = channelsByCampaign.get(id) ?? emptyChannels();
    cfg[r.channel as Channel] = { enabled: r.enabled as boolean, paused: r.paused as boolean };
    channelsByCampaign.set(id, cfg);
  }

  const agentsByCampaign = new Map<string, AgentConfig[]>();
  for (const r of agentRows.rows) {
    const id = r.campaign_id as string;
    const list = agentsByCampaign.get(id) ?? [];
    list.push({
      key: r.agent_key as AgentKey,
      enabled: r.enabled as boolean,
      paused: r.paused as boolean,
    });
    agentsByCampaign.set(id, list);
  }

  const campaigns: Campaign[] = campaignRows.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    owner: r.owner as string,
    status: r.status as Campaign["status"],
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
    icp: {
      label: r.icp_label as string,
      geography: r.icp_geography as string,
      targetRoles: (r.icp_target_roles as string[]) ?? [],
      companyCriteria: r.icp_company_criteria as string,
      exclusions: r.icp_exclusions as string,
    },
    channels: channelsByCampaign.get(r.id as string) ?? emptyChannels(),
    agents: agentsByCampaign.get(r.id as string) ?? [],
    dailyLimit: r.daily_limit as number,
    policy: r.policy as CampaignPolicy,
    versions: versionsByCampaign.get(r.id as string) ?? [],
    activeVersionId: (r.active_version_id as string) ?? "",
  }));

  return {
    campaigns,
    prospects: prospectRows.rows.map(toProspect),
    activity: eventRows.rows.map(toEvent),
    killSwitch: (control.rows[0]?.kill_switch as boolean) ?? false,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function insertCampaign(db: PoolClient, c: Campaign) {
  await db.query(
    `insert into campaigns
       (id, name, description, owner, status, icp_label, icp_geography,
        icp_target_roles, icp_company_criteria, icp_exclusions, daily_limit,
        policy, active_version_id, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (id) do update set
       name = excluded.name, description = excluded.description,
       owner = excluded.owner, status = excluded.status,
       icp_label = excluded.icp_label, icp_geography = excluded.icp_geography,
       icp_target_roles = excluded.icp_target_roles,
       icp_company_criteria = excluded.icp_company_criteria,
       icp_exclusions = excluded.icp_exclusions,
       daily_limit = excluded.daily_limit, policy = excluded.policy,
       active_version_id = excluded.active_version_id, updated_at = now()`,
    [
      c.id, c.name, c.description, c.owner, c.status, c.icp.label, c.icp.geography,
      c.icp.targetRoles, c.icp.companyCriteria, c.icp.exclusions, c.dailyLimit,
      JSON.stringify(c.policy), c.activeVersionId, c.createdAt, c.updatedAt,
    ],
  );

  for (const v of c.versions) {
    await db.query(
      `insert into prompt_versions
         (id, campaign_id, version, author, note, system_prompt, agent_prompts, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do nothing`,
      [v.id, c.id, v.version, v.author, v.note, v.systemPrompt,
       JSON.stringify(v.agentPrompts), v.createdAt],
    );
  }

  for (const ch of CHANNELS) {
    await db.query(
      `insert into campaign_channels (campaign_id, channel, enabled, paused)
       values ($1,$2,$3,$4)
       on conflict (campaign_id, channel) do update set
         enabled = excluded.enabled, paused = excluded.paused`,
      [c.id, ch, c.channels[ch].enabled, c.channels[ch].paused],
    );
  }

  for (const a of c.agents) {
    await db.query(
      `insert into campaign_agents (campaign_id, agent_key, enabled, paused)
       values ($1,$2,$3,$4)
       on conflict (campaign_id, agent_key) do update set
         enabled = excluded.enabled, paused = excluded.paused`,
      [c.id, a.key, a.enabled, a.paused],
    );
  }
}

async function insertProspect(db: PoolClient, p: Prospect) {
  await db.query(
    `insert into prospects
       (id, campaign_id, name, title, company, location, email, linkedin,
        state, fit_score, touched, touch_count, last_touch_at, angles_used,
        last_action, last_action_at, research_brief, dossier)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (id) do nothing`,
    [
      p.id, p.campaignId, p.name, p.title, p.company, p.location, p.email,
      p.linkedin, p.state, p.fitScore, p.touched, p.touchCount,
      p.lastTouchAt ?? null, p.anglesUsed, p.lastAction, p.lastActionAt,
      p.researchBrief ?? null, p.dossier ? JSON.stringify(p.dossier) : null,
    ],
  );
}

async function insertEvent(db: PoolClient, e: ActivityEvent) {
  await db.query(
    `insert into activity_events
       (id, campaign_id, ts, agent, channel, prospect_id, prospect_name,
        summary, message, status, version_id, tokens, latency_ms, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (id) do nothing`,
    [
      e.id, e.campaignId, e.ts, e.agent, e.channel ?? null, e.prospectId ?? null,
      e.prospectName ?? null, e.summary, e.message ?? null, e.status,
      e.versionId, e.tokens, e.latencyMs ?? null, e.source,
    ],
  );
}

/** Wipe the app's tables and reinsert the seed. Used by resetDemo and the CLI. */
export async function reseed(db: PoolClient) {
  await db.query(`
    truncate activity_events, prospects, campaign_agents, campaign_channels,
             prompt_versions, campaigns
    restart identity cascade
  `);
  for (const c of SEED_CAMPAIGNS) await insertCampaign(db, c);
  for (const p of SEED_PROSPECTS) await insertProspect(db, p);
  // Relative timestamps, so the feed reads as current on first load.
  for (const e of buildSeedActivity(Date.now())) await insertEvent(db, e);
  await db.query(
    `insert into platform_control (id, kill_switch) values (true, false)
     on conflict (id) do update set kill_switch = false, updated_at = now()`,
  );
}

/**
 * Apply one command.
 *
 * Each runs in a transaction: a command that writes several tables (creating a
 * campaign writes four) must not leave the control plane half-updated.
 */
export async function applyCommand(cmd: Command): Promise<void> {
  const db = await pool().connect();
  try {
    await db.query("begin");

    switch (cmd.op) {
      case "setCampaignStatus":
        await db.query(
          "update campaigns set status = $2, updated_at = now() where id = $1",
          [cmd.campaignId, cmd.status],
        );
        break;

      case "toggleAgentPause":
        await db.query(
          `update campaign_agents set paused = $3
           where campaign_id = $1 and agent_key = $2`,
          [cmd.campaignId, cmd.agent, cmd.paused],
        );
        break;

      case "toggleChannelPause":
        await db.query(
          `update campaign_channels set paused = $3
           where campaign_id = $1 and channel = $2`,
          [cmd.campaignId, cmd.channel, cmd.paused],
        );
        break;

      case "setKillSwitch":
        await db.query(
          "update platform_control set kill_switch = $1, updated_at = now() where id = true",
          [cmd.on],
        );
        break;

      case "upsertCampaign":
        await insertCampaign(db, cmd.campaign);
        break;

      case "saveVersion":
        await db.query(
          `insert into prompt_versions
             (id, campaign_id, version, author, note, system_prompt, agent_prompts, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [cmd.version.id, cmd.campaignId, cmd.version.version, cmd.version.author,
           cmd.version.note, cmd.version.systemPrompt,
           JSON.stringify(cmd.version.agentPrompts), cmd.version.createdAt],
        );
        // A new version activates immediately; older ones stay for rollback.
        await db.query(
          "update campaigns set active_version_id = $2, updated_at = now() where id = $1",
          [cmd.campaignId, cmd.version.id],
        );
        break;

      case "activateVersion":
        await db.query(
          "update campaigns set active_version_id = $2, updated_at = now() where id = $1",
          [cmd.campaignId, cmd.versionId],
        );
        break;

      case "addProspect":
        await insertProspect(db, cmd.prospect);
        break;

      case "updateProspect": {
        const p = cmd.patch;
        await db.query(
          `update prospects set
             state          = coalesce($2, state),
             fit_score      = coalesce($3, fit_score),
             touched        = coalesce($4, touched),
             touch_count    = coalesce($5, touch_count),
             last_touch_at  = coalesce($6, last_touch_at),
             angles_used    = coalesce($7, angles_used),
             last_action    = coalesce($8, last_action),
             last_action_at = coalesce($9, last_action_at),
             research_brief = coalesce($10, research_brief),
             dossier        = coalesce($11, dossier)
           where id = $1`,
          [
            cmd.prospectId, p.state ?? null, p.fitScore ?? null, p.touched ?? null,
            p.touchCount ?? null, p.lastTouchAt ?? null, p.anglesUsed ?? null,
            p.lastAction ?? null, p.lastActionAt ?? null, p.researchBrief ?? null,
            p.dossier ? JSON.stringify(p.dossier) : null,
          ],
        );
        break;
      }

      case "pushEvent":
        await insertEvent(db, cmd.event);
        // Keep the log bounded so a long demo does not grow without limit.
        await db.query(
          `delete from activity_events where id in (
             select id from activity_events order by ts desc offset $1
           )`,
          [EVENT_LIMIT * 2],
        );
        break;

      case "resetDemo":
        await reseed(db);
        break;
    }

    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
}
