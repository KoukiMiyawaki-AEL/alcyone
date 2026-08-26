import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUp } from "./helpers";

/** The views live in the sidebar now, one addressable link each. */
const viewSwitch = (page: import("@playwright/test").Page) => page.getByRole("navigation").first();

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

test.describe("timeline view", () => {
  test("shows dated tasks on the axis and lists the undated ones", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await openProject(page, "Schedule");

    await scheduleTask(page, "日程のあるタスク", "2026-11-02", "2026-11-06");
    await expect(page.getByText("日程のあるタスク")).toBeVisible();

    await createTodo(page, "日程のないタスク");

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/view=timeline/);

    await expect(page.getByRole("button", { name: "日程のあるタスク" })).toBeVisible();

    // Undated tasks are listed rather than dropped: a view that quietly omits
    // them answers "what is scheduled" while looking like it answered "what is
    // there".
    await expect(page.getByText("日付が未設定のタスク（1件）")).toBeVisible();
    await page.getByText("日付が未設定のタスク（1件）").click();
    await expect(page.getByRole("button", { name: "日程のないタスク" })).toBeVisible();
  });

  test("draws a calendar even before anything is scheduled", async ({ page }) => {
    // The axis is a calendar, not a bounding box around the work: you cannot
    // see that a month is free if the month is not drawn.
    await signUp(page);
    await createProject(page, "Empty");
    await openProject(page, "Empty");
    await createTodo(page, "日付なし");

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();

    const today = daysFromToday(0);
    await expect(page.getByTitle(today)).toBeVisible();
    // Roughly three months of columns, so a plan has somewhere to be made.
    await expect(page.getByTitle(daysFromToday(60))).toBeAttached();
  });

  test("marks today and labels the days, not just the months", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Days");
    await openProject(page, "Days");
    await createTodo(page, "なにか");

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();

    const today = daysFromToday(0);
    const cell = page.getByTitle(today);
    await expect(cell).toHaveText(String(Number(today.slice(8, 10))));
    await expect(page.getByTitle(daysFromToday(1))).toBeAttached();
  });

  test("switches between day and week granularity", async ({ page }) => {
    // A quarter at one column per day is over two thousand pixels — legible,
    // but only through a letterbox.
    await signUp(page);
    await createProject(page, "Zoom");
    await openProject(page, "Zoom");
    await createTodo(page, "なにか");

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();

    const grain = page.getByRole("group", { name: "表示の粒度" });
    const today = daysFromToday(0);
    await expect(page.getByTitle(today)).toBeVisible();

    await grain.getByRole("button", { name: "週" }).click();
    // Week cells start on the axis origin, so most individual days stop having
    // a column of their own — which is the trade the zoom makes.
    //
    // Checked on tomorrow rather than today: the axis opens exactly LEAD_DAYS
    // before today, which puts today on a week boundary every time, so it keeps
    // a cell of its own and would have passed for the wrong reason.
    await expect(page.getByTitle(daysFromToday(1))).toBeHidden();
    await expect(grain.getByRole("button", { name: "週" })).toHaveAttribute("aria-pressed", "true");

    await grain.getByRole("button", { name: "日" }).click();
    await expect(page.getByTitle(daysFromToday(1))).toBeVisible();
  });

  test("says so when no task has a date yet", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await openProject(page, "Schedule");
    await createTodo(page, "日付なし");

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();

    await expect(page.getByText(/日付が設定されたタスクがまだありません/)).toBeVisible();
  });

  test("opens the detail form from a bar", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await openProject(page, "Schedule");

    await scheduleTask(page, "編集する", "2026-11-18", "2026-11-20");

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();
    await page.getByRole("button", { name: "編集する", exact: true }).click();

    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeVisible();
    await expect(page.getByLabel("期限日")).toHaveValue("2026-11-20");
  });
});

async function scheduleTask(
  page: import("@playwright/test").Page,
  title: string,
  startAt: string,
  dueAt: string,
) {
  await page.getByRole("button", { name: "タスクを追加" }).click();
  await page.getByLabel("タイトル", { exact: true }).fill(title);
  await page.getByLabel("開始日").fill(startAt);
  await page.getByLabel("期限日").fill(dueAt);
  await page
    .getByRole("dialog", { name: "タスクを追加" })
    .getByRole("button", { name: "追加" })
    .click();
  await expect(page.getByRole("dialog", { name: "タスクを追加" })).toBeHidden();
}

/** Drags a bar by whole day columns, scrolling it into reach first. */
/** The bar's title is "<status>: <start> 〜 <due>", which no header cell has. */
function barFor(page: import("@playwright/test").Page, startAt: string, dueAt: string) {
  return page.locator(`[title="未着手: ${startAt} 〜 ${dueAt}"]`);
}

async function dragBar(
  page: import("@playwright/test").Page,
  startAt: string,
  dueAt: string,
  days: number,
) {
  const bar = barFor(page, startAt, dueAt);
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
    await openProject(page, "Schedule");

    const from = daysFromToday(2);
    const to = daysFromToday(4);
    await scheduleTask(page, "動かす予定", from, to);

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();
    await dragBar(page, from, to, 2);

    // The bar's own label is the signal that the write landed and the list
    // refetched. Opening the dialog first would read the snapshot it was given
    // at click time, which is deliberately not live.
    //
    // Waited on the new *due* date: the new start date is the old due date, so
    // it was already on screen before the drag and would pass instantly.
    await expect(barFor(page, daysFromToday(4), daysFromToday(6))).toBeVisible();

    await page.getByRole("button", { name: "動かす予定", exact: true }).click();
    await expect(page.getByLabel("開始日")).toHaveValue(daysFromToday(4));
    await expect(page.getByLabel("期限日")).toHaveValue(daysFromToday(6));
  });

  test("a click that does not move changes nothing", async ({ page }) => {
    // It would churn `updatedAt` and tell every other tab to refetch for a
    // change that did not happen.
    await signUp(page);
    await createProject(page, "Schedule");
    await openProject(page, "Schedule");

    const from = daysFromToday(2);
    await scheduleTask(page, "触るだけ", from, daysFromToday(4));

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();
    await dragBar(page, from, daysFromToday(4), 0);

    await page.getByRole("button", { name: "触るだけ", exact: true }).click();
    await expect(page.getByLabel("開始日")).toHaveValue(from);
    await expect(page.getByText("→")).toBeHidden();
  });

  test("shows where the bar would land while it is being dragged", async ({ page }) => {
    // A bar that simply moved would answer "where to" and lose "from where".
    // The ghost is what makes the change legible before it is committed.
    await signUp(page);
    await createProject(page, "Schedule");
    await openProject(page, "Schedule");

    const from = daysFromToday(2);
    const to = daysFromToday(4);
    await scheduleTask(page, "掴む予定", from, to);

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();

    const bar = barFor(page, from, to);
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 3 * 26, y, { steps: 6 });

    // The dates it would get, printed beside the ghost: a rectangle answers
    // "roughly when", and a schedule argument is about exact days.
    await expect(page.getByText(`${daysFromToday(5)} 〜 ${daysFromToday(7)}`)).toBeVisible();
    // And the original is still there, faded, so both ends are visible at once.
    await expect(bar).toBeVisible();

    await page.mouse.up();
  });

  test("dragging an edge moves only that end", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Schedule");
    await openProject(page, "Schedule");

    const from = daysFromToday(2);
    await scheduleTask(page, "伸ばす予定", from, daysFromToday(4));

    await viewSwitch(page).getByRole("link", { name: "タイムライン" }).click();

    const bar = barFor(page, from, daysFromToday(4));
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const y = box.y + box.height / 2;

    // The right-hand edge, which resizes rather than moves.
    await page.mouse.move(box.x + box.width - 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2 + 2 * 26, y, { steps: 6 });
    await page.mouse.up();

    await expect(barFor(page, from, daysFromToday(6))).toBeVisible();

    await page.getByRole("button", { name: "伸ばす予定", exact: true }).click();
    await expect(page.getByLabel("開始日")).toHaveValue(from);
    await expect(page.getByLabel("期限日")).toHaveValue(daysFromToday(6));
  });
});
