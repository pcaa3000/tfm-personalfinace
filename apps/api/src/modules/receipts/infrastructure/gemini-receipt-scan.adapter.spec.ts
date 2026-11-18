import { describe, expect, it, vi } from "vitest";

import type { CategoryView } from "../../categorization/index.js";
import { GeminiReceiptScanAdapter } from "./gemini-receipt-scan.adapter.js";

const CATALOG: CategoryView[] = [
  { id: "c1", key: "groceries", label: "Groceries", nature: "essential", custom: true },
  { id: "c2", key: "transport", label: "Transport", nature: "essential", custom: false },
];

const EXTRACTION = {
  merchant: "Mercadona",
  businessDate: "2026-11-10",
  currency: "EUR",
  totalMinorUnits: 300,
  items: [
    {
      description: "Milk 1L",
      amountMinorUnits: 300,
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

function adapter(fetchImpl: typeof fetch): GeminiReceiptScanAdapter {
  return new GeminiReceiptScanAdapter({
    apiKey: "test-key",
    model: "gemini-3.5-flash-lite",
    fetchImpl,
  });
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("GeminiReceiptScanAdapter (receipt-scan-drafts T4+T5, D1, S3+S5+S9)", () => {
  it("POSTs generateContent with the image as base64 inlineData, JSON mime type and a responseSchema; the prompt carries the workspace catalog", async () => {
    const { fetchImpl, calls } = fakeFetch([geminiResponse(JSON.stringify(EXTRACTION))]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

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
    expect(inline.inlineData.mimeType).toBe("image/jpeg");
    expect(Buffer.from(inline.inlineData.data, "base64")).toEqual(
      Buffer.from(JPEG),
    );
    const prompt = String(
      (parts.find((p) => "text" in p) as { text: string }).text,
    );
    expect(prompt).toContain("groceries");
    expect(prompt).toContain("transport");
  });

  it("returns the typed extraction on a valid JSON response", async () => {
    const { fetchImpl } = fakeFetch([geminiResponse(JSON.stringify(EXTRACTION))]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.merchant).toBe("Mercadona");
    expect(result.value.currency).toBe("EUR");
    expect(result.value.totalMinorUnits).toBe(300);
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]!.suggestedCategoryKey).toBe("groceries");
  });

  it("retries once with a corrective turn when the response fails zod validation, then succeeds", async () => {
    const bad = JSON.stringify({ merchant: 42, items: "nope" });
    const { fetchImpl, calls } = fakeFetch([
      geminiResponse(bad),
      geminiResponse(JSON.stringify(EXTRACTION)),
    ]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const retryBody = JSON.parse(String(calls[1]!.init.body)) as {
      contents: Array<{ role?: string; parts: Array<{ text?: string }> }>;
    };
    // The corrective retry replays the model's bad answer and explains the failure.
    expect(retryBody.contents.length).toBeGreaterThanOrEqual(3);
    const roles = retryBody.contents.map((c) => c.role);
    expect(roles[1]).toBe("model");
    expect(retryBody.contents[1]!.parts[0]!.text).toBe(bad);
    expect(roles[2]).toBe("user");
  });

  it("fails with RECEIPT_SCAN_FAILED when the corrective retry is also invalid", async () => {
    const { fetchImpl, calls } = fakeFetch([
      geminiResponse("not json at all"),
      geminiResponse(JSON.stringify({ still: "bad" })),
    ]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_SCAN_FAILED");
    }
    expect(calls).toHaveLength(2);
  });

  it("fails fast on a non-2xx API response without retrying", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("quota exceeded", { status: 429 }),
    ]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_SCAN_FAILED");
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
    const { fetchImpl } = fakeFetch([geminiResponse(JSON.stringify(payload))]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]!.suggestedCategoryKey).toBeNull();
  });

  it("drops suggestedNewCategory when a valid catalog key already matched (S10 — proposal only when nothing fits)", async () => {
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
    const { fetchImpl } = fakeFetch([geminiResponse(JSON.stringify(payload))]);

    const result = await adapter(fetchImpl).scan(JPEG, "image/jpeg", CATALOG);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]!.suggestedNewCategory).toBeNull();
  });

  it("honours model/baseUrl overrides", async () => {
    const { fetchImpl, calls } = fakeFetch([geminiResponse(JSON.stringify(EXTRACTION))]);
    const custom = new GeminiReceiptScanAdapter({
      apiKey: "k",
      model: "custom-model",
      baseUrl: "https://llm.internal",
      fetchImpl,
    });

    await custom.scan(JPEG, "image/png", CATALOG);

    expect(calls[0]!.url).toBe(
      "https://llm.internal/v1beta/models/custom-model:generateContent",
    );
  });
});
