import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { rateLimitMiddleware } from "./rate-limit.js";

/**
 * S5 (GAP-SEC-05): in-memory fixed-window limiter keyed by client IP
 * (x-forwarded-for), applied to write methods. Exceeding the configured
 * max inside the window returns the 429 {code:"RATE_LIMITED"} envelope.
 */

function buildApp(options: {
  max: number;
  windowMs: number;
  now?: () => number;
  clientKey?: () => string;
}) {
  const app = new Hono();
  app.use("/api/v1/*", rateLimitMiddleware(options));
  app.post("/api/v1/things", (c) => c.json({ ok: true }, 201));
  app.get("/api/v1/things", (c) => c.json({ ok: true }));
  return app;
}

const IP = { "x-forwarded-for": "203.0.113.10" };

describe("rateLimitMiddleware (S5)", () => {
  it("stays functional and bounded when the map exceeds MAX_TRACKED_CLIENTS (R4-001)", async () => {
    // A client rotating x-forwarded-for must not grow the map without
    // bound: expired entries are swept; if none are expired the oldest
    // entry is evicted so the map stays capped.
    const app = buildApp({ max: 60, windowMs: 60_000 });
    for (let i = 0; i < 10_001; i += 1) {
      const res = await app.request("/api/v1/things", {
        method: "POST",
        headers: { "x-forwarded-for": `198.51.100.${i % 256}.${i >> 8}` },
        body: "{}",
      });
      expect(res.status).not.toBe(429);
    }
    const res = await app.request("/api/v1/things", {
      method: "POST",
      headers: IP,
      body: "{}",
    });
    expect(res.status).toBe(201);
  }, 30_000);

  it("keys windows per resolved client address, not one shared bucket (R4-002)", async () => {
    // Without x-forwarded-for the limiter must fall back to the
    // connection remote address — otherwise every user shares the
    // literal "unknown" bucket and global traffic 429s everyone.
    let address = "10.0.0.9";
    const app = buildApp({
      max: 1,
      windowMs: 60_000,
      clientKey: () => address,
    });
    const post = () =>
      app.request("/api/v1/things", { method: "POST", body: "{}" });
    expect((await post()).status).toBe(201);
    address = "10.0.0.10";
    expect((await post()).status).toBe(201);
  });

  it("allows up to max writes then rejects with 429 RATE_LIMITED", async () => {
    const app = buildApp({ max: 2, windowMs: 60_000 });
    const post = () =>
      app.request("/api/v1/things", {
        method: "POST",
        headers: { ...IP, "content-type": "application/json" },
        body: "{}",
      });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
  });

  it("does not count read methods against the write budget", async () => {
    const app = buildApp({ max: 1, windowMs: 60_000 });
    expect((await app.request("/api/v1/things", { headers: IP })).status).toBe(
      200,
    );
    expect((await app.request("/api/v1/things", { headers: IP })).status).toBe(
      200,
    );
  });

  it("keeps independent buckets per client IP", async () => {
    const app = buildApp({ max: 1, windowMs: 60_000 });
    const post = (ip: string) =>
      app.request("/api/v1/things", {
        method: "POST",
        headers: { "x-forwarded-for": ip, "content-type": "application/json" },
        body: "{}",
      });

    expect((await post("203.0.113.1")).status).toBe(201);
    expect((await post("203.0.113.2")).status).toBe(201);
    expect((await post("203.0.113.1")).status).toBe(429);
  });

  it("resets the window after windowMs elapses", async () => {
    let now = 1_000;
    const app = buildApp({ max: 1, windowMs: 60_000, now: () => now });
    const post = () =>
      app.request("/api/v1/things", {
        method: "POST",
        headers: { ...IP, "content-type": "application/json" },
        body: "{}",
      });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
    now += 60_001;
    expect((await post()).status).toBe(201);
  });
});
