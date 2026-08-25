import { expect, test } from "./fixtures";
import { createProject, createTodo, signUp } from "./helpers";

test.describe("board view", () => {
  test("moves a task between columns and the move survives a reload", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Board");
    await page.getByRole("link", { name: "Board" }).click();
    await createTodo(page, "動かすタスク");

    await page
      .getByRole("group", { name: "表示形式" })
      .getByRole("button", { name: "ボード" })
      .click();
    await expect(page).toHaveURL(/view=board/);

    const todoColumn = page.getByRole("region", { name: "未着手" });
    await expect(todoColumn.getByText("動かすタスク")).toBeVisible();

    await page.getByRole("button", { name: "「動かすタスク」を進行中へ移動" }).click();
    await expect(
      page.getByRole("region", { name: "進行中" }).getByText("動かすタスク"),
    ).toBeVisible();

    // The board writes through the same endpoint the list does, so the move is
    // in the database rather than only on screen.
    await page.reload();
    await expect(
      page.getByRole("region", { name: "進行中" }).getByText("動かすタスク"),
    ).toBeVisible();
  });

  test("the view is part of the link, and the list still filters", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Board");
    await page.getByRole("link", { name: "Board" }).click();
    await createTodo(page, "一覧のタスク");

    await page
      .getByRole("group", { name: "表示形式" })
      .getByRole("button", { name: "ボード" })
      .click();
    // The board's columns are its status filter, so the list's would be a
    // second one that could disagree.
    await expect(page.getByRole("group", { name: "ステータスで絞り込む" })).toBeHidden();

    await page
      .getByRole("group", { name: "表示形式" })
      .getByRole("button", { name: "一覧" })
      .click();
    await expect(page.getByRole("group", { name: "ステータスで絞り込む" })).toBeVisible();
  });
});

test.describe("adding a task", () => {
  test("goes straight to the full form, with no title-only shortcut", async ({ page }) => {
    // A task that has a deadline usually has it at the moment it is written
    // down. The shortcut that used to sit here mostly produced tasks that had
    // to be opened and filled in anyway.
    await signUp(page);
    await createProject(page, "Planning");
    await page.getByRole("link", { name: "Planning" }).click();

    await expect(page.getByLabel("新しいタスクのタイトル")).toBeHidden();

    await page.getByRole("button", { name: "タスクを追加" }).click();
    await page.getByLabel("タイトル", { exact: true }).fill("期限つきで作る");
    await page.getByLabel("期限日").fill("2026-12-24");
    await page
      .getByRole("dialog", { name: "タスクを追加" })
      .getByRole("button", { name: "追加" })
      .click();

    await expect(page.getByLabel(new RegExp("期限.* 2026-12-24"))).toBeVisible();
    await expect(page.getByText("期限つきで作る")).toBeVisible();
  });
});
