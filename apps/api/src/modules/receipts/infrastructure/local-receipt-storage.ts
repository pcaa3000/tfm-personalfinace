import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

import type { ReceiptStoragePort } from "../application/ports/receipt-storage.port.js";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * D2 `local` driver: objects are files under
 * `${RECEIPT_STORAGE_DIR}/quarantine/<workspaceId>/<scanId>.<ext>`.
 * Keys are server-generated, but the resolver still refuses anything
 * that could escape the root — a storage key must never be a filesystem
 * primitive (defense in depth, quarantine boundary).
 */
export class LocalReceiptStorage implements ReceiptStoragePort {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async save(
    key: string,
    bytes: Uint8Array,
    _mimeType: string,
  ): Promise<string> {
    const path = this.resolveKey(key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
    return key;
  }

  async open(key: string): Promise<Uint8Array | null> {
    const path = this.resolveKey(key);
    try {
      const data = await readFile(path);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key);
    try {
      await unlink(path);
    } catch (error) {
      // Idempotent purge/delete: already-absent media is a success.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private resolveKey(key: string): string {
    if (!KEY_PATTERN.test(key) || isAbsolute(key)) {
      throw new Error(`invalid receipt storage key: ${JSON.stringify(key)}`);
    }
    const path = resolve(this.root, normalize(key));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(
        `receipt storage key escapes the storage root: ${JSON.stringify(key)}`,
      );
    }
    return path;
  }
}
