import { expect, test } from "./fixtures";
import {
  ADMIN_EMAIL,
  createProject,
  createTodo,
  currentUserId,
  openProject,
  PASSWORD,
  signIn,
  signUp,
  signUpAdmin,
  switchProject,
  uniqueEmail,
} from "./helpers";

const sidebar = (page: import("@playwright/test").Page) => page.getByRole("navigation").first();
const memberForm = (page: import("@playwright/test").Page) =>
  page.getByRole("form", { name: "参加者を追加" });

test.describe("sidebar", () => {
  test("offers the views only while a project is open", async ({ page }) => {
    await signUpAdmin(page);

    // Nothing to switch the view of yet.
    await expect(sidebar(page).getByRole("link", { name: "ボード", exact: true })).toBeHidden();

    await createProject(page, "Sidebar 1");
    await openProject(page, "Sidebar 1");

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
    await signUpAdmin(page);
    await createProject(page, "Ichi 1");
    await createProject(page, "Ni 1");

    await openProject(page, "Ichi 1");
    await expect(page.getByRole("heading", { level: 1, name: "Ichi 1" })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Ni 1" })).toBeHidden();

    await switchProject(page, "Ni 1");
    await expect(page.getByRole("heading", { level: 1, name: "Ni 1" })).toBeVisible();
  });

  test("does not carry one project's filter into another", async ({ page }) => {
    // The filter belongs to the project being left. Carried across, it hides
    // rows in the one being entered, silently.
    await signUpAdmin(page);
    await createProject(page, "Ichi 2");
    await createProject(page, "Ni 2");

    await openProject(page, "Ichi 2");
    await page.getByRole("button", { name: "未完了" }).click();
    await expect(page).toHaveURL(/status=active/);

    await switchProject(page, "Ni 2");
    await expect(page).not.toHaveURL(/status=active/);
  });

  test("keeps the filter when the view changes", async ({ page }) => {
    // Switching where you are must not throw away how you narrowed it.
    await signUpAdmin(page);
    await createProject(page, "Sidebar 2");
    await openProject(page, "Sidebar 2");
    await createTodo(page, "なにか");

    await page.getByRole("button", { name: "未完了" }).click();
    await expect(page).toHaveURL(/status=active/);

    await sidebar(page).getByRole("link", { name: "タイムライン" }).click();
    await expect(page).toHaveURL(/status=active/);
    await expect(page).toHaveURL(/view=timeline/);
  });
});

test.describe("project members", () => {
  test("an owner invites by address", async ({ browser, page }) => {
    // Adding by address, rather than by picking from the directory. It stopped
    // being the only way an owner *could* invite when creating a project became
    // an administrator's act (ADR 0039) — every project's creator can read the
    // directory now — but typing an address you already know is still the
    // shorter path, and it is the one this covers.
    const guestEmail = uniqueEmail("invited");
    const guestContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.31" },
    });
    const guest = await guestContext.newPage();
    await signUp(guest, guestEmail);

    await signUpAdmin(page);
    await createProject(page, "Alone 1");
    await openProject(page, "Alone 1");
    await sidebar(page).getByRole("link", { name: "設定" }).click();

    await expect(page.getByText("まだ誰も参加していません", { exact: false })).toBeVisible();

    await page.getByLabel("メールアドレスで追加").fill(guestEmail);
    await memberForm(page).getByRole("button", { name: "追加", exact: true }).click();

    await expect(page.getByText(guestEmail)).toBeVisible();

    await guest.goto("/");
    await expect(guest.getByRole("main").getByRole("link", { name: "Alone 1" })).toBeVisible();

    await guestContext.close();
  });

  test("an address with no account is refused, and says so", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Alone 2");
    await openProject(page, "Alone 2");
    await sidebar(page).getByRole("link", { name: "設定" }).click();

    await page.getByLabel("メールアドレスで追加").fill("nobody@example.com");
    await memberForm(page).getByRole("button", { name: "追加", exact: true }).click();

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

    await signUpAdmin(page);
    await createProject(page, "Together");
    await openProject(page, "Together");
    const projectId = page.url().match(/projects\/(\d+)/)![1];

    await sidebar(page).getByRole("link", { name: "設定" }).click();
    await page.getByLabel("メールアドレスで追加").fill(guestEmail);
    await memberForm(page).getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText(guestEmail)).toBeVisible();

    // The guest can now reach a project that was invisible a moment ago.
    await guest.goto("/");
    await expect(guest.getByRole("main").getByRole("link", { name: "Together" })).toBeVisible();

    await guest.goto(`/projects/${projectId}/settings`);
    await expect(guest.getByText("参加者を変更できるのは", { exact: false })).toBeVisible();
    // The server says who may manage; the client does not re-derive the rule,
    // which is how a UI ends up offering a button the API refuses.
    //
    // Scoped to the members form: the labels card on the same screen is a
    // member's to use, deliberately — organising the work is not the same
    // permission as handing out access to it.
    await expect(memberForm(guest)).toBeHidden();

    await guestContext.close();
  });

  test("removing someone takes their assignments with them", async ({ browser, page }) => {
    // A task assigned to somebody who can no longer open it is a task nobody is
    // doing, displayed as one that somebody is.
    const guestEmail = uniqueEmail("assigned");
    const guestContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.61" },
    });
    const guest = await guestContext.newPage();
    await signUp(guest, guestEmail, "外れる人");

    await signUpAdmin(page);
    await createProject(page, "Handover");
    await openProject(page, "Handover");
    await createTodo(page, "誰かの仕事");

    await sidebar(page).getByRole("link", { name: "設定" }).click();
    await page.getByLabel("メールアドレスで追加").fill(guestEmail);
    await memberForm(page).getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText(guestEmail)).toBeVisible();

    await sidebar(page).getByRole("link", { name: "一覧" }).click();
    await page.getByRole("button", { name: "「誰かの仕事」の操作" }).click();
    await page.getByRole("menuitem", { name: "詳細を編集" }).click();
    await page.getByRole("combobox", { name: "担当者" }).click();
    await page.getByRole("option", { name: "外れる人" }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("dialog", { name: "タスクの詳細" })).toBeHidden();
    await expect(page.getByLabel(/^担当:/)).toBeVisible();

    await sidebar(page).getByRole("link", { name: "設定" }).click();
    await page.getByRole("button", { name: /を解除$/ }).click();
    await expect(page.getByText("まだ誰も参加していません")).toBeVisible();

    await sidebar(page).getByRole("link", { name: "一覧" }).click();
    await expect(page.getByText("誰かの仕事")).toBeVisible();
    await expect(page.getByLabel(/^担当:/)).toBeHidden();

    await guestContext.close();
  });

  test("names the creator rather than calling them a role with no name", async ({ page }) => {
    await signUpAdmin(page);
    await createProject(page, "Named");
    await openProject(page, "Named");
    await sidebar(page).getByRole("link", { name: "設定" }).click();

    // Everyone else on this screen is listed by name; the one person who cannot
    // be removed should not be the exception.
    await expect(page.getByText("作成者")).toBeVisible();
    await expect(page.getByRole("main").getByText("E2E user")).toBeVisible();
  });
});

test.describe("administrators", () => {
  test("sees a project they are not on, but cannot change who is", async ({ browser, page }) => {
    // Seeing is the wide scope and managing is the narrow one. An
    // administrator has to be able to find the project they were asked about,
    // and being handed the role is not the same as being handed the project.
    //
    // A real administrator, not the warm-up account: that one is the *owner*,
    // which administers the whole system and would pass this test for the
    // wrong reason.
    const theirContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.71" },
    });
    const them = await theirContext.newPage();
    await signUpAdmin(them, uniqueEmail("stranger"));
    await createProject(them, "Not the admin's");
    await openProject(them, "Not the admin's");
    const projectId = them.url().match(/projects\/(\d+)/)![1];

    const adminContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.72" },
    });
    const theAdmin = await adminContext.newPage();
    await signUp(theAdmin, uniqueEmail("real-admin"));
    const adminId = await currentUserId(theAdmin);

    await signIn(page, ADMIN_EMAIL);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const promoted = await page.request.patch(`/api/users/${adminId}/role`, {
      data: { role: "admin" },
    });
    expect(promoted.status()).toBe(204);

    await theAdmin.goto(`/projects/${projectId}`);
    await expect(
      theAdmin.getByRole("heading", { level: 1, name: "Not the admin's" }),
    ).toBeVisible();

    await theAdmin.goto(`/projects/${projectId}/settings`);
    await expect(theAdmin.getByText("参加者を変更できるのは", { exact: false })).toBeVisible();
    await expect(memberForm(theAdmin)).toBeHidden();

    // Put the role back, so a later spec reading the directory does not find an
    // administrator it did not make.
    await page.request.patch(`/api/users/${adminId}/role`, { data: { role: "member" } });

    await adminContext.close();
    await theirContext.close();
  });

  test("an ordinary account is not offered the screen and cannot reach it", async ({ page }) => {
    await signUp(page);

    await expect(sidebar(page).getByRole("link", { name: "ユーザー管理" })).toBeHidden();

    await page.goto("/admin");
    // Told, not bounced. The server refuses the data either way; the screen
    // exists so a member who typed the URL is not left reading a blank list.
    await expect(page.getByText("権限がありません")).toBeVisible();
  });

  test("the first account is the owner and can pass the role on", async ({ browser, page }) => {
    // The warm-up created it before any test ran, because the first account to
    // exist is the owner.
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

    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "管理者" }).click();
    await expect(row.getByRole("combobox")).toContainText("管理者");

    // And the newly promoted account now sees the screen for itself.
    await member.reload();
    await expect(sidebar(member).getByRole("link", { name: "ユーザー管理" })).toBeVisible();

    // Put it back, so the run does not leave an extra administrator behind for
    // whichever spec happens to look at the directory next.
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "ユーザー" }).click();
    await expect(row.getByRole("combobox")).toContainText("ユーザー");

    await memberContext.close();
  });

  test("the owner is the only role that cannot be taken away", async ({ page }) => {
    // The role can only be granted by someone who holds it, so an installation
    // with none has no way back.
    await signIn(page, ADMIN_EMAIL);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

    await sidebar(page).getByRole("link", { name: "ユーザー管理" }).click();
    const own = page.getByRole("listitem").filter({ hasText: ADMIN_EMAIL });

    await expect(own.getByText("オーナー")).toBeVisible();
    await expect(own.getByRole("combobox")).toBeHidden();
  });

  test("an owner creates an account with a role already on it", async ({ browser, page }) => {
    const created = uniqueEmail("created");

    await signIn(page, ADMIN_EMAIL);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await sidebar(page).getByRole("link", { name: "ユーザー管理" }).click();

    await page.getByLabel("名前").fill("作られた人");
    await page.getByLabel("メールアドレス").fill(created);
    await page.getByLabel("初期パスワード").fill(PASSWORD);
    // Exact: every row below has a "<name> の権限" select of its own.
    await page.getByLabel("権限", { exact: true }).click();
    await page.getByRole("option", { name: "管理者" }).click();
    await page.getByRole("button", { name: "追加" }).click();

    const row = page.getByRole("listitem").filter({ hasText: created });
    await expect(row).toBeVisible();
    await expect(row.getByRole("combobox")).toContainText("管理者");

    // The point of setting a password rather than sending an invitation: the
    // account can actually be signed in to.
    const theirs = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.51" },
    });
    const them = await theirs.newPage();
    await signIn(them, created);
    await expect(them.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await theirs.close();

    // And the caller is still themselves, not the account they just made.
    await expect(page.getByRole("button", { name: /^アカウント: Warm up/ })).toBeVisible();
  });
});
