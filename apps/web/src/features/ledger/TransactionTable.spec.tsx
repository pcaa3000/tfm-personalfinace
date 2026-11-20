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
import { getReceiptFile, getVoiceFile } from "./api";
import { TransactionTable } from "./TransactionTable";
import type { LedgerRow } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getReceiptFile: vi.fn(), getVoiceFile: vi.fn() };
});

const baseRow: LedgerRow = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "12.50",
  currency: "USD",
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

function renderTable(
  props: Partial<Parameters<typeof TransactionTable>[0]> = {},
) {
  return render(
    <ThemeProvider theme={buildAppTheme("light")}>
      <TransactionTable
        transactions={[baseRow]}
        categories={[]}
        accounts={accounts}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

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

describe("TransactionTable (es)", () => {
  it("renders spanish headers, status and uncategorized label", () => {
    renderTable();
    expect(screen.getByText("Concepto")).toBeTruthy();
    expect(screen.getByText("Cuenta")).toBeTruthy();
    expect(screen.getByText("BCP soles")).toBeTruthy();
    expect(screen.getByText("Sin categorizar")).toBeTruthy();
    expect(screen.getByText("confirmada")).toBeTruthy();
    expect(screen.getByText("Gasto")).toBeTruthy();
    expect(screen.getByText("Editar")).toBeTruthy();
    expect(screen.getByText("Anular")).toBeTruthy();
  });

  it("shows the pending sync chip and disables row actions", () => {
    renderTable({
      transactions: [{ ...baseRow, id: "pending:x", pendingSync: true }],
    });
    expect(screen.getByText("Pendiente de sincronización")).toBeTruthy();
    expect(screen.getByText("Editar")).toHaveProperty("disabled", true);
    expect(screen.getByText("Anular")).toHaveProperty("disabled", true);
  });

  it("renders a transfer with the origin → destination account pair (S12-3)", () => {
    renderTable({
      transactions: [
        {
          ...baseRow,
          id: "tx-transfer",
          type: "transfer",
          concept: "Retiro a efectivo",
          currency: "PEN",
          destinationAccountId: "acc-2",
        },
      ],
    });
    expect(screen.getByText("Transferencia")).toBeTruthy();
    expect(screen.getByText(/BCP soles\s*→\s*Efectivo/)).toBeTruthy();
  });

  it("scrolls horizontally with a 720px min-width instead of compressing columns (S8)", () => {
    renderTable();

    const table = screen.getByRole("table");
    const scroller = table.parentElement;
    expect(scroller).toBeTruthy();
    expect(cssTextOf(scroller!)).toContain("overflow-x:auto");
    expect(cssTextOf(table)).toContain("min-width:720px");
  });

  it("keeps the sticky header offset under the sticky block (S8)", () => {
    const { container } = renderTable();

    const headerRow = container.querySelector("thead tr");
    expect(headerRow).toBeTruthy();
    expect(cssTextOf(headerRow!)).toContain("position:sticky");
  });

  it("renders transfers with the transfer palette token on chip and amount (S9)", () => {
    renderTable({
      transactions: [
        {
          ...baseRow,
          id: "tx-transfer",
          type: "transfer",
          amount: "300.00",
          currency: "PEN",
          concept: "Retiro a efectivo",
          destinationAccountId: "acc-2",
        },
      ],
    });

    const chip = screen.getByText("Transferencia").closest(".MuiChip-root");
    expect(chip?.className).toContain("MuiChip-colorTransfer");
    const amountCell = screen.getByText("300.00 PEN");
    expect(cssTextOf(amountCell)).toContain("color:#7c6bad");
  });

  it("empty state offers a CTA that invokes onNewMovement (S1)", () => {
    const onNewMovement = vi.fn();
    renderTable({ transactions: [], onNewMovement });
    expect(screen.getByText("Todavía no hay movimientos.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrá tu primer movimiento" }),
    );
    expect(onNewMovement).toHaveBeenCalledTimes(1);
  });

  it("shows 'Sin cuenta' for a transaction without account", () => {
    renderTable({ transactions: [{ ...baseRow, accountId: null }] });
    expect(screen.getByText("Sin cuenta")).toBeTruthy();
  });

  it("opens the authenticated image viewer from the ticket badge (receipt-review-link T3+T6, S2+L28)", async () => {
    vi.mocked(getReceiptFile).mockResolvedValue(new Blob(["img"]));
    renderTable({
      transactions: [
        {
          ...baseRow,
          origin: "ticket",
          originReference: "scan-9",
          concept: "Voucher",
        },
      ],
    });

    // L28: the badge no longer links the raw API path (401 without the
    // auth header); it opens the in-app viewer instead.
    const badge = screen.getByRole("button", {
      name: "Ver ticket escaneado",
    });
    expect(
      screen.queryByRole("link", { name: "Ver ticket escaneado" }),
    ).toBeNull();

    fireEvent.click(badge);

    expect(getReceiptFile).toHaveBeenCalledWith("scan-9");
    const viewer = await screen.findByRole("dialog", {
      name: "Imagen del ticket",
    });
    const img = await within(viewer).findByRole("img");
    expect(img.getAttribute("src")).toBe("blob:ticket-image");
  });

  it("shows no ticket badge for manual origin and the voice badge for voice origin (voice-drafts T4)", () => {
    renderTable({
      transactions: [
        { ...baseRow, id: "tx-manual", origin: "manual", concept: "manual" },
        { ...baseRow, id: "tx-voice", origin: "voice", concept: "dictado" },
      ],
    });

    expect(
      screen.queryByRole("button", { name: "Ver ticket escaneado" }),
    ).toBeNull();
    expect(screen.queryByText("ticket")).toBeNull();
    expect(screen.getByText("voz")).toBeTruthy();
  });

  it("opens the authenticated audio player from the voice badge (voice-drafts T4)", async () => {
    vi.mocked(getVoiceFile).mockResolvedValue(
      new Blob(["audio"], { type: "audio/webm" }),
    );
    renderTable({
      transactions: [
        {
          ...baseRow,
          origin: "voice",
          originReference: "vn-9",
          concept: "Dictado",
        },
      ],
    });

    const badge = screen.getByRole("button", {
      name: "Escuchar nota de voz",
    });
    expect(
      screen.queryByRole("link", { name: "Escuchar nota de voz" }),
    ).toBeNull();

    fireEvent.click(badge);

    expect(getVoiceFile).toHaveBeenCalledWith("vn-9");
    await screen.findByRole("dialog", {
      name: "Audio de la nota de voz",
    });
  });

  it("keeps the badge without a link when originReference is missing (receipt-review-link T3, S2)", () => {
    renderTable({
      transactions: [
        { ...baseRow, origin: "ticket", originReference: null },
      ],
    });

    expect(screen.getByText("ticket")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Ver ticket escaneado" }),
    ).toBeNull();
  });

  it("shows the split count when a transaction is divided (receipt-scan-drafts T7)", () => {
    renderTable({
      transactions: [
        {
          ...baseRow,
          splits: [
            { categoryId: "cat-food", amount: "8.50" },
            { categoryId: "cat-home", amount: "4.00" },
          ],
        },
      ],
    });
    expect(screen.getByText("Dividido (2)")).toBeTruthy();
    expect(screen.queryByText("Sin categorizar")).toBeNull();
  });
});
