import { describe, expect, it } from "vitest";

import type { Clock, IdGenerator } from "../../ledger/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import { ClosePeriodUseCase } from "./close-period.use-case.js";

class InMemoryPeriodCloses implements PeriodCloseRepositoryPort {
  saved: PeriodClose[] = [];

  constructor(readonly stored: PeriodClose[] = []) {}

  async findActiveByPeriod(
    workspaceId: WorkspaceId,
    currency: string,
    periodStart: string,
  ) {
    return (
      this.stored.find(
        (c) =>
          c.workspaceId.equals(workspaceId) &&
          c.currency === currency &&
          c.periodStart === periodStart &&
          c.supersededAt === null,
      ) ?? null
    );
  }

  async listActive(workspaceId: WorkspaceId, currency?: string) {
    return this.stored.filter(
      (c) =>
        c.workspaceId.equals(workspaceId) &&
        c.supersededAt === null &&
        (currency === undefined || c.currency === currency),
    );
  }

  async invalidateCovering() {
    return 0;
  }

  async save(close: PeriodClose) {
    this.saved.push(close);
    const index = this.stored.findIndex((c) => c.id === close.id);
    if (index >= 0) {
      this.stored[index] = close;
    } else {
      this.stored.push(close);
    }
  }

  failNextSaveWith23505 = false;
  failNextSaveWithWrapped23505 = false;

  async saveSuperseding(created: PeriodClose, superseded: PeriodClose | null) {
    if (this.failNextSaveWith23505) {
      this.failNextSaveWith23505 = false;
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    if (this.failNextSaveWithWrapped23505) {
      this.failNextSaveWithWrapped23505 = false;
      throw Object.assign(new Error("query failed"), {
        cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
      });
    }
    if (superseded !== null) {
      await this.save(superseded);
    }
    await this.save(created);
  }
}

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

const clock = (iso: string): Clock => ({ now: () => new Date(iso) });
const ids = (next: string): IdGenerator => {
  let n = 0;
  return { next: () => `${next}-${(n += 1)}` };
};

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

const baseCommand = {
  workspaceId: ws,
  currency: "EUR",
  year: 2026,
  month: 9,
  timezone: "UTC",
  integrityConfirmed: true,
  actor: "subject-1",
};

describe("ClosePeriodUseCase", () => {
  it("closes a calendar month fully ended in the workspace timezone", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("close-1");
    expect(result.value.currency).toBe("EUR");
    expect(result.value.periodStart).toBe("2026-09-01");
    expect(result.value.periodEnd).toBe("2026-09-30");
    expect(result.value.timezone).toBe("UTC");
    expect(result.value.integrityDeclared).toBe(true);
    expect(result.value.closedAt).toBe("2026-10-15T12:00:00.000Z");
    expect(result.value.invalidatedAt).toBeNull();
    expect(result.value.supersededAt).toBeNull();
    expect(result.value.stale).toBe(false);
    expect(repo.saved).toHaveLength(1);
  });

  it("computes the real month length for the period bounds", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-03-10T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({ ...baseCommand, month: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.periodStart).toBe("2026-02-01");
    expect(result.value.periodEnd).toBe("2026-02-28");
  });

  it("rejects the month currently in progress", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({ ...baseCommand, month: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_NOT_FINISHED");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects a month that ended in UTC but not yet in the workspace timezone", async () => {
    // 2026-10-01T00:30Z is still 2026-09-30 19:30 in America/Lima (UTC-5):
    // September has not fully ended there, so the close must be refused.
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-01T00:30:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({
      ...baseCommand,
      timezone: "America/Lima",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_NOT_FINISHED");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("accepts the same instant when the workspace timezone shows it ended", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-01T00:30:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({ ...baseCommand, timezone: "UTC" });

    expect(result.ok).toBe(true);
  });

  it("rejects a future month", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({ ...baseCommand, month: 12 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_NOT_FINISHED");
    }
  });

  it("rejects when the integrity declaration is missing", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({
      ...baseCommand,
      integrityConfirmed: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_CLOSE_INTEGRITY_REQUIRED");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects an out-of-range month", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    for (const month of [0, 13]) {
      const result = await useCase.execute({ ...baseCommand, month });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PERIOD_INVALID");
      }
    }
  });

  it("rejects an invalid currency code", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({ ...baseCommand, currency: "EU1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    }
  });

  it("rejects an invalid workspace timezone", async () => {
    const repo = new InMemoryPeriodCloses();
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute({
      ...baseCommand,
      timezone: "Mars/Olympus",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TIMEZONE_INVALID");
    }
  });

  it("rejects closing a period that already has an up-to-date close", async () => {
    const repo = new InMemoryPeriodCloses([storedClose()]);
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_ALREADY_CLOSED");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("supersedes a stale (invalidated) close for the same period", async () => {
    const stale = storedClose({
      id: "close-stale",
      invalidatedAt: new Date("2026-10-05T10:00:00Z"),
    });
    const repo = new InMemoryPeriodCloses([stale]);
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("close-1");
    expect(result.value.supersededAt).toBeNull();
    expect(result.value.stale).toBe(false);
    expect(stale.supersededAt).toEqual(new Date("2026-10-15T12:00:00Z"));
    // The stale row update and the new insert both go through save().
    expect(repo.saved).toHaveLength(2);
  });

  it("maps a Drizzle-wrapped unique violation (code on cause) to PERIOD_ALREADY_CLOSED", async () => {
    const repo = new InMemoryPeriodCloses();
    repo.failNextSaveWithWrapped23505 = true;
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PERIOD_ALREADY_CLOSED");
  });

  it("maps a unique-index violation on insert to PERIOD_ALREADY_CLOSED", async () => {
    const repo = new InMemoryPeriodCloses();
    repo.failNextSaveWith23505 = true;
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PERIOD_ALREADY_CLOSED");
    // R4-003: the client can tell its close was not applied — a 409,
    // never a raw 500 from the partial unique index.
  });

  it("does not collide with a close of another currency for the same period", async () => {
    const repo = new InMemoryPeriodCloses([
      storedClose({ currency: "USD" }),
    ]);
    const useCase = new ClosePeriodUseCase(
      repo,
      clock("2026-10-15T12:00:00Z"),
      ids("close"),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
  });
});
