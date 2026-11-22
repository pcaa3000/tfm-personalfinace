import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import { resolveReportPeriod } from "./resolve-report-period.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

const clock = (iso: string) => ({ now: () => new Date(iso) });

function storedClose(
  overrides: Partial<Parameters<typeof PeriodClose.reconstitute>[0]> = {},
): PeriodClose {
  return PeriodClose.reconstitute({
    id: "close-0",
    workspaceId: ws,
    currency: "EUR",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    timezone: "UTC",
    integrityDeclared: true,
    closedAt: new Date("2026-10-01T10:00:00Z"),
    invalidatedAt: null,
    supersededAt: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  });
}

/** Mirrors the repository contract: only non-superseded rows are "active". */
function closesReturning(stored: PeriodClose[]) {
  return {
    async findActiveByPeriod(
      workspaceId: WorkspaceId,
      currency: string,
      periodStart: string,
    ) {
      return (
        stored.find(
          (c) =>
            c.workspaceId.equals(workspaceId) &&
            c.currency === currency &&
            c.periodStart === periodStart &&
            c.supersededAt === null,
        ) ?? null
      );
    },
  };
}

const baseInput = {
  workspaceId: ws,
  currency: "EUR",
  year: 2026,
  month: 9,
  timezone: "UTC",
};

describe("resolveReportPeriod", () => {
  it("marks a finished month without close as provisional over the full month", async () => {
    const result = await resolveReportPeriod(
      closesReturning([]),
      clock("2026-10-15T12:00:00Z"),
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "EUR",
      periodStatus: "provisional",
    });
  });

  it("marks a finished month with an active close as closed over the full month", async () => {
    const result = await resolveReportPeriod(
      closesReturning([storedClose()]),
      clock("2026-10-15T12:00:00Z"),
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "EUR",
      periodStatus: "closed",
    });
  });

  it("marks a finished month whose close went stale as provisional", async () => {
    const stale = storedClose({
      invalidatedAt: new Date("2026-10-05T10:00:00Z"),
    });
    const result = await resolveReportPeriod(
      closesReturning([stale]),
      clock("2026-10-15T12:00:00Z"),
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.periodStatus).toBe("provisional");
    expect(result.value.from).toBe("2026-09-01");
    expect(result.value.to).toBe("2026-09-30");
  });

  it("marks a finished month whose close was superseded as provisional", async () => {
    const superseded = storedClose({
      supersededAt: new Date("2026-10-06T10:00:00Z"),
    });
    const result = await resolveReportPeriod(
      closesReturning([superseded]),
      clock("2026-10-15T12:00:00Z"),
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.periodStatus).toBe("provisional");
  });

  it("marks the running month as provisional over the last 30 days in workspace timezone", async () => {
    // Clock at 2026-10-15 UTC; requesting October → rolling 30-day window.
    const result = await resolveReportPeriod(
      closesReturning([]),
      clock("2026-10-15T12:00:00Z"),
      { ...baseInput, month: 10 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      from: "2026-09-16",
      to: "2026-10-15",
      currency: "EUR",
      periodStatus: "provisional",
    });
  });

  it("anchors the provisional window to the workspace-local day, not UTC", async () => {
    // 2026-10-01T00:30Z is still 2026-09-30 19:30 in America/Lima: the
    // running month there is September — asking for September must yield
    // the rolling 30-day window ending on the local date.
    const result = await resolveReportPeriod(
      closesReturning([]),
      clock("2026-10-01T00:30:00Z"),
      { ...baseInput, timezone: "America/Lima" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "EUR",
      periodStatus: "provisional",
    });
  });

  it("treats the same instant as a finished month when the workspace is UTC", async () => {
    const result = await resolveReportPeriod(
      closesReturning([]),
      clock("2026-10-01T00:30:00Z"),
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.from).toBe("2026-09-01");
    expect(result.value.to).toBe("2026-09-30");
  });

  it("rejects an invalid currency code", async () => {
    const result = await resolveReportPeriod(
      closesReturning([]),
      clock("2026-10-15T12:00:00Z"),
      { ...baseInput, currency: "EU1" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    }
  });

  it("rejects an out-of-range month", async () => {
    for (const month of [0, 13]) {
      const result = await resolveReportPeriod(
        closesReturning([]),
        clock("2026-10-15T12:00:00Z"),
        { ...baseInput, month },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PERIOD_INVALID");
      }
    }
  });

  it("rejects an invalid workspace timezone", async () => {
    const result = await resolveReportPeriod(
      closesReturning([]),
      clock("2026-10-15T12:00:00Z"),
      { ...baseInput, timezone: "Mars/Olympus" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TIMEZONE_INVALID");
    }
  });
});
