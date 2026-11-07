// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncPendingTransactions } from "./sync";
import { PENDING_QUERY_KEY, usePendingSync } from "./use-pending-sync";

vi.mock("./sync", () => ({
  syncPendingTransactions: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { invalidate, wrapper };
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.mocked(syncPendingTransactions).mockReset();
  vi.mocked(syncPendingTransactions).mockResolvedValue({
    synced: 0,
    remaining: 0,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePendingSync", () => {
  it("drains the outbox once on mount", async () => {
    const { wrapper } = setup();

    renderHook(() => usePendingSync(), { wrapper });

    await waitFor(() => {
      expect(syncPendingTransactions).toHaveBeenCalledTimes(1);
    });
  });

  it("invalidates the ledger and pending queries when items were synced", async () => {
    vi.mocked(syncPendingTransactions).mockResolvedValue({
      synced: 2,
      remaining: 0,
    });
    const { invalidate, wrapper } = setup();

    renderHook(() => usePendingSync(), { wrapper });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["transactions"] });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_QUERY_KEY });
  });

  it("invalidates only the pending query when items remain queued", async () => {
    vi.mocked(syncPendingTransactions).mockResolvedValue({
      synced: 0,
      remaining: 1,
    });
    const { invalidate, wrapper } = setup();

    renderHook(() => usePendingSync(), { wrapper });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_QUERY_KEY });
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["transactions"],
    });
  });

  it("does not invalidate anything when the queue is already empty", async () => {
    const { invalidate, wrapper } = setup();

    renderHook(() => usePendingSync(), { wrapper });

    await waitFor(() => {
      expect(syncPendingTransactions).toHaveBeenCalledTimes(1);
    });
    await flushAsync();

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("syncs again when the browser comes back online", async () => {
    const { wrapper } = setup();

    renderHook(() => usePendingSync(), { wrapper });
    await waitFor(() => {
      expect(syncPendingTransactions).toHaveBeenCalledTimes(1);
    });

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(syncPendingTransactions).toHaveBeenCalledTimes(2);
    });
  });

  it("removes the online listener on unmount", async () => {
    const { wrapper } = setup();

    const { unmount } = renderHook(() => usePendingSync(), { wrapper });
    await waitFor(() => {
      expect(syncPendingTransactions).toHaveBeenCalledTimes(1);
    });

    unmount();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await flushAsync();

    expect(syncPendingTransactions).toHaveBeenCalledTimes(1);
  });
});
