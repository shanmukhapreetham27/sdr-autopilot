/** Post-seed sanity check: does the data actually say what the app expects? */
import { connect } from "./client.mts";
const c = await connect();
const q = async (label: string, sql: string) => {
  const { rows } = await c.query(sql);
  console.log(`\n${label}`);
  for (const r of rows) console.log("  " + Object.values(r).join("  |  "));
};

await q("campaigns and state", `
  select name, status, icp_label, daily_limit,
         (policy->>'maxTouches') as max_touches,
         (policy->>'minScoreThreshold') as threshold
  from campaigns order by name`);

await q("funnel per campaign", `
  select c.name, p.state, count(*)::int
  from prospects p join campaigns c on c.id = p.campaign_id
  group by 1,2 order by 1,2`);

await q("cross-campaign duplicate (conflict detection)", `
  select email, count(*)::int campaigns_targeting
  from prospects group by email having count(*) > 1`);

await q("active harness resolves", `
  select c.name, v.version, v.note
  from campaigns c join prompt_versions v on v.id = c.active_version_id
  order by c.name`);

await q("open channels per live campaign", `
  select c.name, string_agg(ch.channel, ', ' order by ch.channel)
  from campaigns c join campaign_channels ch on ch.campaign_id = c.id
  where c.status = 'live' and ch.enabled and not ch.paused
  group by c.name`);

await q("kill switch", "select kill_switch from platform_control");
await c.end();
