import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * `upload_source_maps` in wrangler.jsonc only has something to upload if the
 * Worker bundle is built with source maps. The Worker environment is named
 * after the Worker, so match on "not the client" instead of hardcoding it.
 * Client source maps stay off so they are not served as public assets.
 */
const workerSourcemaps: Plugin = {
  name: "alcyone:worker-sourcemaps",
  configEnvironment(name) {
    if (name === "client") return;
    return { build: { sourcemap: true } };
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must run before react() — it generates src/routeTree.gen.ts that the
    // React app imports. Options live in tsr.config.json so that `tsr generate`
    // (pnpm run codegen) produces the identical file outside of Vite.
    tanstackRouter(),
    react(),
    tailwindcss(),
    cloudflare({
      // E2E runs against a throwaway database so a test never clobbers local
      // development data, and every run starts from an empty one.
      ...(process.env.E2E ? { persistState: { path: ".wrangler/e2e-state" } } : {}),
    }),
    workerSourcemaps,
  ],
  server: {
    // Pinned because BETTER_AUTH_URL in .dev.vars names this exact origin.
    // strictPort makes a taken port fail loudly instead of drifting to 5174,
    // where auth would silently disagree about its own base URL.
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
