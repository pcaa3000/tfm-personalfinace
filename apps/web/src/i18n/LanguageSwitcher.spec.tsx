// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import i18n from "./index";
import { LanguageSwitcher } from "./LanguageSwitcher";

function pressed(name: string): string | null {
  return screen.getByRole("button", { name }).getAttribute("aria-pressed");
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("es");
});

describe("LanguageSwitcher", () => {
  it("marks the active locale as pressed", () => {
    render(<LanguageSwitcher />);

    expect(pressed("ES")).toBe("true");
    expect(pressed("EN")).toBe("false");
  });

  it("switches to English and persists tfm-locale", async () => {
    render(<LanguageSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(localStorage.getItem("tfm-locale")).toBe("en");
    await waitFor(() => {
      expect(i18n.language).toBe("en");
    });
    expect(pressed("EN")).toBe("true");
    expect(pressed("ES")).toBe("false");
  });

  it("switches back to Spanish", async () => {
    render(<LanguageSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => {
      expect(i18n.language).toBe("en");
    });

    fireEvent.click(screen.getByRole("button", { name: "ES" }));

    expect(localStorage.getItem("tfm-locale")).toBe("es");
    await waitFor(() => {
      expect(i18n.language).toBe("es");
    });
    expect(pressed("ES")).toBe("true");
  });

  it("ignores re-selecting the already active locale", async () => {
    render(<LanguageSwitcher />);

    // Exclusive ToggleButtonGroup reports null when the active value is
    // clicked again; the component must not write or switch on null.
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(i18n.language).toBe("es");
    expect(localStorage.getItem("tfm-locale")).toBeNull();
  });
});
