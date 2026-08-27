import { expect, test } from "./fixtures";
import { openProject, signUp, uniqueKey } from "./helpers";

/** Creates a project through the dialog, filling in more than a name. */
async function createDetailed(
  page: import("@playwright/test").Page,
  values: { name: string; key: string; description?: string; startAt?: string; dueAt?: string },
) {
  await page.getByRole("button", { name: "プロジェクトを追加" }).click();
  await page.getByLabel("プロジェクト名").fill(values.name);
  await page.getByLabel("プロジェクトキー").fill(values.key);
  if (values.description) await page.getByLabel("説明").fill(values.description);
  if (values.startAt) await page.getByLabel("開始日").fill(values.startAt);
  if (values.dueAt) await page.getByLabel("終了日").fill(values.dueAt);
  await page.getByRole("dialog").getByRole("button", { name: "追加" }).click();
}

test.describe("project settings", () => {
  test("a project is created with more than a name", async ({ page }) => {
    await signUp(page);

    await createDetailed(page, {
      name: "Alcyone",
      key: "ALC",
      description: "証明のための場所",
      startAt: "2026-09-01",
      dueAt: "2026-12-31",
    });

    await expect(
      page.getByRole("dialog", { name: "プロジェクトを追加", exact: true }),
    ).toBeHidden();
    await expect(page.getByText("ALC", { exact: true })).toBeVisible();
    await expect(page.getByText("証明のための場所")).toBeVisible();
    await expect(page.getByText("2026-09-01 〜 2026-12-31")).toBeVisible();
  });

  test("the key follows the name until it is typed over", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: "プロジェクトを追加" }).click();
    await page.getByLabel("プロジェクト名").fill("Design System");

    // A suggestion, not a rule.
    await expect(page.getByLabel("プロジェクトキー")).toHaveValue("DESIGNSYST");

    await page.getByLabel("プロジェクトキー").fill("DS");
    await page.getByLabel("プロジェクト名").fill("Design System v2");
    await expect(page.getByLabel("プロジェクトキー")).toHaveValue("DS");
  });

  test("names tasks by the key, which is what people quote", async ({ page }) => {
    await signUp(page);
    const key = uniqueKey();
    await createDetailed(page, { name: "Quoted", key });
    await openProject(page, "Quoted");

    await page.getByRole("button", { name: "タスクを追加" }).click();
    await page.getByLabel("タイトル", { exact: true }).fill("読み上げるタスク");
    await page
      .getByRole("dialog", { name: "タスクを追加" })
      .getByRole("button", { name: "追加" })
      .click();
    await expect(page.getByRole("dialog", { name: "タスクを追加" })).toBeHidden();

    await expect(page.getByText(new RegExp(`^${key}-\\d+$`))).toBeVisible();
  });

  test("refuses a key that is already taken, and says so", async ({ page }) => {
    await signUp(page);
    const key = uniqueKey();

    await createDetailed(page, { name: "First", key });
    await expect(
      page.getByRole("dialog", { name: "プロジェクトを追加", exact: true }),
    ).toBeHidden();

    await createDetailed(page, { name: "Second", key });

    await expect(
      page.getByText("プロジェクトキーが既に使われている", { exact: false }),
    ).toBeVisible();
  });

  test("the key cannot be changed once the project exists", async ({ page }) => {
    // Jira refuses once a project has issues and Backlog advises against it,
    // both because the key is in every reference anyone has written down.
    await signUp(page);
    await createDetailed(page, { name: "Fixed", key: uniqueKey() });
    await openProject(page, "Fixed");
    await page.getByRole("navigation").first().getByRole("link", { name: "設定" }).click();

    await page.getByRole("button", { name: "設定を編集" }).click();
    await expect(page.getByLabel("プロジェクトキー")).toBeDisabled();
  });

  test("archiving takes a project off the dashboard without deleting it", async ({ page }) => {
    await signUp(page);
    await createDetailed(page, { name: "Finished", key: uniqueKey() });
    await createDetailed(page, { name: "Ongoing", key: uniqueKey() });

    await page.getByRole("button", { name: 'Actions for "Finished"' }).click();
    await page.getByRole("menuitem", { name: "アーカイブする" }).click();

    await expect(page.getByRole("main").getByRole("link", { name: "Finished" })).toBeHidden();
    await expect(page.getByRole("main").getByRole("link", { name: "Ongoing" })).toBeVisible();

    // Finished, not gone: one link away, and the link is in the URL.
    await page.getByRole("link", { name: "アーカイブを見る" }).click();
    await expect(page).toHaveURL(/archived=true/);
    await expect(page.getByRole("main").getByRole("link", { name: "Finished" })).toBeVisible();

    await page.getByRole("button", { name: 'Actions for "Finished"' }).click();
    await page.getByRole("menuitem", { name: "アーカイブから戻す" }).click();
    await expect(page.getByRole("main").getByRole("link", { name: "Finished" })).toBeHidden();
  });

  test("editing the settings keeps them", async ({ page }) => {
    await signUp(page);
    await createDetailed(page, { name: "Editable", key: uniqueKey() });
    await openProject(page, "Editable");
    await page.getByRole("navigation").first().getByRole("link", { name: "設定" }).click();

    await page.getByRole("button", { name: "設定を編集" }).click();
    await page.getByLabel("説明").fill("あとから書いた説明");
    await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "プロジェクトの設定" })).toBeHidden();

    await expect(page.getByText("あとから書いた説明")).toBeVisible();
  });
});
