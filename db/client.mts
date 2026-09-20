/**
 * Shared database plumbing for the db/* scripts.
 *
 * These scripts run outside Next.js, so they load `.env.local` themselves
 * rather than relying on the framework's env handling.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // Both files are optional.
    }
  }
}

export async function connect(): Promise<pg.Client> {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Add it to .env.local.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

/** Host and database only — never print the password. */
export function safeTarget(): string {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "unknown";
  }
}
