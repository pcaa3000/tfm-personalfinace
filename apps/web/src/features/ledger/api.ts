import type {
  AccountView,
  CategoryView,
  CreateAccountInput,
  WorkspaceView,
  CreateTransactionInput,
  ReviseTransactionInput,
  TransactionRevisionView,
  TransactionView,
} from "./types";

const BASE = "/api/v1";

/** API rejection carrying the server error code for localized display. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const payload = (await response.json().catch(() => null)) as
    | ({ code?: string; message?: string } & T)
    | null;
  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && "code" in payload
        ? String(payload.code)
        : `HTTP_${response.status}`;
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Request failed with status ${response.status}`;
    throw new ApiError(code, message, response.status);
  }
  return payload as T;
}

export function createTransaction(input: CreateTransactionInput): Promise<TransactionView> {
  return request<TransactionView>("/transactions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface TransactionListFilters {
  q?: string | undefined;
  type?: "income" | "expense" | undefined;
  currency?: string | undefined;
  category?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export function listTransactions(
  filters: TransactionListFilters = {},
): Promise<TransactionView[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return request<TransactionView[]>(`/transactions${qs ? `?${qs}` : ""}`);
}

export function listAccounts(): Promise<AccountView[]> {
  return request<AccountView[]>("/accounts");
}
export function createAccount(input: CreateAccountInput): Promise<AccountView> {
  return request<AccountView>("/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function getWorkspace(): Promise<WorkspaceView> {
  return request<WorkspaceView>("/workspace");
}
export function updateDefaultCurrency(currency: string): Promise<WorkspaceView> {
  return request<WorkspaceView>("/workspace", {
    method: "PATCH",
    body: JSON.stringify({ defaultCurrency: currency }),
  });
}
export function listCategories(): Promise<CategoryView[]> {
  return request<CategoryView[]>("/categories");
}

export function reviseTransaction(
  id: string,
  input: ReviseTransactionInput,
): Promise<TransactionView> {
  return request<TransactionView>(`/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function voidTransaction(id: string): Promise<TransactionView> {
  return request<TransactionView>(`/transactions/${id}/void`, {
    method: "POST",
  });
}

export function listTransactionRevisions(
  id: string,
): Promise<TransactionRevisionView[]> {
  return request<TransactionRevisionView[]>(`/transactions/${id}/revisions`);
}
