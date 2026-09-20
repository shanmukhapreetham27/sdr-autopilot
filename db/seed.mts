/**
 * Seed the database from lib/seed.ts.
 *
 * Deliberately imports the same module the app uses, so the demo data has one
 * definition rather than drifting between a TypeScript copy and a SQL copy.
 *
 * Idempotent: truncates the tables it owns before inserting, so re-running
 * gives a clean known state rather than duplicates.
 */
import { SEED_CAMPAIGNS, SEED_PROSPECTS, buildSeedActivity } from "../lib/seed.ts";
import type { Channel } from "../lib/types.ts";
import { connect, safeTarget } from "./client.mts";

const client = await connect();
console.log(`target: ${safeTarget()}\n`);

await client.query("begin");
try {
  // Order matters only for readability: the cascades would handle it anyway.
  await client.query(`
    truncate activity_events, prospects, campaign_agents, campaign_channels,
             prompt_versions, campaigns
    restart identity cascade
  `);

  for (const c of SEED_CAMPAIGNS) {
    await client.query(
      `insert into campaigns
         (id, name, description, owner, status, icp_label, icp_geography,
          icp_target_roles, icp_company_criteria, icp_exclusions, daily_limit,
          policy, active_version_id, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        c.id, c.name, c.description, c.owner, c.status,
        c.icp.label, c.icp.geography, c.icp.targetRoles,
        c.icp.companyCriteria, c.icp.exclusions,
        c.dailyLimit, JSON.stringify(c.policy),
        c.activeVersionId, c.createdAt, c.updatedAt,
      ],
    );

    for (const v of c.versions) {
      await client.query(
        `insert into prompt_versions
           (id, campaign_id, version, author, note, system_prompt, agent_prompts, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [v.id, c.id, v.version, v.author, v.note, v.systemPrompt,
         JSON.stringify(v.agentPrompts), v.createdAt],
      );
    }

    for (const ch of Object.keys(c.channels) as Channel[]) {
      await client.query(
        `insert into campaign_channels (campaign_id, channel, enabled, paused)
         values ($1,$2,$3,$4)`,
        [c.id, ch, c.channels[ch].enabled, c.channels[ch].paused],
      );
    }

    for (const a of c.agents) {
      await client.query(
        `insert into campaign_agents (campaign_id, agent_key, enabled, paused)
         values ($1,$2,$3,$4)`,
        [c.id, a.key, a.enabled, a.paused],
      );
    }
  }

  for (const p of SEED_PROSPECTS) {
    await client.query(
      `insert into prospects
         (id, campaign_id, name, title, company, location, email, linkedin,
          state, fit_score, touched, touch_count, last_touch_at, angles_used,
          last_action, last_action_at, research_brief, dossier)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        p.id, p.campaignId, p.name, p.title, p.company, p.location, p.email,
        p.linkedin, p.state, p.fitScore, p.touched, p.touchCount,
        p.lastTouchAt ?? null, p.anglesUsed, p.lastAction, p.lastActionAt,
        p.researchBrief ?? null, p.dossier ? JSON.stringify(p.dossier) : null,
      ],
    );
  }

  // Activity timestamps are relative, so the feed looks current on first load.
  for (const e of buildSeedActivity(Date.now())) {
    await client.query(
      `insert into activity_events
         (id, campaign_id, ts, agent, channel, prospect_id, prospect_name,
          summary, message, status, version_id, tokens, latency_ms, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        e.id, e.campaignId, e.ts, e.agent, e.channel ?? null,
        e.prospectId ?? null, e.prospectName ?? null, e.summary,
        e.message ?? null, e.status, e.versionId, e.tokens,
        e.latencyMs ?? null, e.source,
      ],
    );
  }

  await client.query(
    `insert into platform_control (id, kill_switch) values (true, false)
     on conflict (id) do update set kill_switch = false, updated_at = now()`,
  );

  await client.query("commit");
} catch (err) {
  await client.query("rollback");
  console.error("seed failed, rolled back:");
  console.error(err instanceof Error ? err.message : err);
  await client.end();
  process.exit(1);
}

const counts = await client.query<{ t: string; n: number }>(`
  select 'campaigns' t, count(*)::int n from campaigns
  union all select 'prompt_versions', count(*)::int from prompt_versions
  union all select 'campaign_channels', count(*)::int from campaign_channels
  union all select 'campaign_agents', count(*)::int from campaign_agents
  union all select 'prospects', count(*)::int from prospects
  union all select 'activity_events', count(*)::int from activity_events
  order by 1
`);
for (const r of counts.rows) console.log(`  ${r.t.padEnd(20)} ${r.n}`);

await client.end();
