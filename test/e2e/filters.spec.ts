import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUpAdmin, uniqueKey } from "./helpers";

test.describe("list filtering", () => {
  test.beforeEach(async ({ page }) => {
    await signUpAdmin(page);
    // A fresh name per test: an administrator sees every project (ADR 0036)
    // and the E2E database lives for the whole run, so a fixed name here would
    // put four "Filter project"s on the dashboard by the last test.
    const name = `Filter project ${uniqueKey()}`;
    await createProject(page, name);
    await openProject(page, name);
    await createTodo(page, "still open");
    await createTodo(page, "finished");
    await page.getByRole("checkbox", { name: "「finished」を完了にする" }).click();
  });

  test("filtering puts the state in the URL and re-queries", async ({ page }) => {
    await page.getByRole("button", { name: "未完了" }).click();

    await expect(page).toHaveURL(/status=active/);
    await expect(page.getByText("still open")).toBeVisible();
    await expect(page.getByText("finished")).toBeHidden();
  });

  test("a filtered view survives a reload", async ({ page }) => {
    await page.getByRole("button", { name: "完了", exact: true }).click();
    await expect(page.getByText("finished")).toBeVisible();

    await page.reload();

    // The point of keeping this in the URL rather than component state.
    await expect(page.getByText("finished")).toBeVisible();
    await expect(page.getByText("still open")).toBeHidden();
  });

  test("changing sort keeps the status filter", async ({ page }) => {
    await page.getByRole("button", { name: "未完了" }).click();
    await page.getByRole("button", { name: "優先度" }).click();

    await expect(page).toHaveURL(/status=active/);
    await expect(page).toHaveURL(/sort=priority/);
  });

  test("a nonsense filter in the URL falls back instead of breaking", async ({ page }) => {
    const url = new URL(page.url());
    url.searchParams.set("status", "not-a-status");
    await page.goto(url.toString());

    // `catch` in the search schema: a hand-edited URL should degrade, not throw.
    await expect(page.getByText("still open")).toBeVisible();
    await expect(page.getByText("finished")).toBeVisible();
  });
});
