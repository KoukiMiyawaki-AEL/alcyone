import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUpAdmin } from "./helpers";

test.describe("search", () => {
  test("finds a todo from another project and links to it", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Work 1");
    await openProject(page, "Work 1");
    await createTodo(page, "設計ドキュメントを書く");

    await page.getByRole("link", { name: "検索" }).click();
    await page.getByLabel("Search").fill("ドキュメント");
    await page.getByRole("button", { name: "Search" }).click();

    // The query belongs in the URL, so the result is linkable and survives a
    // reload — the same rule the filtered lists follow.
    await expect(page).toHaveURL(/\/search\?q=/);
    await page.getByRole("link", { name: "設計ドキュメントを書く" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Work 1" })).toBeVisible();
  });

  test("a search survives a reload and reports no matches plainly", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Work 2");
    await openProject(page, "Work 2");
    await createTodo(page, "write the plan");

    await page.goto("/search?q=nothingmatchesthis");
    await expect(page.getByText("No matches")).toBeVisible();

    await page.reload();
    await expect(page.getByText("No matches")).toBeVisible();
    await expect(page.getByLabel("Search")).toHaveValue("nothingmatchesthis");
  });
});
