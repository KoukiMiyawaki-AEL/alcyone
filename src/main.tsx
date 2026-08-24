import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import type { AuthState } from "@/features/auth/types";

import "./index.css";
import { routeTree } from "./routeTree.gen";

// `auth` is filled in by InnerApp below. The router needs the context type up
// front so that route `beforeLoad` guards can read it, but the value only
// exists inside React, where the session hook lives.
const router = createRouter({
  routeTree,
  context: { auth: undefined! as AuthState },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function InnerApp() {
  const auth = useAuth();
  return <RouterProvider router={router} context={{ auth }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <InnerApp />
    </AuthProvider>
  </StrictMode>,
);
