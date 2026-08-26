import { expect, test } from "./fixtures";
import {
  ADMIN_EMAIL,
  createProject,
  createTodo,
  currentUserId,
  openProject,
  signIn,
  signUp,
  switchProject,
  uniqueEmail,
} from "./helpers";

const sidebar = (page: import("@playwright/test").Page) => page.getByRole("navigation").first();

test.describe("sidebar", () => {
  test("offers the views only while a project is open", async ({ page }) => {
    await signUp(page);

    // Nothing to switch the view of yet.
    await expect(sidebar(page).getByRole("link", { name: "ボード", exact: true })).toBeHidden();

    await createProject(page, "Sidebar");
    await openProject(page, "Sidebar");

    await expect(sidebar(page).getByRole("link", { name: "一覧" })).toBeVisible();
    await sidebar(page).getByRole("link", { name: "ボード", exact: true }).click();
    await expect(page).toHaveURL(/view=board/);

    await sidebar(page).getByRole("link", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/view=timeline/);
  });

  test("switches between projects from the header, not the sidebar", async ({ page }) => {
    // The sidebar answers "what can I do here". Which project "here" is comes
    // from the switcher above it — a project is the context, not one of the
    // things inside it.
    await signUp(page);
    await createProject(page, "Ichi");
    await createProject(page, "Ni");

    await openProject(page, "Ichi");
    await expect(page.getByRole("heading", { level: 1, name: "Ichi" })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Ni" })).toBeHidden();

    await switchProject(page, "Ni");
    await expect(page.getByRole("heading", { level: 1, name: "Ni" })).toBeVisible();
  });

  test("does not carry one project's filter into another", async ({ page }) => {
    // The filter belongs to the project being left. Carried across, it hides
    // rows in the one being entered, silently.
    await signUp(page);
    await createProject(page, "Ichi");
    await createProject(page, "Ni");

    await openProject(page, "Ichi");
    await page.getByRole("button", { name: "未完了" }).click();
    await expect(page).toHaveURL(/status=active/);

    await switchProject(page, "Ni");
    await expect(page).not.toHaveURL(/status=active/);
  });

  test("keeps the filter when the view changes", async ({ page }) => {
    // Switching where you are must not throw away how you narrowed it.
    await signUp(page);
    await createProject(page, "Sidebar");
    await openProject(page, "Sidebar");
    await createTodo(page, "なにか");

    await page.getByRole("button", { name: "未完了" }).click();
    await expect(page).toHaveURL(/status=active/);

    await sidebar(page).getByRole("link", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/status=active/);
    await expect(page).toHaveURL(/view=timeline/);
  });
});

test.describe("project members", () => {
  test("an owner invites by address, without any directory", async ({ browser, page }) => {
    // The list of accounts is an administrator's to see, so an owner has no
    // list to pick from. They do know the address, which is the whole point of
    // this route existing.
    const guestEmail = uniqueEmail("invited");
    const guestContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.31" },
    });
    const guest = await guestContext.newPage();
    await signUp(guest, guestEmail);

    await signUp(page);
    await createProject(page, "Alone");
    await openProject(page, "Alone");
    await sidebar(page).getByRole("link", { name: "設定" }).click();

    await expect(page.getByText("まだ誰も参加していません", { exact: false })).toBeVisible();
    // No picker for an owner: there is nothing they are allowed to list.
    await expect(page.getByLabel("一覧から追加")).toBeHidden();

    await page.getByLabel("メールアドレスで追加").fill(guestEmail);
    await page.getByRole("button", { name: "追加", exact: true }).click();

    await expect(page.getByText(guestEmail)).toBeVisible();

    await guest.goto("/");
    await expect(guest.getByRole("main").getByRole("link", { name: "Alone" })).toBeVisible();

    await guestContext.close();
  });

  test("an address with no account is refused, and says so", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Alone");
    await openProject(page, "Alone");
    await sidebar(page).getByRole("link", { name: "設定" }).click();

    await page.getByLabel("メールアドレスで追加").fill("nobody@example.com");
    await page.getByRole("button", { name: "追加", exact: true }).click();

    await expect(page.getByText("見つかりませんでした", { exact: false })).toBeVisible();
    await expect(page.getByText("まだ誰も参加していません", { exact: false })).toBeVisible();
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
    await openProject(page, "Together");
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
    await expect(guest.getByRole("main").getByRole("link", { name: "Together" })).toBeVisible();

    await guest.goto(`/projects/${projectId}/settings`);
    await expect(guest.getByText("参加者を変更できるのは", { exact: false })).toBeVisible();
    // The server says who may manage; the client does not re-derive the rule,
    // which is how a UI ends up offering a button the API refuses.
    await expect(guest.getByRole("button", { name: "追加" })).toBeHidden();

    await guestContext.close();
  });
});

test.describe("administrators", () => {
  test("an ordinary account is not offered the screen and cannot reach it", async ({ page }) => {
    await signUp(page);

    await expect(sidebar(page).getByRole("link", { name: "ユーザー管理" })).toBeHidden();

    await page.goto("/admin");
    // Told, not bounced. The server refuses the data either way; the screen
    // exists so a member who typed the URL is not left reading a blank list.
    await expect(page.getByText("権限がありません")).toBeVisible();
  });

  test("the first account holds the role and can pass it on", async ({ browser, page }) => {
    // The warm-up created it before any test ran, because the first account to
    // exist is the administrator.
    const memberEmail = uniqueEmail("promoted");
    const memberContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.41" },
    });
    const member = await memberContext.newPage();
    await signUp(member, memberEmail);

    await signIn(page, ADMIN_EMAIL);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

    await sidebar(page).getByRole("link", { name: "ユーザー管理" }).click();
    const row = page.getByRole("listitem").filter({ hasText: memberEmail });
    await expect(row.getByText("一般")).toBeVisible();

    await row.getByRole("button", { name: "管理者にする" }).click();
    await expect(row.getByText("管理者")).toBeVisible();

    // And the newly promoted account now sees the screen for itself.
    await member.reload();
    await expect(sidebar(member).getByRole("link", { name: "ユーザー管理" })).toBeVisible();

    // Put it back, so the run does not leave two administrators behind for
    // whichever spec happens to look at the directory next.
    await row.getByRole("button", { name: "管理者を解除" }).click();
    await expect(row.getByText("一般")).toBeVisible();

    await memberContext.close();
  });
});
