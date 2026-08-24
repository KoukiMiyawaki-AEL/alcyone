import { expect, test } from "./fixtures";
import { createProject, createTodo, signUp } from "./helpers";

test.describe("display name", () => {
  test("is editable, and appears where the account acts", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: /^アカウント:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();

    await page.getByLabel("表示名").fill("設計担当");
    await page.getByRole("button", { name: "保存" }).click();

    // The header names the person, because that is what everyone else sees on
    // their comments.
    await expect(page.getByRole("button", { name: "アカウント: 設計担当" })).toBeVisible();

    await page.getByRole("link", { name: "Projects" }).click();
    await createProject(page, "Naming");
    await page.getByRole("link", { name: "Naming" }).click();
    await createTodo(page, "誰かのタスク");

    await page.getByRole("button", { name: "「誰かのタスク」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByLabel("コメント", { exact: true }).fill("わたしが書いた");
    await page.getByRole("button", { name: "コメントする" }).click();

    // The name is resolved from the row's author rather than assumed to be the
    // signed-in user — the same value today, and not the same value the day a
    // project has two people on it.
    await expect(page.getByText("設計担当")).toHaveCount(2);
  });

  test("cannot be saved blank or unchanged", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: /^アカウント:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();

    // Nothing typed yet, so there is nothing to save.
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

    await page.getByLabel("表示名").fill("   ");
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  test("does not offer to change the email", async ({ page }) => {
    // Changing it is an identity change that needs the address proved, and
    // there is no mail infrastructure to prove it with.
    await signUp(page);
    await page.getByRole("button", { name: /^アカウント:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();

    await expect(page.getByLabel("メールアドレス")).toBeDisabled();
  });
});

test.describe("assignment", () => {
  test("a task shows who it is assigned to, by their current name", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: /^アカウント:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await page.getByLabel("表示名").fill("実装担当");
    await page.getByRole("button", { name: "保存" }).click();

    await page.getByRole("link", { name: "Projects" }).click();
    await createProject(page, "Assigning");
    await page.getByRole("link", { name: "Assigning" }).click();
    await createTodo(page, "割り当てるタスク");

    await page.getByRole("button", { name: "「割り当てるタスク」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("combobox", { name: "担当者" }).click();
    await page.getByRole("option", { name: "実装担当" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();

    await expect(page.getByLabel("担当: 実装担当")).toBeVisible();

    // Renaming moves the name everywhere without touching a task, because the
    // task stores an id.
    await page.getByRole("button", { name: /^アカウント:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await page.getByLabel("表示名").fill("改名後");
    await page.getByRole("button", { name: "保存" }).click();

    await page.getByRole("link", { name: "Projects" }).click();
    await page.getByRole("link", { name: "Assigning" }).click();
    await expect(page.getByLabel("担当: 改名後")).toBeVisible();
  });

  test("a task can be handed back to nobody", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Assigning");
    await page.getByRole("link", { name: "Assigning" }).click();
    await createTodo(page, "戻すタスク");

    await page.getByRole("button", { name: "「戻すタスク」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("combobox", { name: "担当者" }).click();
    await page.getByRole("option", { name: "E2E user" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();
    await expect(page.getByLabel("担当: E2E user")).toBeVisible();

    await page.getByRole("button", { name: "「戻すタスク」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("combobox", { name: "担当者" }).click();
    await page.getByRole("option", { name: "未割り当て" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();

    // Assignable but never un-assignable would be a trap.
    await expect(page.getByLabel(/^担当:/)).toBeHidden();
  });
});
