import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { envFromProcess } from "./composition.js";

/**
 * S3 (GAP-SEC-01): unknown/missing AUTH_MODE fails closed at boot.
 * S8 (NEW-SEC-13): missing DATABASE_URL fails fast, no localhost fallback.
 * S4/S5: CORS allowlist + rate-limit knobs come from env with dev defaults.
 */

const ENV_KEYS = [
  "DATABASE_URL",
  "AUTH_MODE",
  "OIDC_ISSUER",
  "OIDC_AUDIENCE",
  "OIDC_JWKS_URI",
  "CORS_ORIGINS",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
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
});
