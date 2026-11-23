import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import { ListPeriodClosesUseCase } from "./list-period-closes.use-case.js";

class InMemoryPeriodCloses implements PeriodCloseRepositoryPort {
  constructor(readonly stored: PeriodClose[] = []) {}

  async findActiveByPeriod() {
    return null;
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

  async save() {}

  async saveSuperseding() {}
}

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

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

describe("ListPeriodClosesUseCase", () => {
  it("returns active closes newest period first with the stale flag", async () => {
    const repo = new InMemoryPeriodCloses([
      storedClose({
        id: "close-aug",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        invalidatedAt: new Date("2026-10-02T09:00:00Z"),
      }),
      storedClose({ id: "close-sep" }),
      // Superseded rows are not the latest close of their period.
      storedClose({
        id: "close-sep-old",
        periodStart: "2026-09-01",
        supersededAt: new Date("2026-10-10T09:00:00Z"),
      }),
      storedClose({ id: "close-usd", currency: "USD" }),
    ]);
    const useCase = new ListPeriodClosesUseCase(repo);

    const views = await useCase.execute(ws, "EUR");

    expect(views.map((v) => v.id)).toEqual(["close-sep", "close-aug"]);
    expect(views[0]?.stale).toBe(false);
    expect(views[1]?.stale).toBe(true);
    expect(views[1]?.invalidatedAt).toBe("2026-10-02T09:00:00.000Z");
  });

  it("returns every active close when no currency filter is given", async () => {
    const repo = new InMemoryPeriodCloses([
      storedClose({ id: "close-eur" }),
      storedClose({ id: "close-usd", currency: "USD" }),
    ]);
    const useCase = new ListPeriodClosesUseCase(repo);

    const views = await useCase.execute(ws);

    expect(views.map((v) => v.id).sort()).toEqual(["close-eur", "close-usd"]);
  });
});
