import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addCurrency,
  ApiError,
  archiveAccount,
  archiveCategory,
  archiveCurrency,
  confirmVoiceDraft,
  createAccount,
  createCategory,
  createTransaction,
  deleteReceiptFile,
  fetchBalance,
  getReceiptFile,
  getVoiceConsent,
  getVoiceDraft,
  getVoiceFile,
  getVoiceNote,
  getWorkspace,
  listAccounts,
  listCategories,
  listCurrencies,
  listCurrencyCatalog,
  listReceipts,
  purgeReceiptMedia,
  listTransactionRevisions,
  listTransactions,
  rejectVoiceNote,
  reviseAccount,
  reviseCategory,
  reviseCurrency,
  reviseTransaction,
  createDemoSession,
  deleteDemoSession,
  getDemoSessionStatus,
  retryReceiptScan,
  retryVoiceNote,
  setVoiceConsent,
  unarchiveAccount,
  updateWorkspace,
  uploadVoiceNote,
  voidTransaction,
  setAccessTokenProvider,
} from "./api";

const fetchMock = vi.fn<typeof fetch>(
  async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockClear();
});

function calledUrl(): string {
  const firstCall = fetchMock.mock.calls[0];
  if (!firstCall) throw new Error("fetch was not called");
  return String(firstCall[0]);
}

function calledHeaders(): Record<string, string> {
  const firstCall = fetchMock.mock.calls[0];
  if (!firstCall) throw new Error("fetch was not called");
  return (firstCall[1]?.headers ?? {}) as Record<string, string>;
}

describe("dev auth bypass", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setAccessTokenProvider(null);
  });

  it("sends x-dev-user: dev-user when VITE_AUTH_BYPASS is true in dev", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_AUTH_BYPASS", "true");
    await listAccounts();
    expect(calledHeaders()["x-dev-user"]).toBe("dev-user");
  });

  it("does not send x-dev-user when bypass is off", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_AUTH_BYPASS", "false");
    await listAccounts();
    expect(calledHeaders()["x-dev-user"]).toBeUndefined();
  });
});

/**
 * In-memory sessionStorage stub — api.spec runs in the node
 * environment where no sessionStorage exists, so the per-tab demo
 * session id is faked through a direct global assignment
 * (demo-maria-session T8, S2+S3; L10 restored per-sid model).
 */
function stubDemoSid(value: string | null) {
  const store = new Map<string, string>();
  if (value !== null) store.set("demo-sid", value);
  // Direct assignment (not vi.stubGlobal) so unstubAllGlobals can stay
  // out of the cleanup path — it would also remove the module-level
  // fetch stub and break every test that follows.
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, next: string) => void store.set(key, next),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

function clearDemoSidStub() {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
}

describe("demo session (demo-maria-session T8, S2+S3; L10 per-sid model)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearDemoSidStub();
    setAccessTokenProvider(null);
  });

  it("sends x-demo-session alongside the bearer when a sid is stored", async () => {
    stubDemoSid("sid-123");
    setAccessTokenProvider(async () => "token-abc");

    await listAccounts();

    const headers = calledHeaders();
    expect(headers["x-demo-session"]).toBe("sid-123");
    expect(headers["authorization"]).toBe("Bearer token-abc");
    expect(headers["x-dev-user"]).toBeUndefined();
  });

  it("omits x-demo-session when no sid is stored", async () => {
    stubDemoSid(null);
    setAccessTokenProvider(async () => "token-abc");

    await listAccounts();

    const headers = calledHeaders();
    expect(headers["x-demo-session"]).toBeUndefined();
    expect(headers["authorization"]).toBe("Bearer token-abc");
  });

  it("keeps the dev-user identity when the dev bypass is on and no sid is stored", async () => {
    stubDemoSid(null);
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_AUTH_BYPASS", "true");

    await listAccounts();

    expect(calledHeaders()["x-dev-user"]).toBe("dev-user");
    expect(calledHeaders()["x-demo-session"]).toBeUndefined();
  });

  it("createDemoSession posts to /demo/session with the bearer and returns the session ids", async () => {
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ sessionId: "sid-9", workspaceId: "ws-9" }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await createDemoSession();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/demo/session");
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer token-abc");
    expect(result).toEqual({ sessionId: "sid-9", workspaceId: "ws-9" });
  });

  it("createDemoSession propagates API errors so no sid is stored on failure", async () => {
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "GENERIC" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await createDemoSession().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "GENERIC", status: 500 });
  });

  it("deleteDemoSession sends DELETE /demo/session carrying the bearer and the sid header", async () => {
    stubDemoSid("sid-7");
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteDemoSession();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/demo/session");
    expect(init?.method).toBe("DELETE");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer token-abc");
    expect(headers["x-demo-session"]).toBe("sid-7");
  });

  it("getDemoSessionStatus GETs /demo/session/status carrying bearer + sid (T9, S10)", async () => {
    stubDemoSid("sid-9");
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ready: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await getDemoSessionStatus();

    expect(result).toEqual({ ready: false });
    expect(calledUrl()).toBe("/api/v1/demo/session/status");
    const headers = calledHeaders();
    expect(headers["x-demo-session"]).toBe("sid-9");
    expect(headers["authorization"]).toBe("Bearer token-abc");
  });

  it("deleteDemoSession propagates API errors so sign-out can treat it as best-effort", async () => {
    stubDemoSid("sid-7");
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "GENERIC" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await deleteDemoSession().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "GENERIC", status: 500 });
  });
});

describe("listTransactions", () => {
  it("requests the bare endpoint without filters", async () => {
    await listTransactions();

    expect(calledUrl()).toBe("/api/v1/transactions");
  });

  it("builds the querystring from all filters (RF-013)", async () => {
    await listTransactions({
      q: "polleria",
      type: "expense",
      currency: "PEN",
      category: "uncategorized",
      from: "2026-10-01",
      to: "2026-10-31",
      limit: 25,
      offset: 50,
    });

    expect(calledUrl()).toBe(
      "/api/v1/transactions?q=polleria&type=expense&currency=PEN&category=uncategorized&from=2026-10-01&to=2026-10-31&limit=25&offset=50",
    );
  });

  it("omits empty and undefined values", async () => {
    await listTransactions({ q: "", currency: "USD", category: undefined });

    expect(calledUrl()).toBe("/api/v1/transactions?currency=USD");
  });
});

describe("fetchBalance", () => {
  it("requests the balance aggregate endpoint", async () => {
    await fetchBalance();

    expect(calledUrl()).toBe("/api/v1/balance");
  });
});

describe("transaction lifecycle", () => {
  it("creates a transaction with POST /transactions", async () => {
    const input = {
      type: "expense" as const,
      amount: "12.50",
      currency: "PEN",
      businessDate: "2026-10-01",
      timezone: "UTC",
      concept: "Almuerzo",
      accountId: "acc-1",
      categoryId: null,
      idempotencyKey: "key-1",
    };

    await createTransaction(input);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("revises a transaction with PATCH /transactions/:id", async () => {
    await reviseTransaction("tx-1", { concept: "Almuerzo team" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions/tx-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      concept: "Almuerzo team",
    });
  });

  it("voids a transaction with POST /transactions/:id/void", async () => {
    await voidTransaction("tx-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions/tx-1/void");
    expect(init?.method).toBe("POST");
  });

  it("lists revisions with GET /transactions/:id/revisions", async () => {
    await listTransactionRevisions("tx-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions/tx-1/revisions");
    expect(init?.method ?? "GET").toBe("GET");
  });
});

describe("catalog reads", () => {
  it("lists categories with GET /categories", async () => {
    await listCategories();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("gets the workspace with GET /workspace", async () => {
    await getWorkspace();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/workspace");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("lists accounts without options on the bare endpoint", async () => {
    await listAccounts();

    expect(calledUrl()).toBe("/api/v1/accounts");
  });
});

describe("ApiError", () => {
  it("throws ApiError carrying the server code, message and status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "TRANSACTION_NOT_FOUND",
          message: "El movimiento no existe.",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("ApiError");
    expect(error).toMatchObject({
      code: "TRANSACTION_NOT_FOUND",
      message: "El movimiento no existe.",
      status: 404,
    });
  });

  it("keeps the server code but falls back to a generic message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "ACCOUNT_NAME_TAKEN" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "ACCOUNT_NAME_TAKEN",
      message: "Request failed with status 409",
      status: 409,
    });
  });

  it("falls back to HTTP_<status> when the payload has no code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "HTTP_500",
      message: "Request failed with status 500",
      status: 500,
    });
  });

  it("falls back to HTTP_<status> on a non-JSON error body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream exploded", { status: 502 }),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "HTTP_502",
      message: "Request failed with status 502",
      status: 502,
    });
  });
});

describe("custom categories (RF-040, RF-044)", () => {
  it("creates a category with POST /categories", async () => {
    await createCategory({ label: "Mascotas", nature: "discretionary" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      label: "Mascotas",
      nature: "discretionary",
    });
  });

  it("revises a category with PATCH /categories/:id", async () => {
    await reviseCategory("cat-1", { label: "Mis mascotas", nature: "essential" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories/cat-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      label: "Mis mascotas",
      nature: "essential",
    });
  });

  it("archives a category with POST /categories/:id/archive", async () => {
    await archiveCategory("cat-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories/cat-1/archive");
    expect(init?.method).toBe("POST");
  });
});

describe("accounts (S12-2)", () => {
  it("creates an account with kind and initialBalance", async () => {
    await createAccount({
      name: "BCP soles",
      currency: "PEN",
      kind: "bank",
      initialBalance: "1500.00",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/accounts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "BCP soles",
      currency: "PEN",
      kind: "bank",
      initialBalance: "1500.00",
    });
  });

  it("revises an account with PATCH /accounts/:id", async () => {
    await reviseAccount("acc-1", {
      name: "BCP principal",
      kind: "savings",
      initialBalance: "200.00",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/accounts/acc-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "BCP principal",
      kind: "savings",
      initialBalance: "200.00",
    });
  });

  it("archives an account with POST /accounts/:id/archive", async () => {
    await archiveAccount("acc-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/accounts/acc-1/archive");
    expect(init?.method).toBe("POST");
  });
});

describe("workspace currencies (S12-4)", () => {
  it("lists the active workspace currencies", async () => {
    await listCurrencies();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("lists the ISO 4217 catalog for the searchable selector", async () => {
    await listCurrencyCatalog();

    expect(calledUrl()).toBe("/api/v1/currencies/catalog");
  });

  it("adds a currency with POST /currencies", async () => {
    await addCurrency({ code: "USD" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "USD" });
  });

  it("revises a currency code with PATCH /currencies/:id", async () => {
    await reviseCurrency("cur-1", { code: "EUR" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies/cur-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "EUR" });
  });

  it("archives a currency with POST /currencies/:id/archive", async () => {
    await archiveCurrency("cur-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies/cur-1/archive");
    expect(init?.method).toBe("POST");
  });
});

describe("workspace preferences (RF-003)", () => {
  it("sends the preference patch with PATCH /workspace", async () => {
    await updateWorkspace({ timezone: "America/Lima" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/workspace");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      timezone: "America/Lima",
    });
  });

  it("sends a partial patch with only the changed field", async () => {
    await updateWorkspace({ defaultCurrency: "USD" });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      defaultCurrency: "USD",
    });
  });
});

describe("unarchive accounts (T25)", () => {
  it("lists accounts including archived via query param", async () => {
    await listAccounts({ includeArchived: true });

    expect(calledUrl()).toBe("/api/v1/accounts?includeArchived=true");
  });

  it("restores an account with PATCH {archived:false}", async () => {
    await unarchiveAccount("acc-9");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/accounts/acc-9");
    expect(init?.method).toBe("PATCH");
    expect(String(init?.body)).toBe(JSON.stringify({ archived: false }));
  });
});

describe("receipt list (receipt-review-link T4+T7, S1+S4)", () => {
  it("lists workspace receipts with GET /receipts", async () => {
    await listReceipts();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/receipts");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("sends limit and cursor when paginating (T7)", async () => {
    await listReceipts({ limit: 20, cursor: "cur-9" });

    expect(calledUrl()).toBe("/api/v1/receipts?limit=20&cursor=cur-9");
  });
});

describe("receipt file download (receipt-review-link T6, L28)", () => {
  afterEach(() => {
    setAccessTokenProvider(null);
  });

  it("fetches /receipts/:id/file as a blob through the auth path", async () => {
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(
      new Response("jpeg-bytes", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const blob = await getReceiptFile("rc-1");

    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("jpeg-bytes");
    expect(calledUrl()).toBe("/api/v1/receipts/rc-1/file");
    const headers = new Headers(calledHeaders());
    expect(headers.get("authorization")).toBe("Bearer token-abc");
  });

  it("throws ApiError on failures (410 media deleted)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "RECEIPT_MEDIA_GONE", message: "gone" }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
    );

    const error = await getReceiptFile("rc-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "RECEIPT_MEDIA_GONE", status: 410 });
  });
});

describe("receipt media deletion (receipt-retention-30d T5, S3)", () => {
  it("deletes the stored object with DELETE /receipts/:id/file", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteReceiptFile("rc-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/receipts/rc-1/file");
    expect(init?.method).toBe("DELETE");
  });
});

describe("receipt media bulk purge (receipt-retention-30d T7, S6)", () => {
  it("posts {olderThanDays} to /receipts/purge-media and returns the count", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await purgeReceiptMedia(30);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/receipts/purge-media");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ olderThanDays: 30 });
    expect(result).toEqual({ deleted: 3 });
  });
});

describe("voice notes (voice-drafts T4, S1+S2+S4)", () => {
  afterEach(() => {
    setAccessTokenProvider(null);
  });

  it("uploads the audio as multipart FormData to POST /voices", async () => {
    const file = new File(["audio"], "voz.webm", { type: "audio/webm" });

    await uploadVoiceNote(file);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices");
    expect(init?.method).toBe("POST");
    // Multipart: the browser sets the boundary content-type — the api
    // client must NOT force application/json on FormData bodies.
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBeNull();
    const form = init?.body as FormData;
    expect(form.get("file")).toBe(file);
  });

  it("polls the note with GET /voices/:id", async () => {
    await getVoiceNote("vn-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/vn-1");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("reads the draft with GET /voices/:id/draft", async () => {
    await getVoiceDraft("vn-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/vn-1/draft");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("confirms the draft with POST /voices/:id/confirm", async () => {
    const input = {
      accountId: "acc-1",
      type: "expense" as const,
      businessDate: "2026-10-03",
      currency: "PEN",
      concept: "Champú",
      splits: [
        {
          categoryId: "cat-food",
          newCategory: null,
          amountMinorUnits: 70,
        },
      ],
      idempotencyKey: "key-voice-1",
    };

    await confirmVoiceDraft("vn-1", input);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/vn-1/confirm");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("rejects the draft with POST /voices/:id/reject", async () => {
    await rejectVoiceNote("vn-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/vn-1/reject");
    expect(init?.method).toBe("POST");
  });

  it("retries a failed note with POST /voices/:id/retry — no re-upload", async () => {
    await retryVoiceNote("vn-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/vn-1/retry");
    expect(init?.method).toBe("POST");
  });

  it("fetches /voices/:id/file as a blob through the auth path", async () => {
    setAccessTokenProvider(async () => "token-abc");
    fetchMock.mockResolvedValueOnce(
      new Response("webm-bytes", {
        status: 200,
        headers: { "content-type": "audio/webm" },
      }),
    );

    const blob = await getVoiceFile("vn-1");

    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("webm-bytes");
    expect(calledUrl()).toBe("/api/v1/voices/vn-1/file");
    const headers = new Headers(calledHeaders());
    expect(headers.get("authorization")).toBe("Bearer token-abc");
  });

  it("throws ApiError on voice file failures (410 media deleted)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "VOICE_MEDIA_DELETED", message: "gone" }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
    );

    const error = await getVoiceFile("vn-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "VOICE_MEDIA_DELETED", status: 410 });
  });
});

describe("voice consent (voice-drafts T5, S6)", () => {
  it("reads the consent flag with GET /voices/consent", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          provider: "gemini",
          granted: true,
          grantedAt: "2026-11-10T12:00:00.000Z",
          revokedAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const view = await getVoiceConsent();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/consent");
    expect(init?.method ?? "GET").toBe("GET");
    expect(view).toEqual({
      provider: "gemini",
      granted: true,
      grantedAt: "2026-11-10T12:00:00.000Z",
      revokedAt: null,
    });
  });

  it("writes the decision with PATCH /voices/consent {granted}", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          provider: "gemini",
          granted: false,
          grantedAt: "2026-11-10T12:00:00.000Z",
          revokedAt: "2026-11-11T12:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const view = await setVoiceConsent(false);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/voices/consent");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ granted: false });
    expect(view.granted).toBe(false);
    expect(view.revokedAt).toBe("2026-11-11T12:00:00.000Z");
  });
});

describe("receipt scan retry (receipt-scan-drafts T12, S11)", () => {
  it("posts to /receipts/:id/retry without re-uploading the image", async () => {
    await retryReceiptScan("rc-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/receipts/rc-1/retry");
    expect(init?.method).toBe("POST");
  });
});

describe("access token provider (T6-web)", () => {
  afterEach(() => {
    setAccessTokenProvider(null);
  });

  it("sends Authorization: Bearer when the provider yields a token", async () => {
    setAccessTokenProvider(async () => "token-abc");

    await listTransactions();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-abc");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("omits the Authorization header when no provider is set", async () => {
    await listTransactions();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("omits the Authorization header when the provider yields null", async () => {
    setAccessTokenProvider(async () => null);

    await listTransactions();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });
});
