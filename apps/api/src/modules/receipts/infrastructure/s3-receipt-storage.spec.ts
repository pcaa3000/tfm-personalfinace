import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { S3ReceiptStorage } from "./s3-receipt-storage.js";

const CONFIG = {
  endpoint: "https://storage.example.com",
  region: "eu-west-1",
  bucket: "receipts-quarantine",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
};

function fakeFetch(status = 200, body: Uint8Array | null = null) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("S3ReceiptStorage (receipt-scan-drafts T3, D2 s3 driver — SigV4 path-style)", () => {
  it("PUTs the object to {endpoint}/{bucket}/{key} with a SigV4 Authorization header", async () => {
    const { fetchImpl, calls } = fakeFetch(200);
    const storage = new S3ReceiptStorage({ ...CONFIG, fetch: fetchImpl });
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

    const key = await storage.save(
      "quarantine/ws-1/scan-1.jpg",
      bytes,
      "image/jpeg",
    );

    expect(key).toBe("quarantine/ws-1/scan-1.jpg");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      "https://storage.example.com/receipts-quarantine/quarantine/ws-1/scan-1.jpg",
    );
    expect(init.method).toBe("PUT");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
    expect(headers.get("x-amz-content-sha256")).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers.get("content-type")).toBe("image/jpeg");
  });

  it("throws when the PUT is rejected by the endpoint", async () => {
    const { fetchImpl } = fakeFetch(403);
    const storage = new S3ReceiptStorage({ ...CONFIG, fetch: fetchImpl });
    await expect(
      storage.save("quarantine/ws-1/a.jpg", Uint8Array.from([1]), "image/jpeg"),
    ).rejects.toThrow();
  });

  it("open() GETs the object and returns null on 404", async () => {
    const payload = Uint8Array.from([1, 2, 3, 4]);
    const { fetchImpl, calls } = fakeFetch(200, payload);
    const storage = new S3ReceiptStorage({ ...CONFIG, fetch: fetchImpl });

    const opened = await storage.open("quarantine/ws-1/scan-1.jpg");

    expect(opened).not.toBeNull();
    expect(new Uint8Array(opened!)).toEqual(payload);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toContain(
      "/receipts-quarantine/quarantine/ws-1/scan-1.jpg",
    );

    const missing = fakeFetch(404);
    const storage2 = new S3ReceiptStorage({
      ...CONFIG,
      fetch: missing.fetchImpl,
    });
    expect(await storage2.open("quarantine/ws-1/none.jpg")).toBeNull();
  });
});
