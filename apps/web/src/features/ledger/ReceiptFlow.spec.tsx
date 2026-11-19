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
  retryReceiptScan,
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
    retryReceiptScan: vi.fn(),
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
  pollIntervalMs?: number;
  timeoutMs?: number;
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
      pollIntervalMs={options.pollIntervalMs ?? 5}
      timeoutMs={options.timeoutMs ?? 5_000}
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
  vi.mocked(retryReceiptScan).mockReset();
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

  it("resumes polling the same scan on retry after a poll timeout — no re-upload (T12, S11)", async () => {
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("pending"));
    renderFlow({ timeoutMs: 30 });

    pickFile();

    expect(
      await screen.findByText("El análisis tardó demasiado. Reintentá."),
    ).toBeTruthy();
    expect(uploadReceipt).toHaveBeenCalledTimes(1);

    // Second polling round completes over the SAME scan id.
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByLabelText("Concepto")).toBeTruthy();
    expect(uploadReceipt).toHaveBeenCalledTimes(1);
    expect(retryReceiptScan).not.toHaveBeenCalled();
    expect(getReceiptScan).toHaveBeenCalledWith("rc-1");
  });

  it("retries a failed scan via POST retry and polls the same id — no re-upload (T12, S11)", async () => {
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(
      scanView("failed", "llm exploded"),
    );
    renderFlow();

    pickFile();

    expect(
      await screen.findByText("No se pudo analizar el ticket."),
    ).toBeTruthy();

    // The retry endpoint resets the scan to pending; polling resumes
    // over the same scan id until the draft arrives.
    vi.mocked(retryReceiptScan).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(retryReceiptScan).toHaveBeenCalledWith("rc-1");
    });
    expect(await screen.findByLabelText("Concepto")).toBeTruthy();
    expect(uploadReceipt).toHaveBeenCalledTimes(1);
    expect(getReceiptScan).toHaveBeenCalledWith("rc-1");
  });

  it("shows the already-final message when the retry endpoint rejects a final scan", async () => {
    const { ApiError } = await import("./api");
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(
      scanView("failed", "llm exploded"),
    );
    renderFlow();

    pickFile();
    await screen.findByText("No se pudo analizar el ticket.");

    vi.mocked(retryReceiptScan).mockRejectedValue(
      new ApiError("RECEIPT_ALREADY_FINAL", "conflict", 409),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByText("El ticket ya fue confirmado o descartado."),
    ).toBeTruthy();
    expect(uploadReceipt).toHaveBeenCalledTimes(1);
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

describe("ReceiptFlow — desktop camera capture (T11, S1)", () => {
  const trackStop = vi.fn();

  const fakeStream = () =>
    ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream;

  function stubGetUserMedia(
    impl: (constraints?: MediaStreamConstraints) => Promise<MediaStream>,
  ) {
    const getUserMedia = vi.fn(impl);
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    return getUserMedia;
  }

  beforeEach(() => {
    trackStop.mockClear();
    // jsdom does not implement canvas rendering.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback: BlobCallback) {
        callback(new Blob(["jpeg"], { type: "image/jpeg" }));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it("opens a live camera view from the pick step", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(fakeStream()),
    );
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: "Capturar con cámara" }),
    );

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: "environment" },
      });
    });
    expect(
      await screen.findByRole("button", { name: "Capturar" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeTruthy();
    expect(document.querySelector("video")).toBeTruthy();
  });

  it("captures a frame into a File that enters the same upload/review path", async () => {
    stubGetUserMedia(() => Promise.resolve(fakeStream()));
    vi.mocked(uploadReceipt).mockResolvedValue(scanView("pending"));
    vi.mocked(getReceiptScan).mockResolvedValue(scanView("draft_ready"));
    vi.mocked(getReceiptDraft).mockResolvedValue(draftPayload());
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: "Capturar con cámara" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Capturar" }));

    await waitFor(() => {
      expect(uploadReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "captura.jpg",
          type: "image/jpeg",
        }),
      );
    });
    // Same scan path as a picked file: the draft review is reachable.
    expect(await screen.findByLabelText("Concepto")).toBeTruthy();
    expect(trackStop).toHaveBeenCalled();
  });

  it("falls back to a plain video constraint when facingMode fails", async () => {
    const getUserMedia = stubGetUserMedia(
      vi
        .fn<(c?: MediaStreamConstraints) => Promise<MediaStream>>()
        .mockRejectedValueOnce(
          new DOMException("overconstrained", "OverconstrainedError"),
        )
        .mockResolvedValueOnce(fakeStream()),
    );
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: "Capturar con cámara" }),
    );

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: true });
    });
    expect(
      await screen.findByRole("button", { name: "Capturar" }),
    ).toBeTruthy();
  });

  it("shows a localized alert and keeps the file picker when the camera is unavailable", async () => {
    stubGetUserMedia(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: "Capturar con cámara" }),
    );

    expect(
      await screen.findByText(
        "No se pudo acceder a la cámara. Elegí una imagen.",
      ),
    ).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Elegir imagen" }),
    ).toBeTruthy();
  });

  it("cancel closes the camera view and stops the tracks", async () => {
    stubGetUserMedia(() => Promise.resolve(fakeStream()));
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: "Capturar con cámara" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(trackStop).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "Capturar" })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });
});
