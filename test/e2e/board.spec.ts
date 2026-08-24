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

test.describe("adding a task with details", () => {
  test("sets a due date at the moment the task is written down", async ({ page }) => {
    // A task that has a deadline usually has it when it is created; "add it
    // now, fill it in later" is how a due date never gets set at all.
    await signUp(page);
    await createProject(page, "Planning");
    await page.getByRole("link", { name: "Planning" }).click();

    await page.getByLabel("新しいタスクのタイトル").fill("期限つきで作る");
    await page.getByRole("button", { name: "詳細を設定して追加" }).click();

    // What was typed carries into the form rather than being retyped.
    await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue("期限つきで作る");

    await page.getByLabel("期限日").fill("2026-12-24");
    await page.getByRole("dialog").getByRole("button", { name: "追加" }).click();

    await expect(page.getByLabel("期限日 2026-12-24")).toBeVisible();
    await expect(page.getByText("期限つきで作る")).toBeVisible();
  });
});
