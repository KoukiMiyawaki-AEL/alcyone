import { test as base } from "@playwright/test";

let ipCounter = 0;

/**
 * Every test gets its own client address.
 *
 * `/api/auth/*` is rate limited by IP, and in local development there is no
 * `CF-Connecting-IP`, so without this every browser in the suite shares one
 * bucket — the tenth sign-up starts failing with 429 and the failures look
 * like application bugs. Sending a distinct address also models reality more
 * closely than one machine impersonating an entire user base.
 */
export const test = base.extend({
  context: async ({ browser }, use) => {
    ipCounter += 1;
    const context = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": `203.0.113.${ipCounter % 254}` },
    });
    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
