declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

/**
 * Vite's `?raw` import, for reading a migration's SQL into a test.
 *
 * Declared here rather than by pulling in `vite/client`: this project builds
 * with `tsc -b` across several configs, and the worker tests have no business
 * knowing about the DOM types that come with it.
 */
declare module "*.sql?raw" {
  const contents: string;
  export default contents;
}
