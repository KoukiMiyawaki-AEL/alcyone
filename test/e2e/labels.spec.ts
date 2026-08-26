import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUp } from "./helpers";

/** Adds a label from the project's settings screen. */
async function addLabel(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("navigation").first().getByRole("link", { name: "設定" }).click();
  await page.getByLabel("ラベルを追加").fill(name);
  // Scoped: the members card on this screen has an 追加 button of its own.
  await page
    .getByRole("form", { name: "新しいラベル" })
    .getByRole("button", { name: "追加" })
    .click();
  await expect(page.getByText(name)).toBeVisible();
}

test.describe("labels", () => {
  test("is made on the project, then put on a task, and shows on the row", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Labelled");
    await openProject(page, "Labelled");
    await createTodo(page, "調べもの");

    await addLabel(page, "要調査");

    await page.getByRole("link", { name: "一覧" }).click();
    await page.getByRole("button", { name: "「調べもの」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("button", { name: "要調査" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();

    // On the row, not only inside the dialog: the point of a label is that it
    // is visible without opening anything. Two chips carry the name now — the
    // filter above the list is the other — so this asks for the one beside the
    // task rather than for "somewhere on the page".
    await expect(
      page
        .getByRole("main")
        .locator("div")
        .filter({ hasText: "調べもの" })
        .getByText("要調査")
        .last(),
    ).toBeVisible();
  });

  test("narrows the list, and the filter lives in the URL", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Filtered");
    await openProject(page, "Filtered");
    await createTodo(page, "ラベル付き");
    await createTodo(page, "ラベルなし");

    await addLabel(page, "対象");

    await page.getByRole("link", { name: "一覧" }).click();
    await page.getByRole("button", { name: "「ラベル付き」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "対象" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();

    await page.getByRole("group", { name: "ラベルで絞り込む" }).getByRole("button").click();

    await expect(page).toHaveURL(/label=\d+/);
    await expect(page.getByText("ラベル付き")).toBeVisible();
    await expect(page.getByText("ラベルなし")).toBeHidden();

    // Survives a reload, because it is in the URL rather than in a component.
    await page.reload();
    await expect(page.getByText("ラベルなし")).toBeHidden();

    // And the same gesture clears it.
    await page.getByRole("group", { name: "ラベルで絞り込む" }).getByRole("button").click();
    await expect(page.getByText("ラベルなし")).toBeVisible();
  });

  test("deleting a label takes it off the tasks that carried it", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Pruned");
    await openProject(page, "Pruned");
    await createTodo(page, "残るタスク");

    await addLabel(page, "消える");

    await page.getByRole("link", { name: "一覧" }).click();
    await page.getByRole("button", { name: "「残るタスク」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "消える" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();
    await expect(
      page.getByRole("group", { name: "ラベルで絞り込む" }).getByText("消える"),
    ).toBeVisible();

    await page.getByRole("navigation").first().getByRole("link", { name: "設定" }).click();
    await page.getByRole("button", { name: "ラベル「消える」を削除" }).click();
    await expect(page.getByText("まだラベルがありません")).toBeVisible();

    await page.getByRole("link", { name: "一覧" }).click();
    await expect(page.getByText("残るタスク")).toBeVisible();
    // The filter chip goes with the label, so nothing on the page names it.
    await expect(page.getByRole("main").getByText("消える")).toBeHidden();
  });

  test("refuses a second label with the same name, and says so", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Duplicated");
    await openProject(page, "Duplicated");

    await addLabel(page, "重複");

    await page.getByLabel("ラベルを追加").fill("重複");
    await page
      .getByRole("form", { name: "新しいラベル" })
      .getByRole("button", { name: "追加" })
      .click();

    await expect(page.getByText("同じ名前が既にある", { exact: false })).toBeVisible();
  });
});
