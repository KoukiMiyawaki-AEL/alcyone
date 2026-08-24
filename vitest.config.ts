import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const srcAlias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("./drizzle", import.meta.url)));

  return {
    test: {
      projects: [
        {
          // API tests: the real workerd runtime with a real D1, driven through
          // `app.request()`. No DOM, no React.
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/worker/**/*.test.ts"],
            setupFiles: ["./test/apply-migrations.ts"],
          },
        },
        {
          // Component tests: jsdom + Testing Library. Deliberately separate from
          // the worker project — the two need different runtimes and globals.
          plugins: [react()],
          resolve: { alias: srcAlias },
          test: {
            name: "components",
            // `.ts` as well as `.tsx`: this project is "runs in a DOM", not
            // "renders JSX". A pure function that only the client uses belongs
            // here, and should not have to take a JSX extension to be found.
            include: ["test/components/**/*.test.ts", "test/components/**/*.test.tsx"],
            environment: "happy-dom",
            setupFiles: ["./test/setup-dom.ts"],
          },
        },
      ],
    },
  };
});
