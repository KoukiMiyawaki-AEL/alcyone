/**
 * Refuses to let a deploy go out with local-development placeholders in it.
 *
 * `wrangler deploy --dry-run` does not catch this: it validates the shape of
 * the config, not whether the resources named in it exist. A placeholder
 * `database_id` type-checks, builds, and dry-runs cleanly — and then the
 * deployed Worker cannot reach a database.
 *
 * Run as part of `pnpm run deploy`, before anything is uploaded.
 */
import { readFileSync } from "node:fs";

// The config is JSONC. Stripped by hand rather than pulling in a parser for
// one file — this reads a config we own, not arbitrary input. The `[^:]` guard
// keeps `https://` in a string from being mistaken for a comment; a `//` inside
// any other string would still confuse it, which is a limit worth knowing
// before reusing this anywhere else.
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const config = JSON.parse(
  raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    // Trailing commas are legal in JSONC and not in JSON.
    .replace(/,(\s*[}\]])/g, "$1"),
);

const problems = [];

const d1 = config.d1_databases?.[0]?.database_id;
if (!d1 || /^0+(-0+)*$/.test(d1)) {
  problems.push(
    "d1_databases[0].database_id is still the placeholder. Run: wrangler d1 create alcyone-db",
  );
}

const kv = config.kv_namespaces?.[0]?.id;
// A real namespace id is 32 hex characters; the local value is a readable name.
if (!kv || !/^[0-9a-f]{32}$/.test(kv)) {
  problems.push(
    "kv_namespaces[0].id is not a real namespace id. Run: wrangler kv namespace create SHARE_CACHE",
  );
}

if (!config.queues?.consumers?.[0]?.dead_letter_queue) {
  problems.push("queues.consumers[0].dead_letter_queue is missing; failures would retry forever.");
}

if (problems.length > 0) {
  console.error("Refusing to deploy:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nSee docs/deploy.md.");
  process.exit(1);
}

console.log("preflight: wrangler.jsonc names real resources.");
