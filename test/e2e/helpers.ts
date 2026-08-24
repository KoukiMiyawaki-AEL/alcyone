import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery";

let counter = 0;

/** Unique per call — the E2E database persists across tests within a run. */
export function uniqueEmail(prefix = "e2e"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/** Signs up through the UI and waits for the app to let us in. */
export async function signUp(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: "アカウントを作る" }).click();
  await page.getByLabel("Name").fill("E2E user");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // The assertion is the point: signing up has to actually land somewhere.
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  return email;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /^アカウント:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

export async function createProject(page: Page, name: string) {
  await page.getByLabel("New project name").fill(name);
  await page.getByRole("button", { name: "Add Project" }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
}

export async function createTodo(page: Page, title: string) {
  await page.getByLabel("新しいタスクのタイトル").fill(title);
  // `exact` because "詳細を設定して追加" also contains it.
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText(title)).toBeVisible();
}

/** Opens a row's overflow menu and clicks an item in it. */
export async function rowAction(page: Page, rowLabel: string, item: string) {
  await page.getByRole("button", { name: `「${rowLabel}」の操作` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
