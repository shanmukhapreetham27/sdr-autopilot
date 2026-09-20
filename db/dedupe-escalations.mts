/**
 * One-off cleanup for escalations logged by the pre-fix retry loop.
 *
 * Before prospects were parked on a human verdict, an escalating agent kept
 * re-selecting the same prospect every tick. The agent is deterministic, so it
 * produced the same verdict and logged another escalation each time. The queue
 * filled with duplicates of a handful of prospects.
 *
 * This keeps the most recent open escalation per prospect — the one a reviewer
 * should actually decide on — and marks the older duplicates resolved. It does
 * not touch escalations that are already resolved, and it never deletes a row:
 * the log is an audit trail, so a superseded escalation stays readable with
 * who closed it and why.
 *
 * Safe to re-run. Once each prospect has a single open escalation there is
 * nothing left to supersede.
 *
 *   npx tsx db/dedupe-escalations.mts          # report only
 *   npx tsx db/dedupe-escalations.mts --apply  # write
 */
import { connect, safeTarget } from "./client.mts";

const APPLY = process.argv.includes("--apply");
const RESOLVED_BY = "system (superseded)";

const client = await connect();
console.log(`target: ${safeTarget()}`);
console.log(APPLY ? "mode:   APPLY\n" : "mode:   DRY RUN (pass --apply to write)\n");

/**
 * Open escalations that are not the newest for their prospect.
 *
 * Partitioned by prospect rather than by summary text: the same prospect
 * re-scored by the same agent is the duplicate this cleans up, and the wording
 * can differ between runs.
 */
const FIND_DUPLICATES = `
  select id, campaign_id, prospect_name, ts
    from (
      select id, campaign_id, prospect_name, ts,
             row_number() over (
               partition by campaign_id, prospect_id
               order by ts desc
             ) as recency
        from activity_events
       where status = 'pending_approval'
         and resolved_at is null
         and prospect_id is not null
    ) ranked
   where recency > 1
   order by campaign_id, prospect_name, ts
`;

const { rows: duplicates } = await client.query<{
  id: string;
  campaign_id: string;
  prospect_name: string;
  ts: Date;
}>(FIND_DUPLICATES);

if (!duplicates.length) {
  console.log("No duplicate escalations. Every prospect already has at most one open.");
  await client.end();
  process.exit(0);
}

const byProspect = new Map<string, number>();
for (const row of duplicates) {
  const key = `${row.campaign_id} · ${row.prospect_name}`;
  byProspect.set(key, (byProspect.get(key) ?? 0) + 1);
}

console.log(`${duplicates.length} superseded escalation(s) across ${byProspect.size} prospect(s):`);
for (const [who, n] of [...byProspect.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(3)} superseded   ${who}`);
}
if (byProspect.size > 10) console.log(`  ... and ${byProspect.size - 10} more`);

if (!APPLY) {
  console.log("\nDry run: nothing written. Re-run with --apply to resolve these.");
  await client.end();
  process.exit(0);
}

// One statement, one transaction: a partial cleanup would leave the queue in a
// state that is neither the old backlog nor the intended one.
const { rowCount } = await client.query(
  `update activity_events
      set resolved_at = now(), resolved_by = $1
    where id = any($2::text[])
      and resolved_at is null`,
  [RESOLVED_BY, duplicates.map((d) => d.id)],
);

const { rows: remaining } = await client.query<{ n: string }>(
  `select count(*) as n from activity_events
    where status = 'pending_approval' and resolved_at is null`,
);

console.log(`\nResolved ${rowCount} superseded escalation(s).`);
console.log(`${remaining[0].n} escalation(s) still open — one decision each.`);
await client.end();
