import { applyD1Migrations, env } from "cloudflare:test";

// applyD1Migrations() only applies migrations that haven't been applied yet,
// so this remains safe even if the setup file runs more than once.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
