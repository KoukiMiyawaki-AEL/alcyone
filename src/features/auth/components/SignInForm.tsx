import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SignInMode = "sign-in" | "sign-up";

type SignInFormProps = {
  mode: SignInMode;
  /** Resolves to an error message, or null on success. */
  onSubmit: (values: { email: string; password: string; name: string }) => Promise<string | null>;
};

export function SignInForm({ mode, onSubmit }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const signingUp = mode === "sign-up";
  const canSubmit = Boolean(email.trim() && password && (!signingUp || name.trim()));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      // Keep what was typed on failure — retyping a password is the most
      // annoying possible way to lose a form.
      setError(await onSubmit({ email: email.trim(), password, name: name.trim() }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {signingUp ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            disabled={submitting}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          disabled={submitting}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={signingUp ? "new-password" : "current-password"}
          disabled={submitting}
        />
        {signingUp ? (
          <p className="text-xs text-muted-foreground">12文字以上で入力してください。</p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting || !canSubmit}>
        {signingUp ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
