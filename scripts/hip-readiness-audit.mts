// Read-only local audit. The key is loaded into this process only; never logged.
// npx tsx scripts/hip-readiness-audit.mts --key-file <path> --username <Hip username> --output <report.json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const keyFile = option("--key-file");
const username = option("--username");
const output = option("--output");
if (!keyFile || !username || !output) throw new Error("Supply --key-file, --username, and --output.");
const key = readFileSync(keyFile, "utf8").trim();
if (!key || /\s/.test(key)) throw new Error("The key file must contain one plain API key.");
// The same audit-only connection used by the UI; other Hip jobs stay disabled.
process.env.HIP_READINESS_API_KEY_FILE = resolve(keyFile);
process.env.HIP_READINESS_USERNAME = username;

const { loadHipReadiness } = await import("../lib/hip/readiness-data");
const { sql } = await import("@vercel/postgres");
try {
  const report = await loadHipReadiness(true);
  const destination = resolve(output);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    output: destination, inventory: report.rows.length, counts: report.counts,
    snapshot: report.snapshot, hipOutsideSelectionOrUnmatched: report.hipUnmatched.length,
  }));
  if (report.snapshot.state !== "complete") process.exitCode = 2;
} finally {
  await sql.end();
}
