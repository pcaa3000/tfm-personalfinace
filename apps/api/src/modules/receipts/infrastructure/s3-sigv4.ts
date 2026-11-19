import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 signer for single-object S3 requests
 * (PUT/GET). Self-contained so the S3 driver needs no SDK dependency —
 * works for Supabase Storage S3 endpoints and MinIO alike (path-style
 * URLs only).
 */

export interface SigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
}

const SERVICE = "s3";
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface SignedRequestHeaders {
  readonly authorization: string;
  readonly "x-amz-date": string;
  readonly "x-amz-content-sha256": string;
  readonly host: string;
  readonly "content-type"?: string;
}

/**
 * Signs a path-style request `{endpoint}/{bucket}/{key}` and returns the
 * headers to send. `payload` may be omitted (GET → empty-body hash).
 */
export function signS3Request(input: {
  readonly method: "GET" | "PUT";
  readonly endpoint: string;
  readonly bucket: string;
  readonly key: string;
  readonly payload?: Uint8Array;
  readonly contentType?: string;
  readonly credentials: SigV4Credentials;
  readonly now?: Date;
}): { url: string; headers: Record<string, string> } {
  const base = new URL(input.endpoint.replace(/\/+$/, ""));
  const objectPath =
    `/${input.bucket}/` + input.key.split("/").map(uriEncode).join("/");
  const url = new URL(base.pathname.replace(/\/+$/, "") + objectPath, base);

  const now = input.now ?? new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash =
    input.payload === undefined ? EMPTY_SHA256 : sha256Hex(input.payload);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(input.contentType ? { "content-type": input.contentType } : {}),
  };

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.credentials.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.credentials.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  return {
    url: url.toString(),
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}` +
        `, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
    },
  };
}
