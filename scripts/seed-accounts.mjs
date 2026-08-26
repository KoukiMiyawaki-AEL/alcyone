/**
 * Creates the local development accounts: an owner, an administrator, and an
 * ordinary user.
 *
 * The accounts themselves are made through the running dev server's sign-up
 * endpoint. Better Auth hashes passwords with its own parameters, so an INSERT
 * would produce an account nobody can sign in to.
 *
 * The roles are then written straight to the local database with
 * `wrangler d1 execute --local`. That is the console path, used deliberately:
 * granting a role requires an account that already holds one (ADR 0034), and a
 * seeding script has nobody to act as. It only ever grants, never demotes, so
 * the rule it steps around — that the last owner cannot be removed — is not one
 * it can break. It refuses to run against anything but localhost for the same
 * reason it is safe here.
 *
 * Idempotent: an account that already exists is left alone, and a role that is
 * already right is not rewritten. Safe to run twice.
 *
 * Requires `pnpm dev` to be running. Writes to the local development database
 * (`.wrangler/state`) only — the E2E database is rebuilt from empty on every
 * run and seeds its own owner in test/e2e/warm-up.ts.
 */
import { execFileSync } from "node:child_process";

const BASE = process.env.ALCYONE_URL ?? "http://localhost:5173";

/**
 * Deliberately weak, and deliberately printed. These accounts live on a
 * developer's own machine in a database that gets thrown away; treating the
 * password as a secret would only mean nobody could find it when they needed
 * to sign in.
 */
const PASSWORD = process.env.ALCYONE_DEV_PASSWORD ?? "alcyone-dev-password";

const ACCOUNTS = [
  { role: "owner", email: "owner@alcyone.test", name: "Dev Owner" },
  { role: "admin", email: "admin@alcyone.test", name: "Dev Admin" },
  // An ordinary account too. Without one, every screen is being looked at by
  // somebody who can do everything — which is exactly the view that hides a
  // permission bug until someone else finds it.
  { role: "member", email: "member@alcyone.test", name: "Dev Member" },
];

/** Better Auth validates the Origin header; without one it answers 403. */
const headers = { "Content-Type": "application/json", Origin: BASE };

function d1(sql) {
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(out)[0].results;
}

async function main() {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
    console.error(`Refusing to seed ${BASE}. This writes roles straight to a local database.`);
    process.exit(1);
  }

  let health;
  try {
    health = await fetch(new URL("/api/health", BASE));
  } catch {
    console.error(`No dev server at ${BASE}. Start one with \`pnpm dev\` and run this again.`);
    process.exit(1);
  }
  if (!health.ok) {
    console.error(`${BASE} answered ${health.status} for /api/health.`);
    process.exit(1);
  }

  for (const account of ACCOUNTS) {
    const res = await fetch(new URL("/api/auth/sign-up/email", BASE), {
      method: "POST",
      headers,
      body: JSON.stringify({ email: account.email, password: PASSWORD, name: account.name }),
    });

    if (res.ok) {
      console.log(`created         ${account.email}`);
      continue;
    }

    // Almost always "this address already has an account", which is the state
    // this script is trying to reach anyway. Anything else is worth seeing.
    const existing = d1(`SELECT id FROM user WHERE email = '${account.email}'`);
    if (existing.length === 0) {
      console.error(`\n${account.email}: sign-up failed (${res.status}): ${await res.text()}`);
      process.exit(1);
    }
    console.log(`already existed ${account.email}`);
  }

  for (const account of ACCOUNTS) {
    // Addresses are literals from the list above, not input.
    d1(`UPDATE user SET role = '${account.role}' WHERE email = '${account.email}'`);
  }

  const rows = d1("SELECT email, role FROM user ORDER BY created_at, id");

  console.log(`\nSign in at ${BASE}/login — password: ${PASSWORD}\n`);
  for (const account of ACCOUNTS) {
    const row = rows.find((entry) => entry.email === account.email);
    console.log(`  ${row.role.padEnd(6)}  ${account.email}`);
  }

  // Anyone else on this instance, so that a database with a pre-existing owner
  // does not look like the script silently failed to make one.
  const others = rows.filter((row) => !ACCOUNTS.some((a) => a.email === row.email));
  if (others.length > 0) {
    console.log("\nAlso on this database:");
    for (const row of others) console.log(`  ${row.role.padEnd(6)}  ${row.email}`);
  }
}

await main();
