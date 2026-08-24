import { expect, test } from "./fixtures";
import { createProject, createTodo, signUp } from "./helpers";

const viewSwitch = (page: import("@playwright/test").Page) =>
  page.getByRole("group", { name: "表示形式" });

test.describe("timeline view", () => {
  test("shows dated tasks on the axis and lists the undated ones", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await page.getByRole("link", { name: "Schedule" }).click();

    await page.getByLabel("新しいタスクのタイトル").fill("日程のあるタスク");
    await page.getByRole("button", { name: "詳細を設定して追加" }).click();
    await page.getByLabel("開始日").fill("2026-11-02");
    await page.getByLabel("期限日").fill("2026-11-06");
    await page.getByRole("dialog").getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("日程のあるタスク")).toBeVisible();

    await createTodo(page, "日程のないタスク");

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/view=timeline/);

    await expect(page.getByRole("button", { name: "日程のあるタスク" })).toBeVisible();

    // Undated tasks are listed rather than dropped: a view that quietly omits
    // them answers "what is scheduled" while looking like it answered "what is
    // there".
    await expect(page.getByText("日付が未設定のタスク（1件）")).toBeVisible();
    await page.getByText("日付が未設定のタスク（1件）").click();
    await expect(page.getByRole("button", { name: "日程のないタスク" })).toBeVisible();
  });

  test("says so when no task has a date yet", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await page.getByRole("link", { name: "Schedule" }).click();
    await createTodo(page, "日付なし");

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();

    await expect(page.getByText(/日付が設定されたタスクがまだありません/)).toBeVisible();
  });

  test("opens the detail form from a bar", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await page.getByRole("link", { name: "Schedule" }).click();

    await page.getByLabel("新しいタスクのタイトル").fill("編集する");
    await page.getByRole("button", { name: "詳細を設定して追加" }).click();
    await page.getByLabel("期限日").fill("2026-11-20");
    await page.getByRole("dialog").getByRole("button", { name: "追加" }).click();

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();
    await page.getByRole("button", { name: "編集する" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("期限日")).toHaveValue("2026-11-20");
  });
});
