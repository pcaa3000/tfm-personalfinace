// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import i18n from "../../i18n";
import {
  persistRailCollapsed,
  railCollapsedPreference,
  Sidebar,
  storedRailCollapsed,
} from "./Sidebar";

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe("railCollapsedPreference (S10)", () => {
  it("returns null when the user never saved a preference", () => {
    expect(railCollapsedPreference()).toBeNull();
  });

  it("returns true/false for the stored '1'/'0' values", () => {
    persistRailCollapsed(true);
    expect(railCollapsedPreference()).toBe(true);
    persistRailCollapsed(false);
    expect(railCollapsedPreference()).toBe(false);
  });

  it("keeps storedRailCollapsed falling back to expanded when unset", () => {
    expect(storedRailCollapsed()).toBe(false);
    persistRailCollapsed(true);
    expect(storedRailCollapsed()).toBe(true);
  });
});

describe("Sidebar rail toggle", () => {
  it("offers 'expand' when collapsed and 'collapse' when expanded", () => {
    const props = {
      onToggleCollapsed: vi.fn(),
      onOpenManagement: vi.fn(),
      onNavigateList: vi.fn(),
    };
    const { rerender } = render(<Sidebar collapsed {...props} />);
    expect(
      screen.getByRole("button", { name: "Expandir menú lateral" }),
    ).toBeTruthy();

    rerender(<Sidebar collapsed={false} {...props} />);
    expect(
      screen.getByRole("button", { name: "Colapsar menú lateral" }),
    ).toBeTruthy();
  });
});
