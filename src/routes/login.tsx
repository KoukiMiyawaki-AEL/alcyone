import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { SignInForm, type SignInMode } from "@/features/auth/components/SignInForm";
import { authClient } from "@/lib/auth-client";

const searchSchema = z.object({
  // Where to go after signing in. Validated so the parameter cannot be used to
  // bounce someone to another origin.
  redirect: z
    .string()
    .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
      message: "must be a same-origin path",
    })
    .optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  component: LoginComponent,
});

function LoginComponent() {
  const router = useRouter();
  const { user } = useAuth();
  const { redirect: redirectTo } = Route.useSearch();
  const [mode, setMode] = useState<SignInMode>("sign-in");

  // The only thing that navigates *away* from /login, deliberately.
  //
  // Navigating from the submit handler races the session hook: sign-in resolves
  // before the hook has refetched, so the destination's guard still sees no user
  // and bounces straight back here. And a `beforeLoad` redirect here would fight
  // the protected routes' guards over a context that lags by a render, which
  // produces a redirect loop rather than a race. Reacting to the user appearing
  // is the one ordering that holds.
  useEffect(() => {
    if (user) void router.navigate({ to: redirectTo ?? "/" });
  }, [user, router, redirectTo]);

  async function handleSubmit(values: { email: string; password: string; name: string }) {
    const { error } =
      mode === "sign-up"
        ? await authClient.signUp.email({
            email: values.email,
            password: values.password,
            name: values.name,
          })
        : await authClient.signIn.email({ email: values.email, password: values.password });

    if (error) {
      return error.message ?? "サインインに失敗しました。";
    }

    // Navigation is handled by the effect above, once the session lands.
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <PageHeader title={mode === "sign-up" ? "Create account" : "Sign in"} description="alcyone" />

      <Card>
        <CardHeader>
          <CardTitle>{mode === "sign-up" ? "Create account" : "Sign in"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignInForm key={mode} mode={mode} onSubmit={handleSubmit} />
          <Button
            variant="link"
            size="sm"
            className="self-center"
            onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
          >
            {mode === "sign-up" ? "既にアカウントがある" : "アカウントを作る"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
