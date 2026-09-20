/**
 * Drop every table, view and type in the public schema.
 *
 * DESTRUCTIVE and irreversible. Requires --yes so it cannot be run by
 * accident, and prints what it is about to destroy before doing it.
 */
import { connect, safeTarget } from "./client.mts";

const confirmed = process.argv.includes("--yes");
const client = await connect();

const { rows: tables } = await client.query<{ table_name: string; n: number }>(`
  select c.relname as table_name,
         coalesce((select n_live_tup from pg_stat_user_tables s where s.relid = c.oid), 0)::int as n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r'
  order by c.relname
`);

console.log(`target: ${safeTarget()}`);
if (tables.length === 0) {
  console.log("public schema is already empty.");
  await client.end();
  process.exit(0);
}

console.log(`\nabout to DROP ${tables.length} table(s):`);
for (const t of tables) console.log(`  ${t.table_name.padEnd(30)} ~${t.n} row(s)`);

if (!confirmed) {
  console.log("\nNothing dropped. Re-run with --yes to confirm.");
  await client.end();
  process.exit(1);
}

// Recreating the schema is cleaner than dropping tables one at a time: it
// removes dependent views, sequences and types in the right order too.
await client.query("drop schema public cascade");
await client.query("create schema public");
console.log("\npublic schema dropped and recreated. All previous data is gone.");

await client.end();
