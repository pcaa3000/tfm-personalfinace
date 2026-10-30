import type {
  CategoryView,
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

export function listTransactions(): Promise<TransactionView[]> {
  return request<TransactionView[]>("/transactions");
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
