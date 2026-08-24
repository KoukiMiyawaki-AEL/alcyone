import { expect, test } from "@playwright/test";

import { PASSWORD, createProject, createTodo, rowAction, signOut, signUp } from "./helpers";

test.describe("ownership and deletion", () => {
  test("one user's projects are invisible to another", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Alice's private project");
    await signOut(page);

    await signUp(page);
    await expect(page.getByText("No projects yet")).toBeVisible();
    await expect(page.getByRole("link", { name: /Alice's private project/ })).toBeHidden();
  });

  test("another user's project id is not reachable by URL", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Private");
    await page.getByRole("link", { name: /Private/ }).click();
    const victimUrl = page.url();
    await signOut(page);

    await signUp(page);
    await page.goto(victimUrl);

    await expect(page.getByText("Project not found")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Private" })).toBeHidden();
  });

  test("deleting a todo offers Undo, and Undo restores it", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Undo project");
    await page.getByRole("link", { name: /Undo project/ }).click();
    await createTodo(page, "bring me back");

    await rowAction(page, "bring me back", "Delete");
    await expect(page.getByText("bring me back")).toBeHidden();

    // Soft delete is only worth anything if the user can reach the undo.
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("bring me back")).toBeVisible();
  });

  test("deleting an account removes its data and signs you out", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Doomed project");

    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await page.getByRole("button", { name: "アカウントを削除", exact: true }).click();
    await page.getByLabel("確認のためパスワードを入力").fill(PASSWORD);
    await page.getByRole("button", { name: "完全に削除する" }).click();

    await expect(page).toHaveURL(/\/login/);

    // And the account really is gone — signing back in must fail.
    await page.getByLabel("Email").fill("does-not-matter@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });
});
