// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("reports navigation (reports-monthly T7)", () => {
  const baseProps = () => ({
    onToggleCollapsed: vi.fn(),
    onOpenManagement: vi.fn(),
    onNavigateList: vi.fn(),
    onNavigateReports: vi.fn(),
  });

  it("marks the reports item current and calls onNavigateReports when active='reports'", () => {
    const props = baseProps();
    render(<Sidebar collapsed={false} active="reports" {...props} />);

    const reports = screen.getByRole("button", { name: "Reportes" });
    expect(reports.getAttribute("aria-current")).toBe("page");

    fireEvent.click(reports);
    expect(props.onNavigateReports).toHaveBeenCalledTimes(1);
  });

  it("keeps the panel item current by default and navigates to reports on click", () => {
    const props = baseProps();
    render(<Sidebar collapsed={false} {...props} />);

    const panel = screen.getByRole("button", { name: "Panel" });
    const reports = screen.getByRole("button", { name: "Reportes" });
    expect(panel.getAttribute("aria-current")).toBe("page");
    expect(reports.getAttribute("aria-current")).toBeNull();

    fireEvent.click(reports);
    expect(props.onNavigateReports).toHaveBeenCalledTimes(1);
  });

  it("hides the management group when onOpenManagement is not provided", () => {
    render(
      <Sidebar
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onNavigateList={vi.fn()}
      />,
    );

    expect(screen.queryByText("Cuentas")).toBeNull();
    expect(screen.queryByText("Gestión")).toBeNull();
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
