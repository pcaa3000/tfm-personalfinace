// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import {
  confirmVoiceDraft,
  getVoiceDraft,
  getVoiceNote,
  rejectVoiceNote,
  retryVoiceNote,
  uploadVoiceNote,
} from "./api";
import type { AccountView, CategoryView, TransactionView } from "./types";
import type { VoiceDraftPayload, VoiceNoteView } from "./voice-draft";
import { VoiceFlow } from "./VoiceFlow";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    uploadVoiceNote: vi.fn(),
    getVoiceNote: vi.fn(),
    getVoiceDraft: vi.fn(),
    confirmVoiceDraft: vi.fn(),
    rejectVoiceNote: vi.fn(),
    retryVoiceNote: vi.fn(),
  };
});

/**
 * jsdom has no MediaRecorder. The fake emits one `dataavailable` chunk
 * on start and fires `onstop` asynchronously, mirroring the browser
 * contract the component relies on.
 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported: ReadonlySet<string> = new Set([
    "audio/webm;codecs=opus",
    "audio/webm",
  ]);
  static isTypeSupported(mime: string): boolean {
    return FakeMediaRecorder.supported.has(mime);
  }

  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;
  state: "inactive" | "recording" = "inactive";

  constructor(
    readonly stream: MediaStream,
    readonly options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(["audio"], { type: this.mimeType || "audio/webm" }),
      });
    });
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  }
}

const trackStop = vi.fn();
const fakeStream = () =>
  ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream;

const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));

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

function noteView(
  status: VoiceNoteView["status"],
  error: string | null = null,
): VoiceNoteView {
  return {
    id: "vn-1",
    workspaceId: "ws-1",
    status,
    originalFilename: "voz.webm",
    mimeType: "audio/webm",
    sizeBytes: 5,
    transactionId: null,
    transcript: "compré champú",
    error,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    expiresAt: "2026-11-02T00:00:00.000Z",
    mediaDeletedAt: null,
  };
}

const confirmedTransaction: TransactionView = {
  id: "tx-1",
  workspaceId: "ws-1",
  type: "expense",
  amount: "2.20",
  currency: "PEN",
  businessDate: "2026-10-03",
  timezone: "UTC",
  concept: "Champú y gaseosa",
  accountId: "acc-pen",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "voice",
  confirmedAt: "2026-10-03T00:00:00.000Z",
  revisionCount: 0,
  splits: [],
};

function draftPayload(
  overrides: Partial<VoiceDraftPayload> = {},
): VoiceDraftPayload {
  return {
    transcript:
      "compré un sachet de champú a setenta céntimos y una gaseosa a sol cincuenta",
    type: "expense",
    concept: "Champú y gaseosa",
    businessDate: "2026-10-03",
    dateHint: null,
    currency: "PEN",
    currencyConflict: false,
    totalMinorUnits: 220,
    totalMismatch: false,
    splits: [
      {
        categoryKey: "food",
        newCategory: null,
        amountMinorUnits: 150,
        itemCount: 1,
        confidenceAvg: 0.9,
        lowConfidence: false,
      },
      {
        categoryKey: null,
        newCategory: { name: "Cuidado personal", nature: "discretionary" },
        amountMinorUnits: 70,
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
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxDurationMs?: number;
}

function renderFlow(options: RenderOptions = {}) {
  const onConfirmed = options.onConfirmed ?? vi.fn();
  const onClose = options.onClose ?? vi.fn();
  render(
    <VoiceFlow
      categories={categories}
      accounts={accounts}
      defaultCurrency="PEN"
      currencies={["PEN"]}
      timezone="UTC"
      pollIntervalMs={options.pollIntervalMs ?? 5}
      timeoutMs={options.timeoutMs ?? 5_000}
      {...(options.maxDurationMs !== undefined
        ? { maxDurationMs: options.maxDurationMs }
        : {})}
      onConfirmed={onConfirmed}
      onClose={onClose}
    />,
  );
  return { onConfirmed, onClose };
}

/** Record a take and stop it — leaves the flow on the "recorded" state. */
async function recordTake() {
  fireEvent.click(screen.getByRole("button", { name: "Grabar" }));
  expect(await screen.findByText(/Grabando/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Detener" }));
  return screen.findByRole("button", { name: "Usar grabación" });
}

/** Record + upload the take, then let the mocked pipeline resolve. */
async function uploadTake() {
  const use = await recordTake();
  fireEvent.click(use);
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  // jsdom has no URL.createObjectURL — stub it for the take preview.
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:voice-take"),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set([
    "audio/webm;codecs=opus",
    "audio/webm",
  ]);
  getUserMedia.mockClear();
  trackStop.mockClear();
  vi.mocked(uploadVoiceNote).mockReset();
  vi.mocked(getVoiceNote).mockReset();
  vi.mocked(getVoiceDraft).mockReset();
  vi.mocked(confirmVoiceDraft).mockReset();
  vi.mocked(rejectVoiceNote).mockReset();
  vi.mocked(retryVoiceNote).mockReset();
});

afterEach(cleanup);

describe("VoiceFlow — recording (T4, S1)", () => {
  it("records with the preferred webm/opus mime and shows a persistent indicator", async () => {
    renderFlow();

    fireEvent.click(screen.getByRole("button", { name: "Grabar" }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    });
    // Preferred format: first candidate MediaRecorder supports.
    expect(FakeMediaRecorder.instances[0]?.options).toEqual({
      mimeType: "audio/webm;codecs=opus",
    });
    // Persistent recording indicator stays visible while recording.
    expect(await screen.findByText(/Grabando/)).toBeTruthy();
    expect(document.querySelector('[data-part="voice-recording"]')).toBeTruthy();
  });

  it("falls back to the first supported mime when webm/opus is unavailable", async () => {
    FakeMediaRecorder.supported = new Set(["audio/ogg"]);
    renderFlow();

    fireEvent.click(screen.getByRole("button", { name: "Grabar" }));

    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.options).toEqual({
        mimeType: "audio/ogg",
      });
    });
  });

  it("keeps the take after stop: replay via the audio element, discard or use it", async () => {
    renderFlow();

    await recordTake();

    // Replay control (audio element with the take's object URL).
    const audio = document.querySelector("audio");
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute("src")).toBe("blob:voice-take");
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Descartar" }),
    ).toBeTruthy();
    expect(trackStop).toHaveBeenCalled();
  });

  it("auto-stops at the duration cap", async () => {
    renderFlow({ maxDurationMs: 30 });

    fireEvent.click(screen.getByRole("button", { name: "Grabar" }));
    await screen.findByText(/Grabando/);

    // No manual stop — the cap timer fires MediaRecorder.stop().
    expect(
      await screen.findByRole("button", { name: "Usar grabación" }),
    ).toBeTruthy();
  });

  it("discarding the take returns to the idle record step", async () => {
    renderFlow();

    await recordTake();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(
      await screen.findByRole("button", { name: "Grabar" }),
    ).toBeTruthy();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("shows a localized alert when the microphone is unavailable", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );
    renderFlow();

    fireEvent.click(screen.getByRole("button", { name: "Grabar" }));

    expect(
      await screen.findByText("No se pudo acceder al micrófono."),
    ).toBeTruthy();
    // The record action stays available to try again.
    expect(screen.getByRole("button", { name: "Grabar" })).toBeTruthy();
  });
});

describe("VoiceFlow — upload → poll → review (T4, S2+S4)", () => {
  it("uploads the take, polls to draft_ready and renders the review", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote)
      .mockResolvedValueOnce(noteView("pending"))
      .mockResolvedValueOnce(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(draftPayload());
    renderFlow();

    await uploadTake();

    await waitFor(() => {
      expect(uploadVoiceNote).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "voz.webm",
          type: "audio/webm;codecs=opus",
        }),
      );
    });
    expect(
      await screen.findByLabelText("Concepto"),
    ).toHaveProperty("value", "Champú y gaseosa");
    // Transcript visible read-only (S7).
    const transcript = screen.getByLabelText("Transcripción");
    expect(transcript).toHaveProperty(
      "value",
      draftPayload().transcript,
    );
    expect(transcript.hasAttribute("readonly")).toBe(true);
    // nueva categoría propuesta flaggeada (S4).
    expect(screen.getByText(/nueva: Cuidado personal/i)).toBeTruthy();
    // Total derivado de los splits (read-only).
    expect(screen.getByText(/Total: 2\.20 PEN/)).toBeTruthy();
  });

  it("confirms the draft posting splits + fresh idempotencyKey and notifies the parent", async () => {
    const { onConfirmed } = renderFlow();
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(draftPayload());
    vi.mocked(confirmVoiceDraft).mockResolvedValue({
      transaction: confirmedTransaction,
      createdCategories: [],
    });

    await uploadTake();
    await screen.findByLabelText("Concepto");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(await screen.findByRole("option", { name: "BCP soles" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Aprobar y registrar" }),
    );

    await waitFor(() => {
      expect(confirmVoiceDraft).toHaveBeenCalledWith(
        "vn-1",
        expect.objectContaining({
          accountId: "acc-pen",
          type: "expense",
          concept: "Champú y gaseosa",
          businessDate: "2026-10-03",
          currency: "PEN",
          idempotencyKey: expect.any(String),
          splits: [
            {
              categoryId: "cat-food",
              newCategory: null,
              amountMinorUnits: 150,
            },
            {
              categoryId: null,
              newCategory: {
                name: "Cuidado personal",
                nature: "discretionary",
              },
              amountMinorUnits: 70,
            },
          ],
        }),
      );
    });
    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalledWith(confirmedTransaction);
    });
  });

  it("prefills the dictated income type in the review (S3)", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(
      draftPayload({ type: "income", concept: "Cobro mantenimiento" }),
    );
    renderFlow();

    await uploadTake();
    await screen.findByLabelText("Concepto");

    // The Tipo select resolves to the dictated type.
    expect(
      screen.getByRole("combobox", { name: "Tipo" }).textContent,
    ).toBe("Ingreso");
  });

  it("shows the low-confidence chip on flagged splits (S4)", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(
      draftPayload({
        splits: [
          {
            categoryKey: null,
            newCategory: null,
            amountMinorUnits: 220,
            itemCount: 2,
            confidenceAvg: 0.4,
            lowConfidence: true,
          },
        ],
      }),
    );
    renderFlow();

    await uploadTake();

    expect(
      await screen.findByText("Confianza baja"),
    ).toBeTruthy();
  });

  it("shows the totalMismatch warning when items do not sum to the dictated total", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(
      draftPayload({ totalMismatch: true }),
    );
    renderFlow();

    await uploadTake();

    expect(
      await screen.findByText(/no coincide con el total dictado/i),
    ).toBeTruthy();
  });

  it("warns about possible duplicates without blocking the confirm", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(
      draftPayload({
        possibleDuplicates: [
          {
            transactionId: "trx-dup-1",
            concept: "Champú y gaseosa",
            amount: 220,
            occurredOn: "2026-10-02",
          },
        ],
      }),
    );
    renderFlow();

    await uploadTake();

    expect(await screen.findByText(/Posible duplicado/i)).toBeTruthy();
    expect(
      screen.getByText(/Champú y gaseosa, 2\.20 PEN/),
    ).toBeTruthy();
    // Non-blocking: once the required account is picked, confirm works.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Cuenta" }));
    fireEvent.click(await screen.findByRole("option", { name: "BCP soles" }));
    expect(
      screen.getByRole("button", { name: /Aprobar y registrar/i }),
    ).toHaveProperty("disabled", false);
  });

  it("warns when the dictation named conflicting currencies", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(
      draftPayload({ currencyConflict: true }),
    );
    renderFlow();

    await uploadTake();

    expect(
      await screen.findByText(/más de una moneda/i),
    ).toBeTruthy();
  });

  it("discards the draft via POST reject and closes", async () => {
    const { onClose } = renderFlow();
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(draftPayload());
    vi.mocked(rejectVoiceNote).mockResolvedValue(noteView("rejected"));

    await uploadTake();
    await screen.findByLabelText("Concepto");

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    await waitFor(() => {
      expect(rejectVoiceNote).toHaveBeenCalledWith("vn-1");
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe("VoiceFlow — failure + retry (S11 pattern)", () => {
  it("shows the failed status with a retry action", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(
      noteView("failed", "llm exploded"),
    );
    renderFlow();

    await uploadTake();

    expect(
      await screen.findByText("No se pudo procesar el audio."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeTruthy();
  });

  it("resumes polling the same note on retry after a poll timeout — no re-upload", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("pending"));
    renderFlow({ timeoutMs: 30 });

    await uploadTake();

    expect(
      await screen.findByText("El análisis tardó demasiado. Reintentá."),
    ).toBeTruthy();
    expect(uploadVoiceNote).toHaveBeenCalledTimes(1);

    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(draftPayload());

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByLabelText("Concepto")).toBeTruthy();
    expect(uploadVoiceNote).toHaveBeenCalledTimes(1);
    expect(retryVoiceNote).not.toHaveBeenCalled();
    expect(getVoiceNote).toHaveBeenCalledWith("vn-1");
  });

  it("retries a failed note via POST retry and polls the same id — no re-upload", async () => {
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(
      noteView("failed", "llm exploded"),
    );
    renderFlow();

    await uploadTake();

    expect(
      await screen.findByText("No se pudo procesar el audio."),
    ).toBeTruthy();

    vi.mocked(retryVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(noteView("draft_ready"));
    vi.mocked(getVoiceDraft).mockResolvedValue(draftPayload());

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(retryVoiceNote).toHaveBeenCalledWith("vn-1");
    });
    expect(await screen.findByLabelText("Concepto")).toBeTruthy();
    expect(uploadVoiceNote).toHaveBeenCalledTimes(1);
    expect(getVoiceNote).toHaveBeenCalledWith("vn-1");
  });

  it("shows the already-final message when the retry endpoint rejects a final note", async () => {
    const { ApiError } = await import("./api");
    vi.mocked(uploadVoiceNote).mockResolvedValue(noteView("pending"));
    vi.mocked(getVoiceNote).mockResolvedValue(
      noteView("failed", "llm exploded"),
    );
    renderFlow();

    await uploadTake();
    await screen.findByText("No se pudo procesar el audio.");

    vi.mocked(retryVoiceNote).mockRejectedValue(
      new ApiError("VOICE_ALREADY_FINAL", "conflict", 409),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByText(
        "La nota de voz ya fue confirmada o descartada.",
      ),
    ).toBeTruthy();
    expect(uploadVoiceNote).toHaveBeenCalledTimes(1);
  });

  it("shows the connection message when upload fails with a network TypeError", async () => {
    vi.mocked(uploadVoiceNote).mockRejectedValue(
      new TypeError("fetch failed"),
    );
    renderFlow();

    await uploadTake();

    expect(
      await screen.findByText("El registro por voz necesita conexión."),
    ).toBeTruthy();
  });
});
