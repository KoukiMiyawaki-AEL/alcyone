/**
 * Event recording, for the questions logs cannot answer.
 *
 * Logs are for reading one request; this is for counting many. "How often is
 * that share link opened, and is the cache actually earning its keep" is not a
 * question you can answer by grepping, because logs are sampled and retained
 * for days while this keeps a queryable time series.
 *
 * Write-only from here. Reading happens through Cloudflare's SQL API with an
 * account token, which means **nothing in this file can be read back in code** —
 * not by the Worker, and not by a test.
 *
 * The one thing that genuinely cannot be fixed later is the *shape*. A dataset
 * is append-only and unversioned: `blobs[2]` is stored as `blob2` forever, so
 * reordering or repurposing a position silently corrupts every query over
 * historical data — the old rows keep their old meaning and nothing says so.
 * Hence one module, fixed positions, and tests that pin them.
 */

/**
 * Writes without ever being able to break the caller.
 *
 * `recordServerError` runs inside `app.onError`, and an exception there has
 * nowhere to go — Hono's last resort is the thing that just threw. A missing
 * binding is enough to cause it, which is exactly the situation an error
 * handler is dealing with in the first place. A test found this by handing the
 * app an incomplete env.
 *
 * The rule is the same one the fire-and-forget shape implies: counting must
 * never cost the thing being counted.
 */
function safeWrite(analytics: AnalyticsEngineDataset | undefined, point: AnalyticsEngineDataPoint) {
  try {
    analytics?.writeDataPoint(point);
  } catch {
    // Nothing useful to do. Losing a data point is not worth a failed request,
    // and reporting the loss would need the thing that just failed.
  }
}

/** `indexes` takes exactly one value, and Cloudflare truncates it past 96 bytes. */
const MAX_INDEX_BYTES = 96;

function toIndex(value: string): string {
  // Truncating here rather than letting the platform do it silently, so the
  // rule is visible where the value is chosen.
  return value.length > MAX_INDEX_BYTES ? value.slice(0, MAX_INDEX_BYTES) : value;
}

/**
 * A read of a public share link.
 *
 * `outcome` distinguishes a KV hit from a miss, which is the only way to tell
 * whether the cache in is doing anything. Indexed by token so one
 * link's traffic can be isolated; the token is already public to anyone
 * holding the link, so this adds no exposure.
 *
 * Deliberately records no IP, no user agent, and no user id. This counts
 * reads, and turning it into a record of who read what is a different feature
 * with different obligations.
 */
export function recordShareView(
  analytics: AnalyticsEngineDataset | undefined,
  token: string,
  outcome: "hit" | "miss" | "not_found",
): void {
  safeWrite(analytics, {
    indexes: [toIndex(token)],
    // Positions are permanent: 1 = event name, 2 = outcome.
    blobs: ["share_view", outcome],
    // 1 = count, so a SUM over a time bucket is the view count.
    doubles: [1],
  });
}

/**
 * An unhandled failure.
 *
 * Indexed by path rather than by request id: the useful question is "which
 * endpoint is failing", and a request id has cardinality equal to traffic
 * while grouping nothing. The id is kept as a blob so one row can still be
 * matched back to its log line.
 */
export function recordServerError(
  analytics: AnalyticsEngineDataset | undefined,
  event: { path: string; method: string; requestId: string | undefined },
): void {
  safeWrite(analytics, {
    indexes: [toIndex(event.path)],
    // 1 = event name, 2 = method, 3 = request id.
    blobs: ["server_error", event.method, event.requestId ?? ""],
    doubles: [1],
  });
}
