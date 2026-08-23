import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModeToggle } from "@/components/app/mode-toggle";
import { ThemeProvider } from "@/components/app/theme-provider";

const STORAGE_KEY = "alcyone-ui-theme";

/** Point the stubbed matchMedia at a given system preference. */
function setSystemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: dark && query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderToggle() {
  return render(
    <ThemeProvider defaultTheme="system" storageKey={STORAGE_KEY}>
      <ModeToggle />
    </ThemeProvider>,
  );
}

async function pick(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Toggle theme" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: label }));
}

describe("ThemeProvider / ModeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    setSystemPrefersDark(false);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  it("follows the system preference when no theme is stored", () => {
    setSystemPrefersDark(true);
    renderToggle();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");
  });

  it("restores the stored theme over the system preference", () => {
    setSystemPrefersDark(true);
    localStorage.setItem(STORAGE_KEY, "light");
    renderToggle();

    expect(document.documentElement).toHaveClass("light");
  });

  it("persists the picked theme and swaps the root class", async () => {
    renderToggle();
    expect(document.documentElement).toHaveClass("light");

    await pick("Dark");

    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    // Both classes must never be present at once, or the tokens fight.
    expect(document.documentElement).not.toHaveClass("light");
  });

  it("goes back to the system preference when System is picked", async () => {
    localStorage.setItem(STORAGE_KEY, "light");
    setSystemPrefersDark(true);
    renderToggle();

    await pick("System");

    expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
    expect(document.documentElement).toHaveClass("dark");
  });
});
