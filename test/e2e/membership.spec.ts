import { expect, test } from "./fixtures";
import { createProject, createTodo, currentUserId, signUp, uniqueEmail } from "./helpers";

const sidebar = (page: import("@playwright/test").Page) => page.getByRole("navigation").first();

test.describe("sidebar", () => {
  test("offers the views only while a project is open", async ({ page }) => {
    await signUp(page);

    // Nothing to switch the view of yet.
    await expect(sidebar(page).getByRole("link", { name: "ボード" })).toBeHidden();

    await createProject(page, "Sidebar");
    await page.getByRole("link", { name: "Sidebar" }).click();

    await expect(sidebar(page).getByRole("link", { name: "一覧" })).toBeVisible();
    await sidebar(page).getByRole("link", { name: "ボード" }).click();
    await expect(page).toHaveURL(/view=board/);

    await sidebar(page).getByRole("link", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/view=timeline/);
  });

  test("keeps the filter when the view changes", async ({ page }) => {
    // Switching where you are must not throw away how you narrowed it.
    await signUp(page);
    await createProject(page, "Sidebar");
    await page.getByRole("link", { name: "Sidebar" }).click();
    await createTodo(page, "なにか");

    await page.getByRole("button", { name: "未完了" }).click();
    await expect(page).toHaveURL(/status=active/);

    await sidebar(page).getByRole("link", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/status=active/);
    await expect(page).toHaveURL(/view=timeline/);
  });
});

test.describe("project members", () => {
  test("an owner without the directory cannot invite anyone", async ({ page }) => {
    // The list of accounts is an administrator's to see. Without it there is
    // nobody to pick, and the screen says so rather than offering an empty box.
    await signUp(page);
    await createProject(page, "Alone");
    await page.getByRole("link", { name: "Alone" }).click();
    await sidebar(page).getByRole("link", { name: "設定" }).click();

    await expect(page.getByText("まだ誰も参加していません", { exact: false })).toBeVisible();
    await expect(page.getByText("追加できるユーザーがいません", { exact: false })).toBeVisible();
  });

  test("a member sees the project but cannot change who is on it", async ({ browser, page }) => {
    const guestEmail = uniqueEmail("guest");

    const guestContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.21" },
    });
    const guest = await guestContext.newPage();
    await signUp(guest, guestEmail);
    const guestId = await currentUserId(guest);

    await signUp(page);
    await createProject(page, "Together");
    await page.getByRole("link", { name: "Together" }).click();
    const projectId = page.url().match(/projects\/(\d+)/)![1];

    // Through the endpoint the settings screen uses. The owner is not an
    // administrator, so they have no directory to pick from — which is a real
    // gap, recorded rather than papered over in the test.
    const added = await page.request.post(`/api/projects/${projectId}/members`, {
      data: { userId: guestId },
    });
    expect(added.status()).toBe(201);

    // The guest can now reach a project that was invisible a moment ago.
    await guest.goto("/");
    await expect(guest.getByRole("link", { name: "Together" })).toBeVisible();

    await guest.goto(`/projects/${projectId}/settings`);
    await expect(guest.getByText("参加者を変更できるのは", { exact: false })).toBeVisible();
    // The server says who may manage; the client does not re-derive the rule,
    // which is how a UI ends up offering a button the API refuses.
    await expect(guest.getByRole("button", { name: "追加" })).toBeHidden();

    await guestContext.close();
  });
});
