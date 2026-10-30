import type { CreateTransactionInput, TransactionView } from "../types";

export function inputFixture(
  overrides: Partial<CreateTransactionInput> = {},
): CreateTransactionInput {
  return {
    type: "expense",
    amount: "12.50",
    currency: "USD",
    businessDate: "2026-10-01",
    timezone: "UTC",
    concept: "test lunch",
    categoryId: null,
    idempotencyKey: `test-${crypto.randomUUID()}`,
    ...overrides,
  };
}

export function viewFixture(
  overrides: Partial<TransactionView> = {},
): TransactionView {
  return {
    id: crypto.randomUUID(),
    workspaceId: "ws-test",
    type: "expense",
    amount: "12.50",
    currency: "USD",
    businessDate: "2026-10-01",
    timezone: "UTC",
    concept: "test lunch",
    categoryId: null,
    status: "confirmed",
    origin: "manual",
    confirmedAt: new Date().toISOString(),
    revisionCount: 0,
    ...overrides,
  };
}
