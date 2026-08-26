import { expect, test } from "./fixtures";
import { createProject, signUp } from "./helpers";

/**
 * The claim realtime actually makes is "a change in one tab shows up in the
 * other without touching it". Neither vitest project can check that: the worker
 * tests never run a browser, and the component tests never open a socket. Two
 * real pages in one context — sharing the session cookie, so the same user — is
 * the only place the whole path is visible.
 */
test.describe("realtime", () => {
  test("a change in one tab appears in the other", async ({ context }) => {
    const first = await context.newPage();
    await signUp(first);

    const second = await context.newPage();
    await second.goto("/");
    await expect(second.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

    await createProject(first, "Opened elsewhere");

    // No reload, no click on this page. If the socket is not delivering, this
    // times out rather than passing for the wrong reason.
    await expect(second.getByRole("main").getByText("Opened elsewhere")).toBeVisible();
  });

  test("a second user's change does not reach the first", async ({ browser, context }) => {
    const mine = await context.newPage();
    await signUp(mine);
    await createProject(mine, "Mine");

    // A separate context, so a separate session — this is the isolation that
    // matters, and it is worth proving through the browser and not only
    // through the channel's unit test.
    const otherContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "203.0.113.240" },
    });
    const theirs = await otherContext.newPage();
    await signUp(theirs);
    await createProject(theirs, "Theirs");

    await expect(theirs.getByRole("main").getByText("Theirs")).toBeVisible();
    await expect(mine.getByRole("main").getByText("Theirs")).toBeHidden();
    await expect(mine.getByRole("main").getByText("Mine")).toBeVisible();

    await otherContext.close();
  });
});
