import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp, envFromProcess, type AppEnv } from "./composition.js";

/**
 * S3 (GAP-SEC-01): unknown/missing AUTH_MODE fails closed at boot.
 * S8 (NEW-SEC-13): missing DATABASE_URL fails fast, no localhost fallback.
 * S4/S5: CORS allowlist + rate-limit knobs come from env with dev defaults.
 */

const ENV_KEYS = [
  "DATABASE_URL",
  "AUTH_MODE",
  "NODE_ENV",
  "OIDC_ISSUER",
  "OIDC_AUDIENCE",
  "OIDC_JWKS_URI",
  "CORS_ORIGINS",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_READ_MAX",
  "RATE_LIMIT_READ_WINDOW_MS",
  "STORAGE_DRIVER",
  "RECEIPT_STORAGE_DIR",
  "RECEIPT_MAX_BYTES",
  "S3_ENDPOINT",
  "S3_REGION",
  "RECEIPT_S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "RECEIPT_SCAN_DISPATCHER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
] as const;

const DATABASE_URL = "postgresql://u:p@db:5432/spec";

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("envFromProcess — DATABASE_URL (S8)", () => {
  it("throws a clear error when DATABASE_URL is missing", () => {
    process.env.AUTH_MODE = "dev";
    expect(() => envFromProcess()).toThrow(/DATABASE_URL/);
  });
});

describe("envFromProcess — AUTH_MODE (S3)", () => {
  it("fails closed when AUTH_MODE is unset", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    expect(() => envFromProcess()).toThrow(/AUTH_MODE/);
  });

  it("fails closed when AUTH_MODE is an unknown value", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "production";
    expect(() => envFromProcess()).toThrow(/AUTH_MODE/);
  });

  it("returns dev mode only for the explicit AUTH_MODE=dev", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    const env = envFromProcess();
    expect(env.authMode).toBe("dev");
    expect(env.databaseUrl).toBe(DATABASE_URL);
  });

  it("keeps requiring the OIDC triple in oidc mode", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "oidc";
    expect(() => envFromProcess()).toThrow(/OIDC_ISSUER/);
  });

  it("returns the oidc config when the full triple is set", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "oidc";
    process.env.OIDC_ISSUER = "https://issuer.example";
    process.env.OIDC_AUDIENCE = "aud";
    process.env.OIDC_JWKS_URI = "https://issuer.example/jwks.json";
    const env = envFromProcess();
    expect(env.authMode).toBe("oidc");
    expect(env.oidc).toEqual({
      issuer: "https://issuer.example",
      audience: "aud",
      jwksUri: "https://issuer.example/jwks.json",
    });
  });
});

describe("envFromProcess — production guard (S1)", () => {
  it("throws when AUTH_MODE=dev runs under NODE_ENV=production", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.NODE_ENV = "production";
    expect(() => envFromProcess()).toThrow(
      /AUTH_MODE=dev is forbidden when NODE_ENV=production/,
    );
  });

  it("still allows AUTH_MODE=dev when NODE_ENV is unset or non-production", () => {
    for (const nodeEnv of [undefined, "development", "test"]) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      process.env.DATABASE_URL = DATABASE_URL;
      process.env.AUTH_MODE = "dev";
      expect(envFromProcess().authMode).toBe("dev");
    }
  });

  it("allows AUTH_MODE=oidc under NODE_ENV=production", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "oidc";
    process.env.NODE_ENV = "production";
    process.env.OIDC_ISSUER = "https://issuer.example";
    process.env.OIDC_AUDIENCE = "aud";
    process.env.OIDC_JWKS_URI = "https://issuer.example/jwks.json";
    expect(envFromProcess().authMode).toBe("oidc");
  });
});

describe("envFromProcess — HTTP security config (S4/S5)", () => {
  it("defaults the CORS allowlist to the dev web origin", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    expect(envFromProcess().security.corsOrigins).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("parses CORS_ORIGINS as a comma-separated allowlist", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.CORS_ORIGINS =
      "https://app.example.com, https://staging.example.com";
    expect(envFromProcess().security.corsOrigins).toEqual([
      "https://app.example.com",
      "https://staging.example.com",
    ]);
  });

  it("defaults the write rate limit to 60 req/min", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    expect(envFromProcess().security.rateLimit).toEqual({
      max: 60,
      windowMs: 60_000,
    });
  });

  it("rejects non-numeric RATE_LIMIT_MAX instead of silently disabling the limiter", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.RATE_LIMIT_MAX = "soon";
    expect(() => envFromProcess()).toThrow(/RATE_LIMIT_MAX/);
  });

  it("rejects non-positive RATE_LIMIT_WINDOW_MS instead of never expiring", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.RATE_LIMIT_WINDOW_MS = "0";
    expect(() => envFromProcess()).toThrow(/RATE_LIMIT_WINDOW_MS/);
  });

  it("reads RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RATE_LIMIT_MAX = "10";
    process.env.RATE_LIMIT_WINDOW_MS = "5000";
    expect(envFromProcess().security.rateLimit).toEqual({
      max: 10,
      windowMs: 5000,
    });
  });

  it("defaults the read rate limit to 240 req/min (S2)", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    expect(envFromProcess().security.rateLimitRead).toEqual({
      max: 240,
      windowMs: 60_000,
    });
  });

  it("rejects non-numeric RATE_LIMIT_READ_MAX instead of silently disabling the limiter", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.RATE_LIMIT_READ_MAX = "lots";
    expect(() => envFromProcess()).toThrow(/RATE_LIMIT_READ_MAX/);
  });

  it("rejects non-positive RATE_LIMIT_READ_WINDOW_MS", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.RATE_LIMIT_READ_WINDOW_MS = "-5";
    expect(() => envFromProcess()).toThrow(/RATE_LIMIT_READ_WINDOW_MS/);
  });

  it("reads RATE_LIMIT_READ_MAX and RATE_LIMIT_READ_WINDOW_MS", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RATE_LIMIT_READ_MAX = "500";
    process.env.RATE_LIMIT_READ_WINDOW_MS = "30000";
    expect(envFromProcess().security.rateLimitRead).toEqual({
      max: 500,
      windowMs: 30_000,
    });
  });
});

describe("envFromProcess — receipt storage + upload limits (receipt-scan-drafts T3, D2)", () => {
  it("defaults to the local driver with a temp quarantine dir when unset (dev)", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    const env = envFromProcess();
    expect(env.receipts.storage.driver).toBe("local");
    if (env.receipts.storage.driver === "local") {
      expect(env.receipts.storage.dir.length).toBeGreaterThan(0);
      // Default local dir is the repo-local s3/tickets (L18); absolute
      // because composition resolves it against apps/api.
      expect(env.receipts.storage.dir).toContain("s3");
      expect(env.receipts.storage.dir).toContain("tickets");
    }
    expect(env.receipts.maxBytes).toBe(5 * 1024 * 1024);
  });

  it("reads RECEIPT_STORAGE_DIR and RECEIPT_MAX_BYTES for the local driver", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.STORAGE_DRIVER = "local";
    process.env.RECEIPT_STORAGE_DIR = "/var/lib/tfm/receipts";
    process.env.RECEIPT_MAX_BYTES = "1048576";
    const env = envFromProcess();
    expect(env.receipts.storage).toEqual({
      driver: "local",
      dir: "/var/lib/tfm/receipts",
    });
    expect(env.receipts.maxBytes).toBe(1_048_576);
  });

  it("rejects a non-positive RECEIPT_MAX_BYTES instead of silently disabling quarantine", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.RECEIPT_MAX_BYTES = "0";
    expect(() => envFromProcess()).toThrow(/RECEIPT_MAX_BYTES/);
  });

  it("fails closed on an unknown STORAGE_DRIVER", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.STORAGE_DRIVER = "ftp";
    expect(() => envFromProcess()).toThrow(/STORAGE_DRIVER/);
  });

  it("fails fast when STORAGE_DRIVER=s3 is missing its config", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.STORAGE_DRIVER = "s3";
    expect(() => envFromProcess()).toThrow(/S3_/);
  });

  it("reads the full s3 driver config", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://proj.supabase.co/storage/v1/s3";
    process.env.S3_REGION = "eu-west-1";
    process.env.RECEIPT_S3_BUCKET = "receipts-quarantine";
    process.env.S3_ACCESS_KEY_ID = "ak";
    process.env.S3_SECRET_ACCESS_KEY = "sk";
    const env = envFromProcess();
    expect(env.receipts.storage).toEqual({
      driver: "s3",
      endpoint: "https://proj.supabase.co/storage/v1/s3",
      region: "eu-west-1",
      bucket: "receipts-quarantine",
      accessKeyId: "ak",
      secretAccessKey: "sk",
    });
  });
});

/**
 * demo-maria-login T1 (S4): POST /api/v1/demo/reset exists ONLY under
 * AUTH_MODE=dev — same fail-closed policy as the x-dev-user dev caller.
 * The DB target is deliberately unreachable (127.0.0.1:1 refuses
 * instantly): in oidc mode the request must 404 without touching the DB,
 * and in dev mode reaching the seeder surfaces as a 500 — never a 404 —
 * which proves the route is mounted.
 */
describe("POST /api/v1/demo/reset mounting (demo-maria-login T1, S4)", () => {
  const unreachableDbEnv = (
    authMode: AppEnv["authMode"],
  ): AppEnv => ({
    databaseUrl: "postgresql://u:p@127.0.0.1:1/unreachable",
    authMode,
    ...(authMode === "oidc"
      ? {
          oidc: {
            issuer: "https://issuer.example",
            audience: "aud",
            jwksUri: "https://issuer.example/jwks.json",
          },
        }
      : {}),
    security: {
      corsOrigins: [],
      bodyLimitBytes: 1024,
      rateLimit: { max: 0, windowMs: 60_000 },
      rateLimitRead: { max: 0, windowMs: 60_000 },
      receiptUploadBodyLimitBytes: 1024,
    },
    receipts: {
      maxBytes: 1024,
      storage: { driver: "local", dir: "/tmp/tfm-demo-reset-spec" },
      scanDispatcher: { mode: "pgboss" },
    },
  });

  it("answers 404 in oidc mode — the route is never mounted", async () => {
    const built = buildApp(unreachableDbEnv("oidc"));
    try {
      const res = await built.app.request("/api/v1/demo/reset", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    } finally {
      await built.close();
    }
  });

  it("mounts the route in dev mode — the request reaches the seeder", async () => {
    const built = buildApp(unreachableDbEnv("dev"));
    try {
      const res = await built.app.request("/api/v1/demo/reset", {
        method: "POST",
      });
      // The unreachable DB makes the seeder fail → 500; a missing route
      // would have answered 404 instead.
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code: string }).code).toBe(
        "INTERNAL_ERROR",
      );
    } finally {
      await built.close();
    }
  });
});

describe("envFromProcess — RECEIPT_SCAN_DISPATCHER (receipt-scan-drafts T14, S13)", () => {
  it("defaults to pgboss when unset and does NOT require GEMINI_API_KEY", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    // GEMINI_API_KEY stays worker-only in pgboss mode.
    const env = envFromProcess();
    expect(env.receipts.scanDispatcher).toEqual({ mode: "pgboss" });
  });

  it("accepts the explicit pgboss value", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RECEIPT_SCAN_DISPATCHER = "pgboss";
    expect(envFromProcess().receipts.scanDispatcher).toEqual({
      mode: "pgboss",
    });
  });

  it("fails closed on an unknown dispatcher value", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RECEIPT_SCAN_DISPATCHER = "sqs";
    expect(() => envFromProcess()).toThrow(/RECEIPT_SCAN_DISPATCHER/);
  });

  it("parses inline with the required GEMINI_API_KEY and the default model", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RECEIPT_SCAN_DISPATCHER = "inline";
    process.env.GEMINI_API_KEY = "sk-inline";
    expect(envFromProcess().receipts.scanDispatcher).toEqual({
      mode: "inline",
      gemini: {
        apiKey: "sk-inline",
        model: "gemini-3.5-flash-lite",
      },
    });
  });

  it("honours GEMINI_MODEL override in inline mode", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RECEIPT_SCAN_DISPATCHER = "inline";
    process.env.GEMINI_API_KEY = "sk-inline";
    process.env.GEMINI_MODEL = "gemini-custom";
    expect(envFromProcess().receipts.scanDispatcher).toEqual({
      mode: "inline",
      gemini: {
        apiKey: "sk-inline",
        model: "gemini-custom",
      },
    });
  });

  it("fails fast at boot when inline is set without GEMINI_API_KEY", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.AUTH_MODE = "dev";
    process.env.RECEIPT_SCAN_DISPATCHER = "inline";
    expect(() => envFromProcess()).toThrow(/GEMINI_API_KEY/);
  });
});
