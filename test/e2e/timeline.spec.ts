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
    await expect(page.getByRole("dialog")).toBeHidden();
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
    // Wait for it to actually close: clicking on while it is still dismissing
    // lets the close land on the dialog opened next, which shuts it again.
    await expect(page.getByRole("dialog")).toBeHidden();

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();
    await page.getByRole("button", { name: "編集する" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("期限日")).toHaveValue("2026-11-20");
  });
});

/**
 * Dates relative to the browser's own clock.
 *
 * A fixed date would put the bar months from the axis origin — which starts at
 * today — and thousands of pixels off-screen, where a pointer cannot reach it.
 * It would also rot the day the calendar passes it.
 */
function daysFromToday(offset: number): string {
  const today = new Date();
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offset))
    .toISOString()
    .slice(0, 10);
}

async function scheduleTask(
  page: import("@playwright/test").Page,
  title: string,
  startAt: string,
  dueAt: string,
) {
  await page.getByLabel("新しいタスクのタイトル").fill(title);
  await page.getByRole("button", { name: "詳細を設定して追加" }).click();
  await page.getByLabel("開始日").fill(startAt);
  await page.getByLabel("期限日").fill(dueAt);
  await page.getByRole("dialog").getByRole("button", { name: "追加" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Drags a bar by whole day columns, scrolling it into reach first. */
async function dragBar(page: import("@playwright/test").Page, title: string, days: number) {
  const bar = page.locator(`[title*="${title}"]`).first();
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  // 26px per column, matching DAY_WIDTH.
  await page.mouse.move(box.x + box.width / 2 + days * 26, y, { steps: 6 });
  await page.mouse.up();
}

test.describe("rescheduling on the chart", () => {
  test("dragging a bar moves both dates and keeps the duration", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await page.getByRole("link", { name: "Schedule" }).click();

    const from = daysFromToday(2);
    const to = daysFromToday(4);
    await scheduleTask(page, "動かす予定", from, to);

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();
    await dragBar(page, from, 2);

    // The bar's own label is the signal that the write landed and the list
    // refetched. Opening the dialog first would read the snapshot it was given
    // at click time, which is deliberately not live.
    //
    // Waited on the new *due* date: the new start date is the old due date, so
    // it was already on screen before the drag and would pass instantly.
    await expect(page.locator(`[title*="${daysFromToday(6)}"]`).first()).toBeVisible();

    await page.getByRole("button", { name: "動かす予定" }).click();
    await expect(page.getByLabel("開始日")).toHaveValue(daysFromToday(4));
    await expect(page.getByLabel("期限日")).toHaveValue(daysFromToday(6));
  });

  test("a click that does not move changes nothing", async ({ page }) => {
    // It would churn `updatedAt` and tell every other tab to refetch for a
    // change that did not happen.
    await signUp(page);
    await createProject(page, "Schedule");
    await page.getByRole("link", { name: "Schedule" }).click();

    const from = daysFromToday(2);
    await scheduleTask(page, "触るだけ", from, daysFromToday(4));

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();
    await dragBar(page, from, 0);

    await page.getByRole("button", { name: "触るだけ" }).click();
    await expect(page.getByLabel("開始日")).toHaveValue(from);
    await expect(page.getByText("→")).toBeHidden();
  });

  test("dragging an edge moves only that end", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await page.getByRole("link", { name: "Schedule" }).click();

    const from = daysFromToday(2);
    await scheduleTask(page, "伸ばす予定", from, daysFromToday(4));

    await viewSwitch(page).getByRole("button", { name: "タイムライン" }).click();

    const bar = page.locator(`[title*="${from}"]`).first();
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const y = box.y + box.height / 2;

    // The right-hand edge, which resizes rather than moves.
    await page.mouse.move(box.x + box.width - 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2 + 2 * 26, y, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator(`[title*="${daysFromToday(6)}"]`).first()).toBeVisible();

    await page.getByRole("button", { name: "伸ばす予定" }).click();
    await expect(page.getByLabel("開始日")).toHaveValue(from);
    await expect(page.getByLabel("期限日")).toHaveValue(daysFromToday(6));
  });
});
