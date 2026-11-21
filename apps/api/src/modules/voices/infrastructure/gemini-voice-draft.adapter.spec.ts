import { describe, expect, it, vi } from "vitest";

import type { CategoryView } from "../../categorization/index.js";
import { GeminiVoiceDraftAdapter } from "./gemini-voice-draft.adapter.js";

const CATALOG: CategoryView[] = [
  { id: "c1", key: "groceries", label: "Groceries", nature: "essential", custom: true },
  { id: "c2", key: "transport", label: "Transport", nature: "essential", custom: false },
];

const EXTRACTION = {
  transcript: "compré un sol de pan",
  type: "expense",
  concept: "Compra de pan",
  dateHint: null,
  total: null,
  items: [
    {
      concept: "Pan",
      amount: 1,
      currency: "PEN",
      suggestedCategoryKey: "groceries",
      suggestedNewCategory: null,
      confidence: 0.92,
    },
  ],
};

function geminiResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status },
  );
}

function fakeFetch(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function adapter(fetchImpl: typeof fetch): GeminiVoiceDraftAdapter {
  return new GeminiVoiceDraftAdapter({
    apiKey: "test-key",
    model: "gemini-3.5-flash-lite",
    fetchImpl,
  });
}

const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

describe("GeminiVoiceDraftAdapter (voice-drafts T2, D1, S2+S3+S4)", () => {
  it("POSTs generateContent with the audio as base64 inlineData, JSON mime type and a responseSchema; the prompt carries the workspace catalog", async () => {
    const { fetchImpl, calls } = fakeFetch([
      geminiResponse(JSON.stringify(EXTRACTION)),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-key");
    expect(headers.get("content-type")).toBe("application/json");
    // R4-1: an explicit abort signal bounds every upstream call.
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(init.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: Record<string, unknown>;
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeDefined();
    const parts = body.contents[0]!.parts;
    const inline = parts.find((p) => "inlineData" in p) as {
      inlineData: { mimeType: string; data: string };
    };
    expect(inline.inlineData.mimeType).toBe("audio/webm");
    expect(Buffer.from(inline.inlineData.data, "base64")).toEqual(
      Buffer.from(WEBM),
    );
    const prompt = String(
      (parts.find((p) => "text" in p) as { text: string }).text,
    );
    expect(prompt).toContain("groceries");
    expect(prompt).toContain("transport");
  });

  it("returns the typed extraction on a valid JSON response, normalizing major-unit amounts to minor units", async () => {
    const { fetchImpl } = fakeFetch([
      geminiResponse(
        JSON.stringify({
          ...EXTRACTION,
          total: 2.2,
          items: [
            {
              concept: "Sachet de champú",
              amount: 0.7,
              suggestedCategoryKey: "groceries",
              confidence: 0.9,
            },
            {
              concept: "Gaseosa",
              amount: 1.5,
              suggestedCategoryKey: "groceries",
              confidence: 0.88,
            },
          ],
        }),
      ),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transcript).toBe("compré un sol de pan");
    expect(result.value.type).toBe("expense");
    expect(result.value.totalMinorUnits).toBe(220);
    expect(result.value.items[0]!.amountMinorUnits).toBe(70);
    expect(result.value.items[1]!.amountMinorUnits).toBe(150);
  });

  it("retries once with a corrective turn when the response fails zod validation, then succeeds", async () => {
    const bad = JSON.stringify({ transcript: "ok", items: "nope" });
    const { fetchImpl, calls } = fakeFetch([
      geminiResponse(bad),
      geminiResponse(JSON.stringify(EXTRACTION)),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const retryBody = JSON.parse(String(calls[1]!.init.body)) as {
      contents: Array<{ role?: string; parts: Array<{ text?: string }> }>;
    };
    expect(retryBody.contents.length).toBeGreaterThanOrEqual(3);
    const roles = retryBody.contents.map((c) => c.role);
    expect(roles[1]).toBe("model");
    expect(retryBody.contents[1]!.parts[0]!.text).toBe(bad);
    expect(roles[2]).toBe("user");
  });

  it("fails with VOICE_DRAFT_FAILED when the corrective retry is also invalid", async () => {
    const { fetchImpl, calls } = fakeFetch([
      geminiResponse("not json at all"),
      geminiResponse(JSON.stringify({ still: "bad" })),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_FAILED");
    }
    expect(calls).toHaveLength(2);
  });

  it("fails fast on a deliberate non-2xx API rejection without retrying (R4-3: only 429/5xx retry)", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("bad request", { status: 400 }),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_FAILED");
      expect(result.error.message).toContain("400");
    }
    expect(calls).toHaveLength(1);
  });

  it.each([429, 500, 502, 503, 504])(
    "retries a transient %s response exactly once, then succeeds (R4-3)",
    async (status) => {
      const { fetchImpl, calls } = fakeFetch([
        new Response("transient", { status }),
        geminiResponse(JSON.stringify(EXTRACTION)),
      ]);
      const sut = new GeminiVoiceDraftAdapter({
        apiKey: "k",
        model: "m",
        fetchImpl,
        retryDelayMs: 0,
      });

      const result = await sut.processAudio(WEBM, "audio/webm", CATALOG);

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(2);
    },
  );

  it("fails after exactly one retry when a transient error persists", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("busy", { status: 503 }),
      new Response("still busy", { status: 503 }),
    ]);
    const sut = new GeminiVoiceDraftAdapter({
      apiKey: "k",
      model: "m",
      fetchImpl,
      retryDelayMs: 0,
    });

    const result = await sut.processAudio(WEBM, "audio/webm", CATALOG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_FAILED");
      expect(result.error.message).toContain("503");
    }
    expect(calls).toHaveLength(2);
  });

  it("retries a network failure exactly once before succeeding (R4-3)", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(geminiResponse(JSON.stringify(EXTRACTION)));
    const sut = new GeminiVoiceDraftAdapter({
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: 0,
    });

    const result = await sut.processAudio(WEBM, "audio/webm", CATALOG);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a 200 with a non-JSON body returns VOICE_DRAFT_FAILED instead of throwing past the retry contract (R3-002)", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("<html>gateway error page</html>", { status: 200 }),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_FAILED");
    }
    expect(calls).toHaveLength(1);
  });

  it("aborts a stalled upstream request after requestTimeoutMs and fails to VOICE_DRAFT_FAILED (R4-1)", async () => {
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        );
        // No signal wired (pre-fix shape) → the request hangs; the
        // fallback keeps the RED observation fast and deterministic.
        setTimeout(() => reject(new Error("never aborted")), 100);
      }),
    );
    const sut = new GeminiVoiceDraftAdapter({
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestTimeoutMs: 5,
      retryDelayMs: 0,
    });

    const result = await sut.processAudio(WEBM, "audio/webm", CATALOG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_FAILED");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one transport retry
  });

  it("demotes a suggestedCategoryKey absent from the workspace catalog to null (S3)", async () => {
    const payload = {
      ...EXTRACTION,
      items: [
        { ...EXTRACTION.items[0]!, suggestedCategoryKey: "hallucinated_key" },
      ],
    };
    const { fetchImpl } = fakeFetch([
      geminiResponse(JSON.stringify(payload)),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]!.suggestedCategoryKey).toBeNull();
  });

  it("drops suggestedNewCategory when a valid catalog key already matched (S4 — proposal only when nothing fits)", async () => {
    const payload = {
      ...EXTRACTION,
      items: [
        {
          ...EXTRACTION.items[0]!,
          suggestedCategoryKey: "groceries",
          suggestedNewCategory: { name: "Other", nature: "discretionary" },
        },
      ],
    };
    const { fetchImpl } = fakeFetch([
      geminiResponse(JSON.stringify(payload)),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]!.suggestedNewCategory).toBeNull();
  });

  it("honours model/baseUrl overrides", async () => {
    const { fetchImpl, calls } = fakeFetch([
      geminiResponse(JSON.stringify(EXTRACTION)),
    ]);
    const custom = new GeminiVoiceDraftAdapter({
      apiKey: "k",
      model: "custom-model",
      baseUrl: "https://llm.internal",
      fetchImpl,
    });

    await custom.processAudio(WEBM, "audio/ogg", CATALOG);

    expect(calls[0]!.url).toBe(
      "https://llm.internal/v1beta/models/custom-model:generateContent",
    );
  });
});
