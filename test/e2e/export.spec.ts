import { expect, test } from "./fixtures";
import { createProject, signUp } from "./helpers";

test.describe("data export", () => {
  test("exports the account's data and offers each part for download", async ({ page }) => {
    await signUp(page);
    await createProject(page, "Exported");

    await page.getByRole("button", { name: /Account:/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();

    await page.getByRole("button", { name: "エクスポートを開始" }).click();

    // The workflow runs on its own clock, so this waits rather than asserts
    // immediately — the point is that it finishes at all.
    const projects = page.getByRole("link", { name: /projects\.json/ });
    await expect(projects).toBeVisible({ timeout: 30_000 });
    await expect(projects).toContainText("1 件");

    // A real download, not a router navigation: the response sets
    // Content-Disposition.
    const download = page.waitForEvent("download");
    await projects.click();
    expect((await download).suggestedFilename()).toBe("projects.json");
  });
});
