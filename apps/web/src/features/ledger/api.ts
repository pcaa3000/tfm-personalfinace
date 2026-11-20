import { isAuthBypassed } from "../auth/supabase";
import type {
  ReceiptConfirmInput,
  ReceiptDraftPayload,
  ReceiptListPageView,
  ReceiptScanView,
} from "./receipt-draft";
import type {
  AccountView,
  BalanceItemView,
  CategoryView,
  CreateAccountInput,
  CreateCategoryInput,
  CurrencyView,
  IsoCurrencyView,
  ReviseAccountInput,
  ReviseCategoryInput,
  TransactionType,
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

/**
 * Injectable bearer-token provider (T6-web). The auth module wires it to
 * the current Supabase session; dev mode (no provider) sends no header.
 */
export type AccessTokenProvider = () => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

export function setAccessTokenProvider(
  provider: AccessTokenProvider | null,
): void {
  accessTokenProvider = provider;
}

/** Decodes the `sub` claim of a JWT payload; null when not a JWT. */
function jwtSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
    ) as { sub?: unknown };
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

/**
 * Current authenticated subject (GAP-SEC-08): the `sub` claim of the
 * bearer token, resolved through the same provider the API client uses.
 * The offline queue binds each item to this value so a different session
 * can never drain it. Non-JWT tokens degrade to raw-token equality,
 * which fails closed (orphaned items are dropped, never sent).
 * Returns null when no provider is wired (dev bypass / signed out).
 */
export async function currentCallerSubject(): Promise<string | null> {
  const token = accessTokenProvider ? await accessTokenProvider() : null;
  if (!token) return null;
  return jwtSubject(token) ?? token;
}

async function parseResponse<T>(response: Response): Promise<T> {
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

async function authHeaders(): Promise<Record<string, string>> {
  const token = accessTokenProvider ? await accessTokenProvider() : null;
  if (token) return { authorization: `Bearer ${token}` };
  // Dev bypass (T26): AUTH_MODE=dev is fail-closed and requires the
  // `x-dev-user` header (GAP-SEC-01). `dev-user` is the seeded subject
  // (apps/api/src/drizzle/seed.ts). Never emitted outside dev builds.
  if (isAuthBypassed()) return { "x-dev-user": "dev-user" };
  return {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(await authHeaders()),
  };
  const response = await fetch(`${BASE}${path}`, {
    headers,
    ...init,
  });
  return parseResponse<T>(response);
}

/**
 * Multipart variant (receipt-scan-drafts T7): FormData bodies carry
 * their own `multipart/form-data; boundary=` content type — setting a
 * JSON content type would corrupt the upload.
 */
async function requestMultipart<T>(
  path: string,
  form: FormData,
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  return parseResponse<T>(response);
}

/** `GET /api/v1/balance` — per-currency aggregates for the strip (T24). */
export function fetchBalance(): Promise<BalanceItemView[]> {
  return request<BalanceItemView[]>("/balance");
}

export function createTransaction(input: CreateTransactionInput): Promise<TransactionView> {
  return request<TransactionView>("/transactions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface TransactionListFilters {
  q?: string | undefined;
  type?: TransactionType | undefined;
  currency?: string | undefined;
  category?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function listTransactions(
  filters: TransactionListFilters = {},
): Promise<TransactionView[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return request<TransactionView[]>(`/transactions${qs ? `?${qs}` : ""}`);
}

export function listAccounts(options?: {
  includeArchived?: boolean;
}): Promise<AccountView[]> {
  const qs = options?.includeArchived ? "?includeArchived=true" : "";
  return request<AccountView[]>(`/accounts${qs}`);
}
export function createAccount(input: CreateAccountInput): Promise<AccountView> {
  return request<AccountView>("/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function reviseAccount(
  id: string,
  input: ReviseAccountInput,
): Promise<AccountView> {
  return request<AccountView>(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function archiveAccount(id: string): Promise<AccountView> {
  return request<AccountView>(`/accounts/${id}/archive`, {
    method: "POST",
  });
}
/** Restores an archived account — PATCH {archived:false} (T25). */
export function unarchiveAccount(id: string): Promise<AccountView> {
  return request<AccountView>(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: false }),
  });
}
export function listCurrencies(): Promise<CurrencyView[]> {
  return request<CurrencyView[]>("/currencies");
}
export function listCurrencyCatalog(): Promise<IsoCurrencyView[]> {
  return request<IsoCurrencyView[]>("/currencies/catalog");
}
export function addCurrency(input: { code: string }): Promise<CurrencyView> {
  return request<CurrencyView>("/currencies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function reviseCurrency(
  id: string,
  input: { code: string },
): Promise<CurrencyView> {
  return request<CurrencyView>(`/currencies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function archiveCurrency(id: string): Promise<CurrencyView> {
  return request<CurrencyView>(`/currencies/${id}/archive`, {
    method: "POST",
  });
}
export function getWorkspace(): Promise<WorkspaceView> {
  return request<WorkspaceView>("/workspace");
}
export interface WorkspacePreferencesPatch {
  defaultCurrency?: string;
  timezone?: string;
}

export function updateWorkspace(
  patch: WorkspacePreferencesPatch,
): Promise<WorkspaceView> {
  return request<WorkspaceView>("/workspace", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
export function listCategories(): Promise<CategoryView[]> {
  return request<CategoryView[]>("/categories");
}
export function createCategory(
  input: CreateCategoryInput,
): Promise<CategoryView> {
  return request<CategoryView>("/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function reviseCategory(
  id: string,
  input: ReviseCategoryInput,
): Promise<CategoryView> {
  return request<CategoryView>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function archiveCategory(id: string): Promise<CategoryView> {
  return request<CategoryView>(`/categories/${id}/archive`, {
    method: "POST",
  });
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

// --- Receipt scans (receipt-scan-drafts T7, S1+S2+S7+S10) ------------

/**
 * `GET /receipts` — workspace scans, newest first, cursor-paginated
 * (receipt-review-link T5+T7, S1+S3+S4): `?limit=<n>&cursor=<opaque>` →
 * `{items, nextCursor}` where `nextCursor === null` ends the list.
 * Rows carry `transactionId` once the scan was confirmed into a
 * movement.
 */
export function listReceipts(
  opts: { limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<ReceiptListPageView> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.cursor !== undefined && opts.cursor !== "") {
    params.set("cursor", opts.cursor);
  }
  const qs = params.toString();
  return request<ReceiptListPageView>(`/receipts${qs ? `?${qs}` : ""}`);
}

/**
 * `GET /receipts/:id/file` — the stored medium as bytes
 * (receipt-review-link T6, L28). Binary, not JSON: the same auth
 * headers apply but the body is read with `res.blob()`, while API
 * failures keep the JSON error envelope so `ApiError` retains
 * status/code (410 → medio eliminado).
 */
export async function getReceiptFile(id: string): Promise<Blob> {
  const response = await fetch(`${BASE}/receipts/${id}/file`, {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    // Always throws the ApiError for non-OK responses.
    await parseResponse<never>(response);
  }
  return response.blob();
}

/** `POST /receipts` — multipart `file` field → 201 pending scan row. */
export function uploadReceipt(file: File): Promise<ReceiptScanView> {
  const form = new FormData();
  form.append("file", file);
  return requestMultipart<ReceiptScanView>("/receipts", form);
}

/** `GET /receipts/:id` — status polling while the pipeline runs. */
export function getReceiptScan(id: string): Promise<ReceiptScanView> {
  return request<ReceiptScanView>(`/receipts/${id}`);
}

/** `GET /receipts/:id/draft` — the stored draft once `draft_ready`. */
export function getReceiptDraft(id: string): Promise<ReceiptDraftPayload> {
  return request<ReceiptDraftPayload>(`/receipts/${id}/draft`);
}

export interface ConfirmReceiptResult {
  transaction: TransactionView;
  createdCategories: CategoryView[];
}

/** `POST /receipts/:id/confirm` — approve the draft → 201 transaction. */
export function confirmReceipt(
  id: string,
  input: ReceiptConfirmInput & { idempotencyKey: string },
): Promise<ConfirmReceiptResult> {
  return request<ConfirmReceiptResult>(`/receipts/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /receipts/:id/file` — early media deletion
 * (receipt-retention-30d T5, S3): removes only the stored object; the
 * scan row and any confirmed transaction survive (CA-012). Idempotent —
 * the API answers 204 and `GET /:id/file` turns 410 afterwards.
 */
export function deleteReceiptFile(id: string): Promise<void> {
  return request<void>(`/receipts/${id}/file`, { method: "DELETE" });
}

/** Retention windows the bulk purge endpoint accepts (S6). */
export type PurgePeriodDays = 7 | 15 | 30;

/**
 * `POST /receipts/purge-media` — manual bulk media purge
 * (receipt-retention-30d T7, S6): deletes the stored objects of every
 * scan older than the chosen window and answers `{deleted: n}`. Like
 * the per-scan early deletion only the medium goes away — the scan rows
 * and any confirmed transactions survive (CA-012).
 */
export function purgeReceiptMedia(
  olderThanDays: PurgePeriodDays,
): Promise<{ deleted: number }> {
  return request<{ deleted: number }>("/receipts/purge-media", {
    method: "POST",
    body: JSON.stringify({ olderThanDays }),
  });
}

/** `POST /receipts/:id/reject` — discard the draft without registering. */
export function rejectReceipt(id: string): Promise<ReceiptScanView> {
  return request<ReceiptScanView>(`/receipts/${id}/reject`, {
    method: "POST",
  });
}

/**
 * `POST /receipts/:id/retry` — reset a `failed` scan to `pending` and
 * re-queue its job over the original image, never re-uploading
 * (receipt-scan-drafts T12, S11). Non-final scans are an idempotent
 * no-op; `confirmed`/`rejected` scans answer 409 RECEIPT_ALREADY_FINAL.
 */
export function retryReceiptScan(id: string): Promise<ReceiptScanView> {
  return request<ReceiptScanView>(`/receipts/${id}/retry`, {
    method: "POST",
  });
}
