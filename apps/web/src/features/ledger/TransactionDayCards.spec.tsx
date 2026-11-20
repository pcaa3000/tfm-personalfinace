// @vitest-environment jsdom
import { ThemeProvider } from "@mui/material/styles";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { buildAppTheme } from "../../theme";
import { getReceiptFile } from "./api";
import { TransactionDayCards } from "./TransactionDayCards";
import type { LedgerRow } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getReceiptFile: vi.fn() };
});

/**
 * Raw CSS of every injected rule that targets one of the element's
 * classes (emotion <style> tags — jsdom cannot compute styles from
 * stylesheets, so sx assertions go through the serialized CSS).
 */
function cssTextOf(el: Element): string {
  const classes = [...el.classList];
  let out = "";
  for (const style of document.querySelectorAll("style")) {
    const text = style.textContent ?? "";
    if (classes.some((c) => text.includes(`.${c}`))) out += text;
    const sheet = style.sheet;
    if (sheet) {
      for (const rule of Array.from(sheet.cssRules ?? [])) {
        if (classes.some((c) => rule.cssText.includes(`.${c}`))) {
          out += rule.cssText;
        }
      }
    }
  }
  return out.replace(/\s+/g, "");
}

const accounts = [
  {
    id: "acc-1",
    workspaceId: "ws-1",
    name: "BCP soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
  },
  {
    id: "acc-2",
    workspaceId: "ws-1",
    name: "Efectivo",
    currency: "PEN",
    kind: "cash",
    initialBalance: "0.00",
    archivedAt: null,
  },
];

const baseRow: LedgerRow = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "12.50",
  currency: "PEN",
  businessDate: "2026-10-01",
  timezone: "UTC",
  concept: "almuerzo",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-01T12:00:00Z",
  revisionCount: 0,
    splits: [],
};

beforeAll(async () => {
  await i18n.changeLanguage("es");
  // jsdom has no URL.createObjectURL — stub it for the image viewer.
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:ticket-image"),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe("TransactionDayCards empty state (S1)", () => {
  it("offers a CTA that invokes onNewMovement", () => {
    const onNewMovement = vi.fn();
    render(
      <TransactionDayCards
        transactions={[]}
        categories={[]}
        accounts={[]}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
        onNewMovement={onNewMovement}
      />,
    );
    expect(screen.getByText("Todavía no hay movimientos.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrá tu primer movimiento" }),
    );
    expect(onNewMovement).toHaveBeenCalledTimes(1);
  });
});

describe("ticket origin badge (receipt-review-link T3, S2)", () => {
  it("opens the authenticated image viewer from the ticket badge", async () => {
    vi.mocked(getReceiptFile).mockResolvedValue(new Blob(["img"]));
    render(
      <ThemeProvider theme={buildAppTheme("light")}>
        <TransactionDayCards
          transactions={[
            {
              ...baseRow,
              origin: "ticket",
              originReference: "scan-7",
            },
          ]}
          categories={[]}
          accounts={accounts}
          onEdit={vi.fn()}
          onVoid={vi.fn()}
          onHistory={vi.fn()}
        />
      </ThemeProvider>,
    );

    // L28: the badge no longer links the raw API path (401 without the
    // auth header); it opens the in-app viewer instead.
    const badge = screen.getByRole("button", {
      name: "Ver ticket escaneado",
    });
    expect(
      screen.queryByRole("link", { name: "Ver ticket escaneado" }),
    ).toBeNull();

    fireEvent.click(badge);

    expect(getReceiptFile).toHaveBeenCalledWith("scan-7");
    const viewer = await screen.findByRole("dialog", {
      name: "Imagen del ticket",
    });
    const img = await within(viewer).findByRole("img");
    expect(img.getAttribute("src")).toBe("blob:ticket-image");
  });
});

describe("TransactionDayCards transfer identity (S9)", () => {
  it("renders the icon chip and amount with the transfer palette token", () => {
    const { container } = render(
      <ThemeProvider theme={buildAppTheme("light")}>
        <TransactionDayCards
          transactions={[
            {
              ...baseRow,
              id: "tx-transfer",
              type: "transfer",
              amount: "300.00",
              concept: "Retiro a efectivo",
              destinationAccountId: "acc-2",
            },
          ]}
          categories={[]}
          accounts={accounts}
          onEdit={vi.fn()}
          onVoid={vi.fn()}
          onHistory={vi.fn()}
        />
      </ThemeProvider>,
    );

    const avatar = container.querySelector(".MuiAvatar-root");
    expect(avatar).toBeTruthy();
    expect(cssTextOf(avatar!)).toContain("color:#7c6bad");

    const amount = [...container.querySelectorAll(".MuiTypography-root")].find(
      (el) => el.textContent?.includes("300"),
    );
    expect(amount).toBeTruthy();
    expect(cssTextOf(amount!)).toContain("color:#7c6bad");
  });
});
