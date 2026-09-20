/**
 * Seed the database from lib/seed.ts.
 *
 * A thin CLI wrapper around `reseed` in lib/db.ts, so the app's resetDemo and
 * this script share one implementation rather than drifting apart.
 *
 * Idempotent: reseeding truncates first, so re-running gives a clean known
 * state rather than duplicates.
 */
import { pool, reseed } from "../lib/db.ts";
import { loadEnv, safeTarget } from "./client.mts";

loadEnv();
console.log(`target: ${safeTarget()}\n`);

const db = await pool().connect();
try {
  await db.query("begin");
  await reseed(db);
  await db.query("commit");
} catch (err) {
  await db.query("rollback");
  console.error("seed failed, rolled back:");
  console.error(err instanceof Error ? err.message : err);
  db.release();
  await pool().end();
  process.exit(1);
}

const counts = await db.query<{ t: string; n: number }>(`
  select 'campaigns' t, count(*)::int n from campaigns
  union all select 'prompt_versions', count(*)::int from prompt_versions
  union all select 'campaign_channels', count(*)::int from campaign_channels
  union all select 'campaign_agents', count(*)::int from campaign_agents
  union all select 'prospects', count(*)::int from prospects
  union all select 'activity_events', count(*)::int from activity_events
  order by 1
`);
for (const r of counts.rows) console.log(`  ${r.t.padEnd(20)} ${r.n}`);

db.release();
await pool().end();
