import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Skeleton,
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
import { currencyExponentResolver, formatBusinessDate } from "./format";
import { MobileNav } from "./MobileNav";
import { NewMovementDialog } from "./NewMovementDialog";
import { createTransactionOrQueue, toPendingView } from "./offline/create-or-queue";
import { listPendingTransactions } from "./offline/queue";
import { PENDING_QUERY_KEY, usePendingSync } from "./offline/use-pending-sync";
import { navigateToReports } from "../reports/route";
import { currentMonthRange } from "./period";
import { PreferencesDialog } from "./PreferencesDialog";
import {
  persistRailCollapsed,
  railCollapsedPreference,
  Sidebar,
  storedRailCollapsed,
} from "./Sidebar";
import { summariesFromBalanceItems } from "./summarize";
import { TicketsDialog } from "./TicketsDialog";
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
  CreateCategoryInput,
  ReviseAccountInput,
  TransactionView,
} from "./types";
import type { TransactionFormValues } from "./TransactionForm";

/** Rows fetched per "load more" round trip (RF-013). */
export const TRANSACTIONS_PAGE_SIZE = 25;

/** Desktop breakpoint of the hybrid artboard (S12-6). */
const DESKTOP_QUERY = "(min-width:960px)";

/** Auto-mini band of the hybrid artboard (S10): 960–1179px. */
const AUTO_MINI_QUERY = "(min-width:960px) and (max-width:1179.98px)";

export function LedgerPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const autoMiniRail = useMediaQuery(AUTO_MINI_QUERY);
  const [editing, setEditing] = useState<TransactionView | null>(null);
  const [voiding, setVoiding] = useState<TransactionView | null>(null);
  const [historyFor, setHistoryFor] = useState<TransactionView | null>(null);
  const [management, setManagement] = useState<ManagementSection | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(storedRailCollapsed);
  // S10: a saved tfm-rail-collapsed preference always wins; inside
  // the 960–1179px band the rail starts collapsed (auto-mini) when
  // the user never expressed a preference.
  const effectiveRailCollapsed =
    railCollapsedPreference() === null ? autoMiniRail : railCollapsed;
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
    // Reads the local IndexedDB outbox — not the network. Without
    // "always", React Query pauses the refetch while offline and a
    // freshly queued transaction stays invisible until reconnect
    // (user might re-enter it → duplicates).
    networkMode: "always",
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
      queryClient.invalidateQueries({ queryKey: ["balance"] }),
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
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
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
  const allAccounts = accountsQuery.data ?? [];
  const accounts = allAccounts.filter((a) => a.archivedAt === null);
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

  // T8 (S8): inline create from the category selector — post, refresh
  // the categories query and hand the created category back so the
  // select can auto-select it without leaving the flow.
  const createCategoryInline = async (input: CreateCategoryInput) => {
    const category = await createCategory(input);
    await queryClient.invalidateQueries({ queryKey: ["categories"] });
    return category;
  };

  const toggleRail = () => {
    // Toggling inside the auto-mini band must flip the *effective*
    // state and persist it, so the explicit choice wins from then on.
    const next = !effectiveRailCollapsed;
    persistRailCollapsed(next);
    setRailCollapsed(next);
  };

  const scrollToList = () =>
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // S6: surface the active period next to the section title, not just
  // deducible via the row count (artboard "Movimientos · Noviembre 2026").
  const activePeriodLabel = (() => {
    const { from, to } = filters;
    if (from && to) {
      return `${formatBusinessDate(from, i18n.language)} – ${formatBusinessDate(to, i18n.language)}`;
    }
    if (from) {
      return `${t("filters.from")}: ${formatBusinessDate(from, i18n.language)}`;
    }
    if (to) {
      return `${t("filters.to")}: ${formatBusinessDate(to, i18n.language)}`;
    }
    return null;
  })();

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
        // S2: skeleton rows instead of plain loading text.
        <Box
          data-part="transactions-skeleton"
          aria-label={t("transactions.loading")}
          sx={{ display: "grid", gap: 1 }}
        >
          <Skeleton variant="rounded" height={36} />
          <Skeleton variant="rounded" height={52} />
          <Skeleton variant="rounded" height={52} />
          <Skeleton variant="rounded" height={52} />
        </Box>
      ) : transactionsQuery.isError ? (
        // S2: error offers a retry that refetches the list.
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => void transactionsQuery.refetch()}
            >
              {t("transactions.retry")}
            </Button>
          }
        >
          {t("transactions.loadError")}
        </Alert>
      ) : desktop ? (
        <TransactionTable
          transactions={tableRows}
          categories={categories}
          accounts={accounts}
          onEdit={setEditing}
          onVoid={setVoiding}
          onHistory={setHistoryFor}
          onNewMovement={() => setMovementOpen(true)}
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
          onNewMovement={() => setMovementOpen(true)}
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
          collapsed={effectiveRailCollapsed}
          onToggleCollapsed={toggleRail}
          onOpenManagement={setManagement}
          onNavigateList={scrollToList}
          onNavigateReports={navigateToReports}
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
          {balanceQuery.isError ? (
            // S3: balance failures surface a retry instead of empty space.
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="body2" color="error">
                {t("balance.loadError")}
              </Typography>
              <Button
                size="small"
                onClick={() => void balanceQuery.refetch()}
              >
                {t("balance.retry")}
              </Button>
            </Box>
          ) : balanceQuery.isSuccess && summaries.length === 0 ? (
            // S3: an empty successful balance shows a visible hint.
            <Typography variant="caption" color="text.secondary">
              {t("balance.noAccounts")}
            </Typography>
          ) : (
            <BalanceStrip
              summaries={summaries}
              accounts={accounts}
              defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
              exponentOf={exponentOf}
            />
          )}
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
            {activePeriodLabel ? (
              <Typography
                variant="caption"
                color="text.secondary"
                data-part="active-period"
              >
                {`· ${activePeriodLabel}`}
              </Typography>
            ) : null}
          </Box>
        </Box>

        {listSection}
      </Box>

      {desktop ? null : (
        <MobileNav
          onNavigateList={scrollToList}
          onNavigateReports={navigateToReports}
          onNewMovement={() => setMovementOpen(true)}
        />
      )}

      <NewMovementDialog
        open={movementOpen}
        categories={categories}
        accounts={accounts}
        defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
        currencies={currencyCodes}
        timezone={workspace?.timezone}
        exponentOf={exponentOf}
        submitting={createMutation.isPending}
        error={
          createMutation.error ? errorMessage(createMutation.error, t) : null
        }
        onClose={() => setMovementOpen(false)}
        onSubmit={onSubmit}
        onCreateCategory={createCategoryInline}
        onReceiptConfirmed={() => {
          // The confirm can create categories (S10) besides the
          // transaction — refresh both lists.
          void queryClient.invalidateQueries({ queryKey: ["categories"] });
          void invalidateLedger().then(() => setMovementOpen(false));
        }}
        onVoiceConfirmed={() => {
          // Same confirm side effects as the receipt flow (voice-drafts
          // T4): the draft may create categories and the movement.
          void queryClient.invalidateQueries({ queryKey: ["categories"] });
          void invalidateLedger().then(() => setMovementOpen(false));
        }}
      />
      <AccountsDialog
        open={management === "accounts"}
        accounts={allAccounts}
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
      <TicketsDialog
        open={management === "tickets"}
        onClose={() => setManagement(null)}
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
        timezone={workspace?.timezone}
        submitting={reviseMutation.isPending}
        error={
          reviseMutation.error ? errorMessage(reviseMutation.error, t) : null
        }
        onClose={() => {
          setEditing(null);
          reviseMutation.reset();
        }}
        onCreateCategory={createCategoryInline}
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
