import { randomUUID } from "node:crypto";

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
  closeTestDb,
  type AccountView,
  type ApiResponse,
  type E2eApp,
} from "./e2e-helpers.js";

const MARKER = "|e2e-bal-";
const ALICE = { "x-dev-user": "e2e-bal-alice" };

interface BalanceItemView {
  currency: string;
  initialBalance: string;
  income: string;
  expenses: string;
  net: string;
  balance: string;
}

let app: E2eApp;

beforeAll(async () => {
  app = await bootApp();
});

afterAll(async () => {
  await closeTestDb();
  await app.close();
});

beforeEach(async () => {
  await cleanE2eData(MARKER);
});

function txPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: accountId,
    type: "expense",
    amount: "10.00",
    currency: "PEN",
    businessDate: "2026-10-01",
    timezone: "UTC",
    concept: `e2e balance ${randomUUID()}`,
    idempotencyKey: `e2e-bal-${randomUUID()}`,
    ...overrides,
  };
}

let accountId = "";

describe("GET /api/v1/balance", () => {
  it("aggregates initial balances and confirmed income/expenses per currency", async () => {
    const account: ApiResponse<AccountView> = await api("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: {
        name: `${MARKER}banco`,
        currency: "PEN",
        initialBalance: "5000.00",
      },
    });
    expect(account.status).toBe(201);
    accountId = account.body.id;

    const income = await api("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ type: "income", amount: "4500.00" }),
    });
    expect(income.status).toBe(201);
    const expense = await api("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ type: "expense", amount: "565.75" }),
    });
    expect(expense.status).toBe(201);
    // Transfers are net-0 in the currency balance — create a second account
    // to satisfy the destination and confirm the transfer does not skew it.
    const second: ApiResponse<AccountView> = await api("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: {
        name: `${MARKER}efectivo`,
        currency: "PEN",
        initialBalance: "200.00",
      },
    });
    expect(second.status).toBe(201);
    const transfer = await api("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({
        type: "transfer",
        amount: "300.00",
        destinationAccountId: second.body.id,
      }),
    });
    expect(transfer.status).toBe(201);

    const res = await api<BalanceItemView[]>("/api/v1/balance", {
      headers: ALICE,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        currency: "PEN",
        initialBalance: "5200.00",
        income: "4500.00",
        expenses: "565.75",
        net: "3934.25",
        balance: "9134.25",
      },
    ]);
  });
});
