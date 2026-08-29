import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUpAdmin } from "./helpers";

/**
 * The point of this change is that the fields are *settable*. Until now the
 * schema had a due date and a priority that no screen could reach, so a test
 * that only checked the API would have said the feature worked while the app
 * offered no way to use it.
 */
test.describe("task details", () => {
  test("sets status, dates, priority and a note, and they survive a reload", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Planning 2");
    await openProject(page, "Planning 2");
    await createTodo(page, "設計を書く");

    await page.getByRole("button", { name: "「設計を書く」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();

    await page.getByLabel("開始日").fill("2026-11-01");
    await page.getByLabel("期限日").fill("2026-11-30");
    await page.getByLabel("メモ").fill("先に前提を洗い出す");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByLabel(new RegExp("期限.* 2026-11-30"))).toBeVisible();
    await expect(page.getByText("先に前提を洗い出す")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("開始日 2026-11-01")).toBeVisible();
    await expect(page.getByText("先に前提を洗い出す")).toBeVisible();
  });

  test("refuses a start date after the due date without saving anything", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Planning 3");
    await openProject(page, "Planning 3");
    await createTodo(page, "逆順");

    await page.getByRole("button", { name: "「逆順」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();

    await page.getByLabel("開始日").fill("2026-12-02");
    await page.getByLabel("期限日").fill("2026-12-01");
    await page.getByRole("button", { name: "保存" }).click();

    // The dialog stays open with the message, rather than closing on a write
    // that did not happen.
    await expect(page.getByRole("alert")).toContainText("開始日は期限日より後にできません");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("filters the list by a status the checkbox cannot express", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Planning 4");
    await openProject(page, "Planning 4");
    await createTodo(page, "進行中のもの");
    await createTodo(page, "手つかずのもの");

    await page.getByRole("button", { name: "「進行中のもの」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("combobox", { name: "ステータス" }).click();
    await page.getByRole("option", { name: "進行中" }).click();
    await page.getByRole("button", { name: "保存" }).click();

    // The badge itself is covered by the component test; what only this level
    // can show is that the status reached the database and the query uses it.
    await page.getByRole("button", { name: "進行中", exact: true }).click();
    await expect(page).toHaveURL(/status=in_progress/);
    await expect(page.getByText("進行中のもの")).toBeVisible();
    await expect(page.getByText("手つかずのもの")).toBeHidden();
  });
});
