// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { listTransactionRevisions } from "./api";
import { TransactionHistoryDialog } from "./TransactionHistoryDialog";
import type { TransactionRevisionView, TransactionView } from "./types";

vi.mock("./api", () => ({
  listTransactionRevisions: vi.fn(),
}));

const transaction: TransactionView = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "25.50",
  currency: "PEN",
  businessDate: "2026-10-01",
  timezone: "UTC",
  concept: "Supermercado",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-01T00:00:00.000Z",
  revisionCount: 2,
};

const revisions: TransactionRevisionView[] = [
  {
    id: "rev-1",
    transactionId: "tx-1",
    revisionNumber: 1,
    kind: "revision",
    changes: [
      { field: "concept", previous: "Almuerzo", next: "Almuerzo team" },
      { field: "amount", previous: "10.00", next: "12.50" },
    ],
    occurredAt: "2026-10-02T15:30:00.000Z",
    actor: "dev-user",
  },
  {
    id: "rev-2",
    transactionId: "tx-1",
    revisionNumber: 2,
    kind: "void",
    changes: [],
    occurredAt: "2026-10-03T15:30:00.000Z",
    actor: "dev-user",
  },
];

function renderDialog(tx: TransactionView | null = transaction) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TransactionHistoryDialog transaction={tx} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  vi.mocked(listTransactionRevisions).mockReset();
});

afterEach(cleanup);

describe("TransactionHistoryDialog", () => {
  it("renders nothing and does not fetch when there is no transaction", () => {
    renderDialog(null);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(listTransactionRevisions).not.toHaveBeenCalled();
  });

  it("shows a loading state while revisions are fetched", async () => {
    vi.mocked(listTransactionRevisions).mockReturnValue(new Promise(() => {}));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Historial de revisiones",
    });
    expect(within(dialog).getByText("Cargando…")).toBeTruthy();
    expect(listTransactionRevisions).toHaveBeenCalledWith("tx-1");
  });

  it("renders the revision list with kind, actor, changes and timestamp", async () => {
    vi.mocked(listTransactionRevisions).mockResolvedValue(revisions);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Historial de revisiones",
    });
    expect(await within(dialog).findByText(/#1 revisión/)).toBeTruthy();
    expect(within(dialog).getByText(/#2 anulación/)).toBeTruthy();
    expect(
      within(dialog).getAllByText(/dev-user/).length,
    ).toBeGreaterThan(0);
    // fields.concept → "concepto", fields.amount → "importe"
    expect(
      within(dialog).getByText(/concepto: Almuerzo → Almuerzo team/),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/importe: 10\.00 → 12\.50/),
    ).toBeTruthy();
  });

  it("shows the empty state when there are no revisions", async () => {
    vi.mocked(listTransactionRevisions).mockResolvedValue([]);

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Historial de revisiones",
    });
    expect(
      await within(dialog).findByText(
        "Todavía no hay revisiones registradas.",
      ),
    ).toBeTruthy();
  });

  it("shows the error state when revisions fail to load", async () => {
    vi.mocked(listTransactionRevisions).mockRejectedValue(new Error("boom"));

    renderDialog();

    const dialog = await screen.findByRole("dialog", {
      name: "Historial de revisiones",
    });
    expect(
      await within(dialog).findByText("No se pudieron cargar las revisiones."),
    ).toBeTruthy();
  });
});
