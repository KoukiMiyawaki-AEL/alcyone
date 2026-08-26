import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUp, switchProject } from "./helpers";

test.describe("dashboard", () => {
  test("shows each project's progress rather than just its name", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Measured");
    await openProject(page, "Measured");
    await createTodo(page, "ひとつめ");
    await createTodo(page, "ふたつめ");

    // Finish one of the two. A click, not `.check()`: completing a task re-runs the loader and the row
    // is replaced, so the element Playwright would read the state back from is
    // no longer the one it clicked.
    await page.getByRole("checkbox", { name: "「ひとつめ」を完了にする" }).click();
    await expect(page.getByRole("checkbox", { name: "「ひとつめ」を未完了に戻す" })).toBeVisible();

    await page.getByRole("link", { name: "ダッシュボード" }).click();
    await expect(page.getByText("1 / 2 完了（50%）")).toBeVisible();
  });

  test("says a project has no tasks instead of showing it as 0% done", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Untouched");

    await expect(page.getByText("まだタスクがありません")).toBeVisible();
  });

  test("the switcher reaches a project without going through the list", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Reachable");
    await createProject(page, "Other");

    await openProject(page, "Other");
    await switchProject(page, "Reachable");

    await expect(page.getByRole("heading", { level: 1, name: "Reachable" })).toBeVisible();
  });
});

test.describe("my tasks", () => {
  test("collects what is assigned to me across projects, and groups it by date", async ({
    page,
  }) => {
    await signUp(page);
    await createProject(page, "Mine");
    await openProject(page, "Mine");
    await createTodo(page, "自分の仕事");

    // Assign it to the only account there is, through the detail form.
    await page.getByRole("button", { name: "「自分の仕事」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("combobox", { name: "担当者" }).click();
    await page.getByRole("option", { name: "E2E user" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();

    await page.getByRole("link", { name: "マイタスク" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "マイタスク" })).toBeVisible();
    await expect(page.getByRole("link", { name: "自分の仕事" })).toBeVisible();
    // The project's name travels with the task: without it a cross-project
    // list is a pile of titles with nothing to place them.
    await expect(page.getByText("Mine", { exact: true })).toBeVisible();
  });

  test("says so plainly when nothing is assigned", async ({ page }) => {
    await signUp(page);

    await page.getByRole("link", { name: "マイタスク" }).click();
    await expect(page.getByText("担当しているタスクはありません")).toBeVisible();
  });
});

test.describe("project overview", () => {
  test("summarises the project the sidebar is scoped to", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Summed");
    await openProject(page, "Summed");
    await createTodo(page, "ひとつめ");
    await createTodo(page, "ふたつめ");
    await page.getByRole("checkbox", { name: "「ひとつめ」を完了にする" }).click();
    await expect(page.getByRole("checkbox", { name: "「ひとつめ」を未完了に戻す" })).toBeVisible();

    await page.getByRole("navigation").first().getByRole("link", { name: "概要" }).click();

    await expect(page).toHaveURL(/view=overview/);
    await expect(page.getByText("1 / 2 完了（50%）")).toBeVisible();
    // A summary of a filtered subset answers a question nobody asked.
    await expect(page.getByRole("group", { name: "並び替え" })).toBeHidden();
  });

  test("says what needs attention, and opens it", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Late");
    await openProject(page, "Late");
    await createTodo(page, "遅れているタスク");

    await page.getByRole("button", { name: "「遅れているタスク」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByLabel("期限日").fill("2020-01-01");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();

    await page.getByRole("navigation").first().getByRole("link", { name: "概要" }).click();

    const overdue = page.getByRole("button", { name: /遅れているタスク/ });
    await expect(overdue).toBeVisible();
    await overdue.click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeVisible();
  });
});
