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
