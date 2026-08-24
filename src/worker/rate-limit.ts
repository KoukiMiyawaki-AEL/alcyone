import type { Context } from "hono";

/**
 * The client's IP, for keying limits on unauthenticated requests.
 *
 * `CF-Connecting-IP` is set by Cloudflare's edge and cannot be spoofed by the
 * client in production. It is absent in local development, where everything
 * then shares one bucket — fine for a limiter, and worth knowing when a local
 * request is unexpectedly rejected.
 */
export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "local";
}

/**
 * Applies a limiter and returns a 429 when it trips, or null to continue.
 *
 * Retry-After is always the configured period: the binding reports only
 * success or failure, not how long the caller should wait.
 */
export async function enforce(
  limiter: RateLimit,
  key: string,
  periodSeconds: 10 | 60,
): Promise<Response | null> {
  const { success } = await limiter.limit({ key });
  if (success) return null;

  return Response.json(
    { error: "Too Many Requests" },
    { status: 429, headers: { "Retry-After": String(periodSeconds) } },
  );
}
