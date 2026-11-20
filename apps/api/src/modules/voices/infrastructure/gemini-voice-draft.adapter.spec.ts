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

  it("fails fast on a non-2xx API response without retrying", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("quota exceeded", { status: 429 }),
    ]);

    const result = await adapter(fetchImpl).processAudio(
      WEBM,
      "audio/webm",
      CATALOG,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_FAILED");
      expect(result.error.message).toContain("429");
    }
    expect(calls).toHaveLength(1);
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
