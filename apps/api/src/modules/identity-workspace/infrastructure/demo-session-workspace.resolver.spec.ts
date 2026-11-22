import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { workspaces } from "../../../drizzle/schema.js";
import type {
  CallerIdentity,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../application/workspace-context.port.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DemoSessionError } from "../application/demo-session.error.js";
import { DemoSessionWorkspaceResolver } from "./demo-session-workspace.resolver.js";

/**
 * demo-maria-session T6 (S5, restored from the L3 model — L10 decision
 * B): for the DEMO_SUBJECT, workspace resolution must come from the
 * `x-demo-session` sid — `issuer|subject|sid` must be an existing
 * kind='demo' workspace owned by that subject. Missing or invalid sid
 * fails closed (DemoSessionError → 403); the resolver NEVER falls back
 * to the shared `issuer|subject` workspace nor lazily creates it.
 * Non-demo callers delegate unchanged.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const ISSUER = "demo-resolver-spec";
const DEMO_SUBJECT = "maria";
const DEMO_IDENTITY_KEYS = [
  `${ISSUER}|${DEMO_SUBJECT}|sid-good`,
  `${ISSUER}|${DEMO_SUBJECT}|sid-personal`,
];

function caller(
  subject: string,
  demoSessionId?: string,
): CallerIdentity {
  return {
    issuer: ISSUER,
    subject,
    ...(demoSessionId === undefined ? {} : { demoSessionId }),
  };
}

function makeInner(): {
  inner: WorkspaceContextPort;
  resolve: ReturnType<typeof vi.fn>;
} {
  const context: WorkspaceContext = {
    workspaceId: (() => {
      const id = WorkspaceId.create("ws-inner");
      if (!id.ok) throw id.error;
      return id.value;
    })(),
    timezone: "UTC",
    defaultCurrency: "USD",
  };
  const resolve = vi.fn(async () => context);
  return { inner: { resolve }, resolve };
}

describe("DemoSessionWorkspaceResolver (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);

  beforeAll(async () => {
    await db
      .delete(workspaces)
      .where(inArray(workspaces.identityKey, DEMO_IDENTITY_KEYS));
    await db.insert(workspaces).values([
      {
        id: "ws-demo-resolver-good",
        identityKey: `${ISSUER}|${DEMO_SUBJECT}|sid-good`,
        kind: "demo",
        timezone: "America/Lima",
        defaultCurrency: "PEN",
      },
      {
        id: "ws-demo-resolver-personal",
        identityKey: `${ISSUER}|${DEMO_SUBJECT}|sid-personal`,
        kind: "personal",
        timezone: "UTC",
        defaultCurrency: "PEN",
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(workspaces)
      .where(inArray(workspaces.identityKey, DEMO_IDENTITY_KEYS));
    await pool.end();
  });

  function resolverWith(inner: WorkspaceContextPort, demoSubject?: string) {
    return new DemoSessionWorkspaceResolver(db as DrizzleDb, inner, demoSubject);
  }

  it("delegates non-demo subjects to the inner resolver untouched", async () => {
    const { inner, resolve } = makeInner();
    const resolver = resolverWith(inner, DEMO_SUBJECT);

    const context = await resolver.resolve(caller("dev-user", "sid-ignored"));

    expect(resolve).toHaveBeenCalledWith(caller("dev-user", "sid-ignored"));
    expect(context.workspaceId.value).toBe("ws-inner");
  });

  it("delegates EVERYTHING to the inner resolver when no demo subject is configured", async () => {
    const { inner, resolve } = makeInner();
    const resolver = resolverWith(inner, undefined);

    await resolver.resolve(caller(DEMO_SUBJECT));

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed for the demo subject without an x-demo-session sid", async () => {
    const { inner, resolve } = makeInner();
    const resolver = resolverWith(inner, DEMO_SUBJECT);

    await expect(resolver.resolve(caller(DEMO_SUBJECT))).rejects.toThrow(
      DemoSessionError,
    );
    await expect(
      resolver.resolve(caller(DEMO_SUBJECT)),
    ).rejects.toMatchObject({ code: "DEMO_SESSION_REQUIRED" });
    // Fail-closed means the inner lazy-create path never runs.
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed when the sid does not match a demo workspace of the subject", async () => {
    const { inner, resolve } = makeInner();
    const resolver = resolverWith(inner, DEMO_SUBJECT);

    await expect(
      resolver.resolve(caller(DEMO_SUBJECT, "sid-unknown")),
    ).rejects.toMatchObject({ code: "DEMO_SESSION_INVALID" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a sid whose workspace is not kind='demo'", async () => {
    const { inner, resolve } = makeInner();
    const resolver = resolverWith(inner, DEMO_SUBJECT);

    await expect(
      resolver.resolve(caller(DEMO_SUBJECT, "sid-personal")),
    ).rejects.toMatchObject({ code: "DEMO_SESSION_INVALID" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves the ephemeral demo workspace for a valid sid", async () => {
    const { inner, resolve } = makeInner();
    const resolver = resolverWith(inner, DEMO_SUBJECT);

    const context = await resolver.resolve(
      caller(DEMO_SUBJECT, "sid-good"),
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(context.workspaceId.value).toBe("ws-demo-resolver-good");
    expect(context.timezone).toBe("America/Lima");
    expect(context.defaultCurrency).toBe("PEN");
  });

  it("never creates the shared `issuer|subject` workspace for the demo subject", async () => {
    const { inner } = makeInner();
    const resolver = resolverWith(inner, DEMO_SUBJECT);

    await expect(
      resolver.resolve(caller(DEMO_SUBJECT, "sid-unknown")),
    ).rejects.toThrow(DemoSessionError);

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, `${ISSUER}|${DEMO_SUBJECT}`));
    // The bare two-segment identityKey the lazy path would have created
    // must never exist for the demo subject.
    expect(rows).toHaveLength(0);
  });
});
