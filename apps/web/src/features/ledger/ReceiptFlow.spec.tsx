// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import {
  confirmReceipt,
  getReceiptDraft,
  getReceiptScan,
  rejectReceipt,
  uploadReceipt,
} from "./api";
import type { ReceiptDraftPayload, ReceiptScanView } from "./receipt-draft";
import { ReceiptFlow } from "./ReceiptFlow";
import type { AccountView, CategoryView, TransactionView } from "./types";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    uploadReceipt: vi.fn(),
    getReceiptScan: vi.fn(),
    getReceiptDraft: vi.fn(),
    confirmReceipt: vi.fn(),
    rejectReceipt: vi.fn(),
  };
});

const accounts: AccountView[] = [
  {
    id: "acc-pen",
    workspaceId: "ws-1",
    name: "BCP soles",
    currency: "PEN",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
  },
];

const categories: CategoryView[] = [
  {
    id: "cat-food",
    key: "food",
    label: "Comida",
    nature: "essential",
    custom: false,
  },
];

function scanView(
  status: ReceiptScanView["status"],
  error: string | null = null,
): ReceiptScanView {
  return {
    id: "rc-1",
    workspaceId: "ws-1",
    status,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 5,
    transactionId: null,
    error,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
}

const confirmedTransaction: TransactionView = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "90.00",
  currency: "PEN",
  businessDate: "2026-10-03",
  timezone: "UTC",
  concept: "Plaza Vea",
  accountId: "acc-pen",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "ticket",
  confirmedAt: "2026-10-03T00:00:00.000Z",
  revisionCount: 0,
  splits: [],
};

function draftPayload(overrides: Partial<ReceiptDraftPayload> = {}): ReceiptDraftPayload {
  return {
    merchant: "Plaza Vea",
    concept: "Plaza Vea",
    businessDate: "2026-10-03",
    currency: "PEN",
    totalMinorUnits: 9000,
    totalMismatch: false,
    splits: [
      {
        categoryKey: "food",
        newCategory: null,
        amountMinorUnits: 5000,
        itemCount: 3,
        confidenceAvg: 0.9,
        lowConfidence: false,
      },
      {
        categoryKey: null,
        newCategory: { name: "Cuidado personal", nature: "discretionary" },
        amountMinorUnits: 4000,
        itemCount: 1,
        confidenceAvg: 0.8,
        lowConfidence: false,
      },
    ],
    items: [],
    ...overrides,
  };
}

interface RenderOptions {
  onConfirmed?: (tx: TransactionView) => void;
  onClose?: () => void;
  onCreateCategory?: (
    input: import("./types").CreateCategoryInput,
  ) => Promise<CategoryView>;
}

function renderFlow(options: RenderOptions = {}) {
  const onConfirmed = options.onConfirmed ?? vi.fn();
  const onClose = options.onClose ?? vi.fn();
  render(
    <ReceiptFlow
      categories={categories}
      accounts={accounts}
      defaultCurrency="PEN"
      currencies={["PEN"]}
      timezone="UTC"
      pollIntervalMs={5}
      timeoutMs={5_000}
      onConfirmed={onConfirmed}
      onClose={onClose}
      {...(options.onCreateCategory
        ? { onCreateCategory: options.onCreateCategory }
        : {})}
    />,
  );
  return { onConfirmed, onClose };
}

function pickFile() {
  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"]',
  );
  if (!input) throw new Error("file input not rendered");
  fireEvent.change(input, {
    target: {
      files: [new File(["x"], "ticket.jpg", { type: "image/jpeg" })],
    },
  });
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

beforeEach(() => {
  vi.mocked(uploadReceipt).mockReset();
  vi.mocked(getReceiptScan).mockReset();
  vi.mocked(getReceiptDraft).mockReset();
  vi.mocked(confirmReceipt).mockReset();
  vi.mocked(rejectReceipt).mockReset();
});

afterEach(cleanup);

describe("ReceiptFlow — capture → poll → review (T7, S1+S2+S7+S10)", () => {
  it("uploads the picked image, polls to draft_ready and renders the review", async () => {
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan)
      .mockResolvedValueOnce(scanView("pending"))
      .mockResolvedValueOnce(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());
    renderFlow();

    pickFile();

    await waitFor(() => {
      expect(uploadReceipt).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByLabelText("Concepto"),
    ).toHaveProperty("value", "Plaza Vea");
    // nueva categoría propuesta flaggeada (S10).
    expect(screen.getByText(/nueva: Cuidado personal/i)).toBeTruthy();
    // Total derivado de los splits (read-only).
    expect(screen.getByText(/Total: 90\.00 PEN/)).toBeTruthy();
  });

  it("confirms the draft posting splits + fresh idempotencyKey and notifies the parent", async () => {
    const { onConfirmed } = renderFlow();
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());
    vi.mocked(confirmReceipt).mockResolvedValue({
      transaction: confirmedTransaction,
      createdCategories: [],
    });

    pickFile();
    await screen.findByLabelText("Concepto");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(await screen.findByRole("option", { name: "BCP soles" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Aprobar y registrar" }),
    );

    await waitFor(() => {
      expect(confirmReceipt).toHaveBeenCalledWith(
        "rc-1",
        expect.objectContaining({
          accountId: "acc-pen",
          type: "expense",
          concept: "Plaza Vea",
          businessDate: "2026-10-03",
          currency: "PEN",
          idempotencyKey: expect.any(String),
          splits: [
            {
              categoryId: "cat-food",
              newCategory: null,
              amountMinorUnits: 5000,
            },
            {
              categoryId: null,
              newCategory: {
                name: "Cuidado personal",
                nature: "discretionary",
              },
              amountMinorUnits: 4000,
            },
          ],
        }),
      );
    });
    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalledWith(confirmedTransaction);
    });
  });

  it("shows the totalMismatch warning when items do not sum to the ticket total", async () => {
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(
      getReceiptDraft,
    ).mockResolvedValue(draftPayload({ totalMismatch: true }));
    renderFlow();

    pickFile();

    expect(
      await screen.findByText(/no coincide con el total del ticket/i),
    ).toBeTruthy();
  });

  it("shows the failed status with a retry action", async () => {
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(
      scanView("failed", "llm exploded"),
    );
    renderFlow();

    pickFile();

    expect(
      await screen.findByText("No se pudo analizar el ticket."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeTruthy();
  });

  it("shows the connection message when upload fails with a network TypeError", async () => {
    vi.mocked(uploadReceipt).mockRejectedValue(new TypeError("fetch failed"));
    renderFlow();

    pickFile();

    expect(
      await screen.findByText(
        "El escaneo de tickets necesita conexión.",
      ),
    ).toBeTruthy();
  });

  it("creates a category inline from a review row and confirms with it (T8, S8)", async () => {
    const onCreateCategory = vi.fn().mockResolvedValue({
      id: "cat-pets",
      key: "mascotas",
      label: "Mascotas",
      nature: "essential",
      custom: true,
    } satisfies CategoryView);
    renderFlow({ onCreateCategory });
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());
    vi.mocked(confirmReceipt).mockResolvedValue({
      transaction: confirmedTransaction,
      createdCategories: [],
    });

    pickFile();
    await screen.findByLabelText("Concepto");

    const rowSelect = screen.getAllByRole("combobox", {
      name: "Categoría",
    })[0];
    if (!rowSelect) throw new Error("split category select not rendered");
    fireEvent.mouseDown(rowSelect);
    fireEvent.click(
      screen.getByRole("option", { name: /Nueva categoría/i }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText("Nombre de la categoría"),
      { target: { value: "Mascotas" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Crear categoría" }),
    );

    await waitFor(() => {
      expect(onCreateCategory).toHaveBeenCalledWith({
        label: "Mascotas",
        nature: "essential",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(await screen.findByRole("option", { name: "BCP soles" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Aprobar y registrar" }),
    );

    // The inline-created category lands in the confirm payload.
    await waitFor(() => {
      expect(confirmReceipt).toHaveBeenCalledWith(
        "rc-1",
        expect.objectContaining({
          splits: [
            {
              categoryId: "cat-pets",
              newCategory: null,
              amountMinorUnits: 5000,
            },
            {
              categoryId: null,
              newCategory: {
                name: "Cuidado personal",
                nature: "discretionary",
              },
              amountMinorUnits: 4000,
            },
          ],
        }),
      );
    });
  });

  it("discards the scan via POST reject and closes", async () => {
    const { onClose } = renderFlow();
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());
    vi.mocked(rejectReceipt).mockResolvedValue(scanView("rejected"));

    pickFile();
    await screen.findByLabelText("Concepto");

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    await waitFor(() => {
      expect(rejectReceipt).toHaveBeenCalledWith("rc-1");
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
