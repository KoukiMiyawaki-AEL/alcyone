import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs with `globals: false`, so Testing Library cannot register its own
// auto-cleanup hook (it guards on `typeof afterEach === "function"`). Without
// this, the DOM accumulates across tests and queries start matching leftovers.
afterEach(cleanup);
