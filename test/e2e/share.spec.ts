import { expect, test } from "./fixtures";
import { createProject, createTodo, openProject, signUp } from "./helpers";

test.describe("share links", () => {
  test("a signed-out visitor can read a shared project but not edit it", async ({
    context,
    browser,
  }) => {
    const owner = await context.newPage();
    await signUp(owner);
    await createProject(owner, "Shared board");
    await openProject(owner, "Shared board");
    await createTodo(owner, "publicly visible");

    await owner.getByRole("button", { name: /^共有/ }).click();
    await owner.getByRole("button", { name: "共有リンクを発行" }).click();
    const url = await owner.getByLabel("共有リンクのURL").inputValue();
    expect(url).toContain("/s/");

    // A separate context with no cookies at all — the point of the feature is
    // that this works without an account, so it must not borrow the owner's.
    const stranger = await browser.newContext();
    const page = await stranger.newPage();
    await page.goto(url);

    await expect(page.getByRole("heading", { level: 1, name: "Shared board" })).toBeVisible();
    await expect(page.getByText("publicly visible")).toBeVisible();
    // Read-only: nothing here should offer a way to change the project.
    await expect(page.getByRole("button", { name: "Add" })).toBeHidden();

    await stranger.close();
  });

  test("revoking the link closes the door", async ({ context, browser }) => {
    const owner = await context.newPage();
    await signUp(owner);
    await createProject(owner, "Temporarily shared");
    await openProject(owner, "Temporarily shared");

    await owner.getByRole("button", { name: /^共有/ }).click();
    await owner.getByRole("button", { name: "共有リンクを発行" }).click();
    const url = await owner.getByLabel("共有リンクのURL").inputValue();

    await owner.getByRole("button", { name: "解除" }).click();
    await expect(owner.getByRole("button", { name: "共有リンクを発行" })).toBeVisible();

    const stranger = await browser.newContext();
    const page = await stranger.newPage();
    await page.goto(url);

    await expect(page.getByText("Page not found")).toBeVisible();

    await stranger.close();
  });
});
