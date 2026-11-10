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
    accountId: "acc-1",
    categoryId: null,
    idempotencyKey: `test-${crypto.randomUUID()}`,
    ...overrides,
  };
}

/**
 * Unsigned JWT carrying `sub` so specs can fake distinct caller subjects
 * through the access-token provider without touching Supabase.
 */
export function jwtFixture(sub: string): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub })}.sig`;
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
    accountId: "acc-1",
    destinationAccountId: null,
    categoryId: null,
    status: "confirmed",
    origin: "manual",
    confirmedAt: new Date().toISOString(),
    revisionCount: 0,
    ...overrides,
  };
}
