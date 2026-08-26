import { test as base } from "@playwright/test";

/**
 * Every test gets its own client address.
 *
 * `/api/auth/*` is rate limited by IP, and in local development there is no
 * `CF-Connecting-IP`, so without this every browser in the suite shares one
 * bucket — the tenth sign-up starts failing with 429 and the failures look
 * like application bugs. Sending a distinct address also models reality more
 * closely than one machine impersonating an entire user base.
 *
 * Derived from the test's own name rather than from a counter. A counter is the
 * obvious way to write this and it was, until the addresses were actually
 * measured: Playwright reloads this module partway through a run, so the
 * counter silently restarted and fifteen tests were handed the same address.
 * They then failed with 429 in a cluster, in whichever spec files happened to
 * follow the reset — which reads as "the feature I just added broke the suite"
 * and cost real time twice before the sign-up helper was taught to report the
 * status it actually got.
 *
 * A hash of the title is stable across reloads and across runs, so a collision
 * — if 24 bits ever produce one — is reproducible rather than a new mystery
 * every time.
 */
function addressFor(title: string): string {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;

  // 10/8 is private space, and three octets give sixteen million addresses for
  // a suite of a few dozen tests.
  return `10.${(hash >>> 16) & 0xff}.${(hash >>> 8) & 0xff}.${hash & 0xff}`;
}

export const test = base.extend({
  context: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": addressFor(testInfo.titlePath.join(" > ")) },
    });
    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
