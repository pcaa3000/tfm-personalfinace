import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Box,
  Button,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  addCurrency,
  archiveAccount,
  archiveCategory,
  archiveCurrency,
  createAccount,
  createCategory,
  getWorkspace,
  listAccounts,
  listCategories,
  listCurrencies,
  listCurrencyCatalog,
  fetchBalance,
  listTransactions,
  unarchiveAccount,
  reviseAccount,
  reviseCategory,
  reviseCurrency,
  reviseTransaction,
  updateWorkspace,
  voidTransaction,
  type TransactionListFilters,
} from "./api";
import { AccountsDialog } from "./AccountsDialog";
import { BalanceStrip } from "./BalanceStrip";
import { CategoriesDialog } from "./CategoriesDialog";
import { CurrenciesDialog } from "./CurrenciesDialog";
import { EditTransactionDialog } from "./EditTransactionDialog";
import { errorMessage } from "./errors";
import { currencyExponentResolver } from "./format";
import { MobileNav } from "./MobileNav";
import { NewMovementDialog } from "./NewMovementDialog";
import { createTransactionOrQueue, toPendingView } from "./offline/create-or-queue";
import { listPendingTransactions } from "./offline/queue";
import { PENDING_QUERY_KEY, usePendingSync } from "./offline/use-pending-sync";
import { currentMonthRange } from "./period";
import { PreferencesDialog } from "./PreferencesDialog";
import {
  persistRailCollapsed,
  Sidebar,
  storedRailCollapsed,
} from "./Sidebar";
import { summariesFromBalanceItems } from "./summarize";
import { TransactionDayCards } from "./TransactionDayCards";
import { TransactionFilters } from "./TransactionFilters";
import {
  TopBar,
  TOPBAR_HEIGHT,
  type ManagementSection,
} from "./TopBar";
import { TransactionTable } from "./TransactionTable";
import { TransactionHistoryDialog } from "./TransactionHistoryDialog";
import { VoidTransactionDialog } from "./VoidTransactionDialog";
import type {
  CreateAccountInput,
  ReviseAccountInput,
  TransactionView,
} from "./types";
import type { TransactionFormValues } from "./TransactionForm";

/** Rows fetched per "load more" round trip (RF-013). */
export const TRANSACTIONS_PAGE_SIZE = 25;

/** Desktop breakpoint of the hybrid artboard (S12-6). */
const DESKTOP_QUERY = "(min-width:960px)";

export function LedgerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [editing, setEditing] = useState<TransactionView | null>(null);
  const [voiding, setVoiding] = useState<TransactionView | null>(null);
  const [historyFor, setHistoryFor] = useState<TransactionView | null>(null);
  const [management, setManagement] = useState<ManagementSection | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(storedRailCollapsed);
  const [filters, setFilters] = useState<TransactionListFilters>(() =>
    currentMonthRange(),
  );
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  usePendingSync();

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const transactionsQuery = useInfiniteQuery({
    queryKey: ["transactions", filters],
    queryFn: ({ pageParam }) =>
      listTransactions({
        ...filters,
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === TRANSACTIONS_PAGE_SIZE
        ? allPages.length * TRANSACTIONS_PAGE_SIZE
        : undefined,
  });
  // Dedicated aggregate endpoint feeds the general balance (S12-5, T24):
  // saldo actual = Σ initialBalance + income − expenses, computed in SQL.
  const balanceQuery = useQuery({
    queryKey: ["balance"],
    queryFn: fetchBalance,
  });
  const pendingQuery = useQuery({
    queryKey: PENDING_QUERY_KEY,
    queryFn: listPendingTransactions,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts({ includeArchived: true }),
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies"],
    queryFn: listCurrencies,
  });
  const catalogQuery = useQuery({
    queryKey: ["currencies", "catalog"],
    queryFn: listCurrencyCatalog,
    enabled: management === "currencies",
  });
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
  });

  const invalidateLedger = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: PENDING_QUERY_KEY }),
    ]);

  const createMutation = useMutation({
    mutationFn: createTransactionOrQueue,
    onSuccess: async () => {
      await invalidateLedger();
      setMovementOpen(false);
    },
  });

  const reviseMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: TransactionFormValues }) =>
      reviseTransaction(id, values),
    onSuccess: async () => {
      await invalidateLedger();
      setEditing(null);
    },
  });

  const accountMutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "create"; input: CreateAccountInput }
        | { kind: "revise"; id: string; input: ReviseAccountInput }
        | { kind: "archive"; id: string }
        | { kind: "unarchive"; id: string },
    ) => {
      if (action.kind === "create") return createAccount(action.input);
      if (action.kind === "revise") return reviseAccount(action.id, action.input);
      if (action.kind === "unarchive") return unarchiveAccount(action.id);
      return archiveAccount(action.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: updateWorkspace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const voidMutation = useMutation({
    mutationFn: voidTransaction,
    onSuccess: async () => {
      await invalidateLedger();
      setVoiding(null);
    },
  });

  const categoryMutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "create"; input: { label: string; nature: string } }
        | { kind: "revise"; id: string; input: { label?: string; nature?: string } }
        | { kind: "archive"; id: string },
    ) => {
      if (action.kind === "create") return createCategory(action.input);
      if (action.kind === "revise") return reviseCategory(action.id, action.input);
      return archiveCategory(action.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const currencyMutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "add"; code: string }
        | { kind: "revise"; id: string; code: string }
        | { kind: "archive"; id: string },
    ) => {
      if (action.kind === "add") return addCurrency({ code: action.code });
      if (action.kind === "revise")
        return reviseCurrency(action.id, { code: action.code });
      return archiveCurrency(action.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["currencies"] });
    },
  });

  const categories = categoriesQuery.data ?? [];
  // Active accounts feed every select/balance usage; the management
  // dialog receives the full list and renders the archived section.
  const accounts = (accountsQuery.data ?? []).filter(
    (a) => a.archivedAt === null,
  );
  const currencies = currenciesQuery.data ?? [];
  const currencyCodes = currencies.map((c) => c.code);
  const workspace = workspaceQuery.data;
  const transactions = transactionsQuery.data?.pages.flat() ?? [];
  const pendingRows = (pendingQuery.data ?? []).map(toPendingView);
  const tableRows = [...pendingRows, ...transactions];
  const exponentOf = currencyExponentResolver(currencies);
  const summaries = summariesFromBalanceItems(
    balanceQuery.data ?? [],
    exponentOf,
  );

  // Keep the desktop table head parked right under topbar+sticky block
  // (--tfm-under-sticky), whose height changes with filter wrapping.
  useEffect(() => {
    const update = () => {
      const height =
        (stickyRef.current?.offsetHeight ?? 0) + TOPBAR_HEIGHT;
      document.documentElement.style.setProperty(
        "--tfm-under-sticky",
        `${height}px`,
      );
    };
    update();
    if (typeof ResizeObserver !== "undefined" && stickyRef.current) {
      const observer = new ResizeObserver(update);
      observer.observe(stickyRef.current);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [desktop]);

  const onSubmit = (values: TransactionFormValues) => {
    createMutation.mutate({ ...values, idempotencyKey: crypto.randomUUID() });
  };

  const toggleRail = () => {
    setRailCollapsed((current) => {
      persistRailCollapsed(!current);
      return !current;
    });
  };

  const scrollToList = () =>
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const listSection = (
    <Box
      component="section"
      ref={listRef}
      aria-label={t("transactions.title")}
      sx={{
        px: { xs: 1.75, md: 2.75 },
        pt: { xs: 1.75, md: 2.25 },
        pb: { xs: "calc(58px + env(safe-area-inset-bottom, 0px) + 110px)", md: 7.5 },
      }}
    >
      {transactionsQuery.isLoading ? (
        <Typography>{t("transactions.loading")}</Typography>
      ) : transactionsQuery.isError ? (
        <Typography color="error">{t("transactions.loadError")}</Typography>
      ) : desktop ? (
        <TransactionTable
          transactions={tableRows}
          categories={categories}
          accounts={accounts}
          onEdit={setEditing}
          onVoid={setVoiding}
          onHistory={setHistoryFor}
        />
      ) : (
        <TransactionDayCards
          transactions={tableRows}
          categories={categories}
          accounts={accounts}
          exponentOf={exponentOf}
          onEdit={setEditing}
          onVoid={setVoiding}
          onHistory={setHistoryFor}
        />
      )}
      {transactionsQuery.hasNextPage ? (
        <Button
          variant="outlined"
          disabled={transactionsQuery.isFetchingNextPage}
          onClick={() => void transactionsQuery.fetchNextPage()}
          sx={{ mt: 2 }}
        >
          {transactionsQuery.isFetchingNextPage
            ? t("transactions.loading")
            : t("transactions.loadMore")}
        </Button>
      ) : null}
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      {desktop ? (
        <Sidebar
          collapsed={railCollapsed}
          onToggleCollapsed={toggleRail}
          onOpenManagement={setManagement}
          onNavigateList={scrollToList}
        />
      ) : null}

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TopBar
          pendingCount={pendingRows.length}
          desktop={desktop}
          onNewMovement={() => setMovementOpen(true)}
          onOpenManagement={setManagement}
        />

        <Box
          ref={stickyRef}
          sx={{
            position: "sticky",
            top: TOPBAR_HEIGHT,
            zIndex: 60,
            bgcolor: "background.default",
            px: { xs: 1.75, md: 2.75 },
            pt: { xs: 1.5, md: 2 },
            pb: { xs: 1.25, md: 1.75 },
            borderBottom: "1px solid",
            borderColor: "divider",
            boxShadow: "0 12px 26px -16px rgb(30 25 60 / 0.35)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1.25,
              mb: 1,
            }}
          >
            <Typography
              component="h2"
              sx={{ fontSize: { xs: 13, md: 14 }, fontWeight: 750 }}
            >
              {t("balance.title")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("balance.hint")}
            </Typography>
          </Box>
          <BalanceStrip
            summaries={summaries}
            accounts={accounts}
            defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
            exponentOf={exponentOf}
          />
          <Box sx={{ mt: { xs: 1.25, md: 1.75 } }}>
            <TransactionFilters
              categories={categories}
              value={filters}
              currencies={currencyCodes.length ? currencyCodes : undefined}
              onChange={setFilters}
            />
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1.25,
              mt: 1,
              pt: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography
              component="h2"
              sx={{ fontSize: { xs: 13, md: 14 }, fontWeight: 750 }}
            >
              {t("transactions.title")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("transactions.inPeriod", { count: tableRows.length })}
            </Typography>
          </Box>
        </Box>

        {listSection}
      </Box>

      {desktop ? null : (
        <MobileNav
          onNavigateList={scrollToList}
          onNewMovement={() => setMovementOpen(true)}
        />
      )}

      <NewMovementDialog
        open={movementOpen}
        categories={categories}
        accounts={accounts}
        defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
        currencies={currencyCodes}
        submitting={createMutation.isPending}
        error={
          createMutation.error ? errorMessage(createMutation.error, t) : null
        }
        onClose={() => setMovementOpen(false)}
        onSubmit={onSubmit}
      />
      <AccountsDialog
        open={management === "accounts"}
        accounts={accounts}
        currencies={
          currencyCodes.length
            ? currencyCodes
            : [workspace?.defaultCurrency ?? "PEN"]
        }
        submitting={accountMutation.isPending}
        error={
          accountMutation.error ? errorMessage(accountMutation.error, t) : null
        }
        onClose={() => setManagement(null)}
        onCreate={(input) =>
          accountMutation.mutate({ kind: "create", input })
        }
        onRevise={(id, input) =>
          accountMutation.mutate({ kind: "revise", id, input })
        }
        onArchive={(id) => accountMutation.mutate({ kind: "archive", id })}
        onUnarchive={(id) =>
          accountMutation.mutate({ kind: "unarchive", id })
        }
      />
      <CategoriesDialog
        open={management === "categories"}
        categories={categories}
        submitting={categoryMutation.isPending}
        error={
          categoryMutation.error
            ? errorMessage(categoryMutation.error, t)
            : null
        }
        onClose={() => setManagement(null)}
        onCreate={(input) =>
          categoryMutation.mutate({ kind: "create", input })
        }
        onRevise={(id, input) =>
          categoryMutation.mutate({ kind: "revise", id, input })
        }
        onArchive={(id) => categoryMutation.mutate({ kind: "archive", id })}
      />
      <CurrenciesDialog
        open={management === "currencies"}
        currencies={currencies}
        catalog={catalogQuery.data ?? []}
        submitting={currencyMutation.isPending}
        error={
          currencyMutation.error
            ? errorMessage(currencyMutation.error, t)
            : null
        }
        loadError={(() => {
          // T19: query failures (e.g. an old API without the currency
          // routes) must surface in the dialog instead of failing
          // silently with an empty catalog.
          const queryError =
            currenciesQuery.error ??
            (management === "currencies" ? catalogQuery.error : null);
          return queryError ? errorMessage(queryError, t) : null;
        })()}
        onClose={() => setManagement(null)}
        onAdd={(code) => currencyMutation.mutate({ kind: "add", code })}
        onRevise={(id, input) =>
          currencyMutation.mutate({ kind: "revise", id, code: input.code })
        }
        onArchive={(id) => currencyMutation.mutate({ kind: "archive", id })}
      />
      <PreferencesDialog
        open={management === "preferences"}
        workspace={workspace}
        currencies={currencyCodes}
        submitting={settingsMutation.isPending}
        error={
          settingsMutation.error
            ? errorMessage(settingsMutation.error, t)
            : null
        }
        onClose={() => setManagement(null)}
        onPatch={(patch) => settingsMutation.mutate(patch)}
      />

      <EditTransactionDialog
        transaction={editing}
        categories={categories}
        accounts={accounts}
        defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
        currencies={currencyCodes}
        submitting={reviseMutation.isPending}
        error={
          reviseMutation.error ? errorMessage(reviseMutation.error, t) : null
        }
        onClose={() => {
          setEditing(null);
          reviseMutation.reset();
        }}
        onSubmit={(id, values) => reviseMutation.mutate({ id, values })}
      />
      <VoidTransactionDialog
        transaction={voiding}
        submitting={voidMutation.isPending}
        error={
          voidMutation.error ? errorMessage(voidMutation.error, t) : null
        }
        onClose={() => {
          setVoiding(null);
          voidMutation.reset();
        }}
        onConfirm={(id) => voidMutation.mutate(id)}
      />
      <TransactionHistoryDialog
        transaction={historyFor}
        onClose={() => setHistoryFor(null)}
      />
    </Box>
  );
}
