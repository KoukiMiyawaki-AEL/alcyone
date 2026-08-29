import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUpAdmin } from "./helpers";

async function openDetails(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: `「${title}」の操作` }).click();
  await page.getByRole("menuitem", { name: "詳細を編集" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("comments and history", () => {
  test("a comment is written, edited and removed", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Activity 1");
    await openProject(page, "Activity 1");
    await createTodo(page, "議論するタスク");

    await openDetails(page, "議論するタスク");

    await page.getByLabel("コメント", { exact: true }).fill("先に前提を確認する");
    await page.getByRole("button", { name: "コメントする" }).click();
    await expect(page.getByText("先に前提を確認する")).toBeVisible();

    await page.getByRole("button", { name: "コメントを編集" }).click();
    await page.getByLabel("コメントを編集").fill("前提はもう確認済み");
    await page.getByRole("button", { name: "更新" }).click();
    await expect(page.getByText("前提はもう確認済み")).toBeVisible();
    await expect(page.getByText(/編集済み/)).toBeVisible();

    await page.getByRole("button", { name: "コメントを削除" }).click();
    await expect(page.getByText("前提はもう確認済み")).toBeHidden();
  });

  test("a status change is recorded with both values and survives a reload", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Activity 2");
    await openProject(page, "Activity 2");
    await createTodo(page, "動かすタスク");

    await openDetails(page, "動かすタスク");
    await page.getByRole("combobox", { name: "ステータス" }).click();
    await page.getByRole("option", { name: "進行中" }).click();
    await page.getByRole("button", { name: "保存" }).click();

    await openDetails(page, "動かすタスク");
    // Both ends: "it became blocked" without saying from what is half the
    // story when the question is why a schedule slipped.
    await expect(page.getByText(/ステータス.*未着手 → 進行中/)).toBeVisible();
    await expect(page.getByText("作成", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.reload();
    await openDetails(page, "動かすタスク");
    await expect(page.getByText(/未着手 → 進行中/)).toBeVisible();
  });

  test("one save is one entry, and the note explaining it sits inside", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Activity 3");
    await openProject(page, "Activity 3");
    await createTodo(page, "まとめて更新するタスク");

    await openDetails(page, "まとめて更新するタスク");
    await page.getByRole("combobox", { name: "ステータス" }).click();
    await page.getByRole("option", { name: "ブロック中" }).click();
    await page.getByLabel("期限日").fill("2026-12-01");
    await page.getByLabel("この変更についてのコメント（任意）").fill("APIレビュー待ち");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await openDetails(page, "まとめて更新するタスク");

    // Two fields and the reason, as one thing that happened — not three items
    // that share a timestamp.
    const feed = page.getByRole("list", { name: "アクティビティ" });
    const entries = feed.getByRole("listitem");
    const entry = entries.filter({ hasText: "APIレビュー待ち" });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText("未着手 → ブロック中");
    await expect(entry).toContainText("2026-12-01");
  });

  test("saving without changing anything records nothing", async ({ page }) => {
    // The form submits every field on every save, so a history that recorded
    // what was asked for would bury real changes under non-changes.
    await signUpAdmin(page);
    await createProject(page, "Activity 4");
    await openProject(page, "Activity 4");
    await createTodo(page, "触らないタスク");

    await openDetails(page, "触らないタスク");
    await page.getByRole("button", { name: "保存" }).click();

    await openDetails(page, "触らないタスク");
    await expect(page.getByText("作成", { exact: true })).toBeVisible();
    await expect(page.getByText("→")).toBeHidden();
  });
});
