import { expect, test } from "./fixtures";
import { createProject, createTodo, signUp } from "./helpers";

test.describe("list filtering", () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page);
    await createProject(page, "Filter project");
    await page.getByRole("link", { name: /Filter project/ }).click();
    await createTodo(page, "still open");
    await createTodo(page, "finished");
    await page.getByRole("checkbox", { name: /Mark "finished" as done/ }).click();
  });

  test("filtering puts the state in the URL and re-queries", async ({ page }) => {
    await page.getByRole("button", { name: "Active" }).click();

    await expect(page).toHaveURL(/status=active/);
    await expect(page.getByText("still open")).toBeVisible();
    await expect(page.getByText("finished")).toBeHidden();
  });

  test("a filtered view survives a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("finished")).toBeVisible();

    await page.reload();

    // The point of keeping this in the URL rather than component state.
    await expect(page.getByText("finished")).toBeVisible();
    await expect(page.getByText("still open")).toBeHidden();
  });

  test("changing sort keeps the status filter", async ({ page }) => {
    await page.getByRole("button", { name: "Active" }).click();
    await page.getByRole("button", { name: "Priority" }).click();

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
