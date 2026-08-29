import { expect, test } from "./fixtures";
import {
  ADMIN_EMAIL,
  createProject,
  createTodo,
  openProject,
  PASSWORD,
  signIn,
  signOut,
  signUp,
  uniqueEmail,
} from "./helpers";

/**
 * Every screen, in every state.
 *
 * The bug this replaces survived because signing out was only ever tested from
 * one screen. Seven routes carried an identical guard; three of them bounced,
 * and the three that did were the ones whose loader happened to make a request
 * that 401'd. A table is the only shape that catches that.
 */
const SCREENS = ["/", "/my", "/search", "/account", "/admin", "/dev/design-system"] as const;

test.describe("what a signed-out visitor can reach", () => {
  for (const screen of SCREENS) {
    test(`${screen} sends them to the login form`, async ({ page }) => {
      await page.goto(screen);

      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    });
  }

  test("a project they have no session for", async ({ page }) => {
    await page.goto("/projects/1");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a URL that does not exist is not a way to learn that", async ({ page }) => {
    // "Page not found" is a screen too, and the list of public ones has two
    // entries on it.
    await page.goto("/no-such-page");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Page not found")).toBeHidden();
  });

  test("does not leave the protected URL in the history", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    // `replace`, so going back leaves the app rather than retrying a URL that
    // will only bounce again.
    await expect(page).not.toHaveURL(/\/my|\/search|\/account|\/admin/);
  });
});

test.describe("signing out", () => {
  for (const screen of SCREENS) {
    test(`from ${screen} lands on the login form`, async ({ page }) => {
      await signUp(page);
      await page.goto(screen);
      // `/admin` refuses an ordinary account, but the account menu is in the
      // header either way, which is what this is signing out from.
      await signOut(page);

      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    });
  }

  test("from inside a project, taking the tasks with it", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Private work");
    await openProject(page, "Private work");
    await createTodo(page, "見えてはいけないタスク");

    await signOut(page);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("見えてはいけないタスク")).toBeHidden();
  });

  test("leaves nothing for the back button to find", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Back button");
    await openProject(page, "Back button");
    await createTodo(page, "戻っても見えないタスク");

    await signOut(page);
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await expect(page.getByText("戻っても見えないタスク")).toBeHidden();
  });

  test("does not carry the previous screen into the next sign-in", async ({ page }) => {
    // Signing out is a deliberate exit. Carrying the path over would land the
    // next person on this machine on the previous person's screen.
    await signUp(page);
    await page.goto("/search");
    await signOut(page);

    expect(new URL(page.url()).pathname).toBe("/login");
    expect(new URL(page.url()).search).toBe("");
  });
});

test.describe("what an ordinary account can reach", () => {
  test("everything except the administrator's screen", async ({ page }) => {
    await signUp(page);

    for (const screen of ["/", "/my", "/search", "/account", "/dev/design-system"]) {
      await page.goto(screen);
      // The dashboard writes its own defaults into the query string.
      await expect(page).toHaveURL(new RegExp(screen === "/" ? "localhost:5173/(\\?|$)" : screen));
    }

    await page.goto("/admin");
    await expect(page.getByText("権限がありません")).toBeVisible();
    // Refused before anything runs: no account list is fetched for somebody
    // who may not see one.
    await expect(page.getByRole("heading", { level: 1, name: "ユーザー管理" })).toBeHidden();
  });
});

test.describe("what an administrator can reach", () => {
  test("the administrator's screen, once they hold the role", async ({ browser, page }) => {
    const adminContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.81" },
    });
    const theAdmin = await adminContext.newPage();
    await signUp(theAdmin, uniqueEmail("gate-admin"), "Gate Admin");
    const beforeRole = await theAdmin.evaluate(() => document.title);
    expect(typeof beforeRole).toBe("string");

    await theAdmin.goto("/admin");
    await expect(theAdmin.getByText("権限がありません")).toBeVisible();

    // The warm-up account is the owner, which is what can grant the role.
    await signIn(page, ADMIN_EMAIL);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const id = await theAdmin.evaluate(async () => {
      const res = await fetch("/api/auth/get-session");
      return ((await res.json()) as { user: { id: string } }).user.id;
    });
    const promoted = await page.request.patch(`/api/users/${id}/role`, {
      data: { role: "admin" },
    });
    expect(promoted.status()).toBe(204);

    await theAdmin.goto("/admin");
    await expect(theAdmin.getByRole("heading", { level: 1, name: "ユーザー管理" })).toBeVisible();

    // Put it back, so a later spec reading the directory finds what it expects.
    await page.request.patch(`/api/users/${id}/role`, { data: { role: "member" } });
    await adminContext.close();
  });
});

test.describe("the login form itself", () => {
  test("is not where a signed-in visitor stays", async ({ page }) => {
    await signUp(page);

    await page.goto("/login");

    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("still returns an interrupted visitor to where they were going", async ({ page }) => {
    const email = await signUp(page);
    await signOut(page);

    await page.goto("/my");
    await expect(page).toHaveURL(/redirect=/);

    // Signed in on the page they landed on, not by navigating to /login again:
    // the helper's `goto` would drop the very parameter under test.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/my/);
  });
});

test.describe("a shared link", () => {
  test("needs no session and brings no app furniture with it", async ({ page }) => {
    await page.goto("/s/does-not-exist");

    // Not bounced: this is the one screen this app has for people with no
    // account.
    await expect(page).not.toHaveURL(/\/login/);
    // And no sidebar full of links into somebody else's app.
    await expect(page.getByRole("link", { name: "ダッシュボード" })).toBeHidden();
  });
});
