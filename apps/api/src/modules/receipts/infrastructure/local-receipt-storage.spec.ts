import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { LocalReceiptStorage } from "./local-receipt-storage.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tfm-receipts-spec-"));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("LocalReceiptStorage (receipt-scan-drafts T3, D2 local driver)", () => {
  it("writes bytes under RECEIPT_STORAGE_DIR/quarantine/… and reads them back", async () => {
    const root = await makeRoot();
    const storage = new LocalReceiptStorage(root);
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    const key = await storage.save(
      "quarantine/ws-1/scan-1.jpg",
      bytes,
      "image/jpeg",
    );

    expect(key).toBe("quarantine/ws-1/scan-1.jpg");
    // On disk the key resolves under the quarantine subtree of the root.
    const onDisk = await readFile(join(root, "quarantine/ws-1/scan-1.jpg"));
    expect(new Uint8Array(onDisk)).toEqual(bytes);
    expect(await readdir(join(root, "quarantine/ws-1"))).toEqual([
      "scan-1.jpg",
    ]);

    const opened = await storage.open(key);
    expect(opened).not.toBeNull();
    expect(new Uint8Array(opened!)).toEqual(bytes);
  });

  it("returns null when the object is absent", async () => {
    const storage = new LocalReceiptStorage(await makeRoot());
    expect(await storage.open("quarantine/ws-1/missing.jpg")).toBeNull();
  });

  it.each([
    ["parent traversal", "../escape.jpg"],
    ["nested traversal", "quarantine/../../escape.jpg"],
    ["absolute path", "/etc/passwd"],
  ])("rejects %s keys (writes never escape the quarantine root)", async (_label, key) => {
    const storage = new LocalReceiptStorage(await makeRoot());
    await expect(
      storage.save(key, Uint8Array.from([1]), "image/jpeg"),
    ).rejects.toThrow();
  });
});
