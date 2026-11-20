import type { ReceiptStoragePort } from "../application/ports/receipt-storage.port.js";
import { signS3Request } from "./s3-sigv4.js";

export interface S3ReceiptStorageConfig {
  /** S3-compatible endpoint, e.g. Supabase Storage `…/storage/v1/s3` or MinIO. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Injectable for specs. */
  readonly fetch?: typeof fetch;
}

/**
 * D2 `s3` driver: path-style SigV4-signed PUT/GET against any
 * S3-compatible endpoint. Quarantine objects live under the configured
 * bucket (`receipts-quarantine`); signed-URL reads can replace `open`
 * later without touching the port.
 */
export class S3ReceiptStorage implements ReceiptStoragePort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: S3ReceiptStorageConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  async save(
    key: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<string> {
    const { url, headers } = signS3Request({
      method: "PUT",
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      payload: bytes,
      contentType: mimeType,
      credentials: this.config,
    });
    const res = await this.fetchImpl(url, {
      method: "PUT",
      headers,
      body: bytes,
    });
    if (!res.ok) {
      throw new Error(
        `S3 PUT ${key} failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
    return key;
  }

  async open(key: string): Promise<Uint8Array | null> {
    const { url, headers } = signS3Request({
      method: "GET",
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      credentials: this.config,
    });
    const res = await this.fetchImpl(url, { method: "GET", headers });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`S3 GET ${key} failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const { url, headers } = signS3Request({
      method: "DELETE",
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      credentials: this.config,
    });
    const res = await this.fetchImpl(url, { method: "DELETE", headers });
    // Idempotent: already-absent media (404) is a successful delete.
    if (res.status === 404) {
      return;
    }
    if (!res.ok) {
      throw new Error(`S3 DELETE ${key} failed: ${res.status}`);
    }
  }
}
