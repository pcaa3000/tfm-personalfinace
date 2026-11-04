// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  persistThemeMode,
  resolveThemeMode,
  storedThemeMode,
  THEME_MODE_STORAGE_KEY,
} from "./theme-mode";

function mockPrefersDark(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("theme mode persistence (tfm-theme-mode, S12-7)", () => {
  it("reads a valid stored mode", () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, "dark");
    expect(storedThemeMode()).toBe("dark");

    localStorage.setItem(THEME_MODE_STORAGE_KEY, "light");
    expect(storedThemeMode()).toBe("light");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, "purple");
    expect(storedThemeMode()).toBeNull();
  });

  it("falls back to the OS preference when nothing is stored", () => {
    mockPrefersDark(true);
    expect(resolveThemeMode()).toBe("dark");

    mockPrefersDark(false);
    expect(resolveThemeMode()).toBe("light");
  });

  it("prefers the stored value over the OS preference", () => {
    mockPrefersDark(true);
    localStorage.setItem(THEME_MODE_STORAGE_KEY, "light");
    expect(resolveThemeMode()).toBe("light");
  });

  it("persists the selected mode to tfm-theme-mode", () => {
    persistThemeMode("dark");
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe("dark");
    persistThemeMode("light");
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe("light");
  });
});
