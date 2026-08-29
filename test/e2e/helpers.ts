import { expect, request, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery";

/**
 * The account the warm-up creates, before any test runs.
 *
 * The first account to exist becomes the administrator, and the E2E
 * database starts empty on every run — so without this the first test to sign
 * up would silently hold every permission, and an isolation test would pass
 * while proving nothing. Fixed rather than unique because there is exactly one
 * of it per run.
 */
export const ADMIN_EMAIL = "warm-up-admin@example.com";

/** Where the dev server is. Mirrors playwright.config.ts. */
const BASE_URL = `http://localhost:${process.env.PORT ?? 5173}`;

let counter = 0;

/**
 * A project key nothing else in this run is using.
 *
 * Not a counter: this module is reloaded partway through a run (see
 * fixtures.ts), so a counter restarts and starts handing out keys that already
 * exist.
 */
export function uniqueKey(): string {
  return `K${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

/** Unique per call — the E2E database persists across tests within a run. */
export function uniqueEmail(prefix = "e2e"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/** Signs up through the UI and waits for the app to let us in. */
export async function signUp(
  page: Page,
  email = uniqueEmail(),
  // Named, because a test with two accounts cannot tell them apart otherwise —
  // and a picker showing "E2E user" twice will hand back whichever one the
  // locator happened to reach.
  name = "E2E user",
): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: "アカウントを作る" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  // Watch the request itself. Without this a rejected sign-up reports only
  // "the Projects heading never appeared", which reads like a routing bug and
  // has sent this suite chasing the wrong thing more than once.
  const responded = page.waitForResponse((res) => res.url().includes("/api/auth/sign-up/email"));
  await page.getByRole("button", { name: "Create account" }).click();

  const res = await responded;
  if (!res.ok()) {
    throw new Error(`sign-up failed (${res.status()}): ${await res.text()}`);
  }

  // The assertion is the point: signing up has to actually land somewhere.
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  return email;
}

/**
 * Makes an account that may create projects, and signs in as it.
 *
 * Creating a project is an administrator's act, so a test that needs
 * one needs an account that can make it. Deliberately not what `signUp` gives
 * you: with every actor an administrator, the scoping tests would run as
 * somebody who can reach everything and pass without proving anything.
 *
 * The account is made *by the owner*, through the endpoint an administrator
 * uses for exactly this, rather than signed up and then promoted.
 * That was the first shape, and it cost three requests to `/api/auth/*` on the
 * page's own address — sign-up, then a reload to pick the new role up. The
 * limiter there allows ten a minute per address, and `get-session` is one of
 * them, so the longer tests started reading as signed-out halfway through. One
 * sign-in is all this needs.
 */
export async function signUpAdmin(
  page: Page,
  email = uniqueEmail("admin"),
  // The same display name `signUp` uses: the role is what differs, and a
  // different name would quietly change what every assignee picker and comment
  // byline in the suite says.
  name = "E2E user",
): Promise<string> {
  // `page.url()` is "about:blank" until the first navigation, so the base URL
  // comes from the config rather than from the page.
  const origin = BASE_URL;
  const owner = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      // Better Auth validates this; without it every sign-in here is a 403.
      Origin: origin,
      // Its own address, so these never eat into the page's rate-limit budget.
      "CF-Connecting-IP": addressFor(email),
    },
  });
  try {
    const signedIn = await owner.post("/api/auth/sign-in/email", {
      data: { email: ADMIN_EMAIL, password: PASSWORD },
    });
    if (!signedIn.ok()) throw new Error(`owner sign-in failed (${signedIn.status()})`);

    const created = await owner.post("/api/users", {
      data: { name, email, password: PASSWORD, role: "admin" },
    });
    if (!created.ok()) throw new Error(`could not create ${email} (${created.status()})`);
  } finally {
    await owner.dispose();
  }

  await signIn(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  return email;
}

/** A per-account address, so the promotions above do not share a rate limit. */
function addressFor(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `10.${(hash >>> 16) & 0xff}.${(hash >>> 8) & 0xff}.${hash & 0xff}`;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /^アカウント:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // Signing out throws the page away rather than routing, so this
  // waits for the new document. Without it the next `goto` races a navigation
  // already in flight and aborts — which reads as the test's own navigation
  // failing rather than as the one before it still running.
  await page.waitForURL(/\/login/);
}

export async function createProject(page: Page, name: string) {
  await page.getByRole("button", { name: "プロジェクトを追加" }).click();
  await page.getByLabel("プロジェクト名").fill(name);
  // Typed rather than left to follow the name: keys are unique across the
  // instance and the E2E database lives for the whole run, so two tests both
  // creating a "Board" would collide — and the second would fail somewhere
  // that says nothing about keys.
  await page.getByLabel("プロジェクトキー").fill(uniqueKey());
  await page.getByRole("dialog").getByRole("button", { name: "追加" }).click();
  // `exact`, because a toast is also a dialog and the failure message starts
  // with these same words.
  await expect(page.getByRole("dialog", { name: "プロジェクトを追加", exact: true })).toBeHidden();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toBeHidden();
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(name) })).toBeVisible();
}

/**
 * Opens a project from the list on the page.
 *
 * Scoped to `main` because the sidebar lists the same projects, so
 * an unscoped locator matches both and Playwright refuses to guess.
 */
export async function openProject(page: Page, name: string | RegExp) {
  await page.getByRole("main").getByRole("link", { name }).click();
}

/**
 * Changes which project everything else is about, from the header.
 *
 * The switcher lives there rather than in the sidebar because it is not one of
 * the things a project offers — it decides which project is offering them.
 */
export async function switchProject(page: Page, name: string) {
  await page.getByRole("button", { name: "プロジェクトを切り替える" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name }).click();
}

/**
 * Creates a task through the only route there is: the detail form.
 *
 * There used to be a title-only field on the page, and this helper used it.
 * Removing it is the point of the change — a task worth tracking is rarely
 * just a line of text — so the helper now does what a person does.
 */
export async function createTodo(page: Page, title: string) {
  await page.getByRole("button", { name: "タスクを追加" }).click();
  await page.getByLabel("タイトル", { exact: true }).fill(title);
  await page
    .getByRole("dialog", { name: "タスクを追加" })
    .getByRole("button", { name: "追加" })
    .click();
  await expect(page.getByRole("dialog", { name: "タスクを追加" })).toBeHidden();
  // The overlay outlives the dialog by one closing animation, and while it is
  // there it intercepts the next click — which then fails somewhere unrelated.
  await expect(page.locator('[data-slot="dialog-overlay"]')).toBeHidden();
  await expect(page.getByText(title)).toBeVisible();
}

/** Opens a row's overflow menu and clicks an item in it. */
export async function rowAction(page: Page, rowLabel: string, item: string) {
  await page.getByRole("button", { name: `「${rowLabel}」の操作` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** The signed-in account's id, read through the session endpoint. */
export async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get("/api/auth/get-session");
  const body = (await res.json()) as { user?: { id: string } } | null;
  if (!body?.user) throw new Error(`no session: ${res.status()}`);
  return body.user.id;
}
