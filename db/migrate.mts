/**
 * Apply every SQL file in db/migrations in filename order, exactly once.
 *
 * Applied migrations are recorded in schema_migrations, so re-running is a
 * no-op rather than an error.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, safeTarget } from "./client.mts";

const dir = join(process.cwd(), "db", "migrations");
const client = await connect();

await client.query(`
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  )
`);

const { rows: done } = await client.query<{ filename: string }>(
  "select filename from schema_migrations",
);
const applied = new Set(done.map((r) => r.filename));

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
console.log(`target: ${safeTarget()}`);

let count = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip    ${file} (already applied)`);
    continue;
  }
  const sql = readFileSync(join(dir, file), "utf8");
  try {
    // Each migration is one transaction: a failure leaves no partial schema.
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into schema_migrations (filename) values ($1)", [file]);
    await client.query("commit");
    console.log(`  applied ${file}`);
    count += 1;
  } catch (err) {
    await client.query("rollback");
    console.error(`  FAILED  ${file}`);
    console.error(err instanceof Error ? err.message : err);
    await client.end();
    process.exit(1);
  }
}

console.log(count ? `\n${count} migration(s) applied.` : "\nAlready up to date.");
await client.end();
