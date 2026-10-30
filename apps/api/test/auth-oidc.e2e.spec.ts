import "reflect-metadata";

import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  api,
  bootApp,
  cleanE2eData,
  prisma,
  type AccountView,
  type ApiError,
  type TxView,
} from "./e2e-helpers.js";

/**
 * OIDC e2e suite (AUTH_MODE=oidc): the app validates real ES256 JWTs against
 * a JWKS served by a local stub server — same code path as Supabase Auth,
 * no external dependency. Covers every rejection branch plus workspace
 * isolation between two distinct token subjects.
 */

const MARKER = "|e2e-oidc-";
const ISSUER = "https://e2e.supabase.co/auth/v1";
const AUDIENCE = "authenticated";
const KEY_ID = "e2e-signing-key";

let app: INestApplication;
let jwksServer: Server;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

interface TokenOptions {
  subject?: string;
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
  key?: typeof privateKey;
  keyId?: string;
}

async function signToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({
      alg: "ES256",
      kid: options.keyId ?? KEY_ID,
      typ: "JWT",
    })
    .setIssuer(options.issuer ?? ISSUER)
    .setSubject(options.subject ?? "e2e-oidc-user")
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300))
    .sign(options.key ?? privateKey);
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function txPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "expense",
    amount: "9.99",
    currency: "PEN",
    businessDate: "2026-10-01",
    timezone: "UTC",
    concept: "e2e oidc tx",
    idempotencyKey: `e2e-${randomUUID()}`,
    ...overrides,
  };
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = KEY_ID;
  jwk.alg = "ES256";
  jwk.use = "sig";

  jwksServer = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, resolve));
  const jwksPort = (jwksServer.address() as AddressInfo).port;

  process.env.AUTH_MODE = "oidc";
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_AUDIENCE = AUDIENCE;
  process.env.OIDC_JWKS_URI = `http://127.0.0.1:${jwksPort}/jwks.json`;

  app = await bootApp();
  await cleanE2eData(MARKER);
}, 30_000);

beforeEach(() => cleanE2eData(MARKER));

afterAll(async () => {
  await cleanE2eData(MARKER);
  await app.close();
  await new Promise<void>((resolve, reject) =>
    jwksServer.close((err) => (err ? reject(err) : resolve())),
  );
  delete process.env.AUTH_MODE;
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_AUDIENCE;
  delete process.env.OIDC_JWKS_URI;
  await prisma.$disconnect();
});

describe("authentication required", () => {
  it("rejects requests without an Authorization header", async () => {
    for (const path of [
      "/api/v1/transactions",
      "/api/v1/categories",
    ]) {
      const res = await api<ApiError>(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects a malformed bearer token", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: bearer("not-a-jwt"),
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an expired token", async () => {
    const token = await signToken({ expiresInSeconds: -60 });
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: bearer(token),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token for another audience", async () => {
    const token = await signToken({ audience: "service_role" });
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: bearer(token),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token from another issuer", async () => {
    const token = await signToken({ issuer: "https://evil.example/auth/v1" });
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: bearer(token),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed by an unknown key", async () => {
    const other = await generateKeyPair("ES256");
    const token = await signToken({ key: other.privateKey });
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: bearer(token),
    });
    expect(res.status).toBe(401);
  });

  it("rejects symmetrically signed tokens even with a valid signature", async () => {
    const secret = randomBytes(32);
    const now = Math.floor(Date.now() / 1000);
    const hsToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ISSUER)
      .setSubject("e2e-oidc-user")
      .setAudience(AUDIENCE)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 300)
      .sign(secret);
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: bearer(hsToken),
    });
    expect(res.status).toBe(401);
  });

  it("ignores the dev x-dev-user header in oidc mode", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      headers: { "x-dev-user": "e2e-alice" },
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });
});

describe("authenticated requests", () => {
  it("creates and lists transactions for the token subject workspace", async () => {
    const token = await signToken({ subject: "e2e-oidc-carol" });
    const account = await api<AccountView>("/api/v1/accounts", {
      method: "POST",
      headers: bearer(token),
      body: { name: "e2e bcp", currency: "PEN" },
    });
    const created = await api<TxView>("/api/v1/transactions", {
      method: "POST",
      headers: bearer(token),
      body: txPayload({ accountId: account.body.id }),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("confirmed");

    const list = await api<TxView[]>("/api/v1/transactions", {
      headers: bearer(token),
    });
    expect(list.body.map((t) => t.id)).toContain(created.body.id);
  });

  it("keeps workspaces isolated between token subjects", async () => {
    const aliceToken = await signToken({ subject: "e2e-oidc-alice" });
    const bobToken = await signToken({ subject: "e2e-oidc-bob" });

    const account = await api<AccountView>("/api/v1/accounts", {
      method: "POST",
      headers: bearer(aliceToken),
      body: { name: "e2e bcp", currency: "PEN" },
    });
    const created = await api<TxView>("/api/v1/transactions", {
      method: "POST",
      headers: bearer(aliceToken),
      body: txPayload({ accountId: account.body.id }),
    });
    const id = created.body.id;

    const bobList = await api<TxView[]>("/api/v1/transactions", {
      headers: bearer(bobToken),
    });
    expect(bobList.body.map((t) => t.id)).not.toContain(id);

    const bobPatch = await api<ApiError>(`/api/v1/transactions/${id}`, {
      method: "PATCH",
      headers: bearer(bobToken),
      body: { concept: "hijack" },
    });
    expect(bobPatch.status).toBe(404);

    const bobVoid = await api<ApiError>(`/api/v1/transactions/${id}/void`, {
      method: "POST",
      headers: bearer(bobToken),
    });
    expect(bobVoid.status).toBe(404);
  });
});
