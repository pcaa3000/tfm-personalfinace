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
  Chip,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import {
  archiveCategory,
  createAccount,
  createCategory,
  getWorkspace,
  listAccounts,
  listCategories,
  listTransactions,
  reviseCategory,
  reviseTransaction,
  updateWorkspace,
  voidTransaction,
  type TransactionListFilters,
} from "./api";
import { CategoriesSection } from "./CategoriesSection";
import { EditTransactionDialog } from "./EditTransactionDialog";
import { errorMessage } from "./errors";
import { createTransactionOrQueue, toPendingView } from "./offline/create-or-queue";
import { listPendingTransactions } from "./offline/queue";
import { PENDING_QUERY_KEY, usePendingSync } from "./offline/use-pending-sync";
import { summarizeByCurrency } from "./summarize";
import { TransactionForm, type TransactionFormValues } from "./TransactionForm";
import { TransactionHistoryDialog } from "./TransactionHistoryDialog";
import { TransactionFilters } from "./TransactionFilters";
import { TransactionTable } from "./TransactionTable";
import { VoidTransactionDialog } from "./VoidTransactionDialog";
import type { TransactionView } from "./types";

/** Rows fetched per "load more" round trip (RF-013). */
export const TRANSACTIONS_PAGE_SIZE = 25;

function formatMinor(minor: bigint, currency: string): string {
  const exponent = ({ JPY: 0, KRW: 0, BHD: 3, KWD: 3, CLF: 4 })[currency] ?? 2;
  const sign = minor < 0n ? "-" : "";
  const digits = minor.toString().replace("-", "").padStart(exponent + 1, "0");
  if (exponent === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function LedgerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TransactionView | null>(null);
  const [voiding, setVoiding] = useState<TransactionView | null>(null);
  const [historyFor, setHistoryFor] = useState<TransactionView | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("PEN");
  const [filters, setFilters] = useState<TransactionListFilters>({});
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
  const pendingQuery = useQuery({
    queryKey: PENDING_QUERY_KEY,
    queryFn: listPendingTransactions,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
  });

  const createMutation = useMutation({
    mutationFn: createTransactionOrQueue,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: PENDING_QUERY_KEY }),
      ]);
    },
  });

  const reviseMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: TransactionFormValues }) =>
      reviseTransaction(id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setEditing(null);
    },
  });

  const accountMutation = useMutation({
    mutationFn: createAccount,
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
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
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

  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const workspace = workspaceQuery.data;
  const transactions = transactionsQuery.data?.pages.flat() ?? [];
  const pendingRows = (pendingQuery.data ?? []).map(toPendingView);
  const tableRows = [...pendingRows, ...transactions];
  const summaries = summarizeByCurrency(transactions);

  const onSubmit = (values: TransactionFormValues) => {
    createMutation.mutate({ ...values, idempotencyKey: crypto.randomUUID() });
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
            {t("app.title")}
          </Typography>
          {pendingRows.length > 0 ? (
            <Chip
              color="warning"
              label={t("pending.badge", { count: pendingRows.length })}
            />
          ) : null}
          <LanguageSwitcher />
        </Stack>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" gutterBottom>
            {t("form.newTransaction")}
          </Typography>
          <TransactionForm
            categories={categories}
            accounts={accounts}
            defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
            submitting={createMutation.isPending}
            error={
              createMutation.error
                ? errorMessage(createMutation.error, t)
                : null
            }
            onSubmit={onSubmit}
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" gutterBottom>
            {t("summary.title")}
          </Typography>
          {summaries.length === 0 ? (
            <Typography color="text.secondary">
              {t("summary.empty")}
            </Typography>
          ) : (
            <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap" }}>
              {summaries.map((s) => (
                <Box key={s.currency}>
                  <Typography variant="overline">{s.currency}</Typography>
                  <Typography>
                    {t("summary.income")} {formatMinor(s.incomeMinor, s.currency)}{" "}
                    · {t("summary.expenses")}{" "}
                    {formatMinor(s.expenseMinor, s.currency)} · {t("summary.net")}{" "}
                    {formatMinor(s.netMinor, s.currency)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              {t("accounts.title")}
            </Typography>
            <TextField
              select
              size="small"
              label={t("settings.defaultCurrency")}
              value={workspace?.defaultCurrency ?? "PEN"}
              onChange={(e) =>
                settingsMutation.mutate({ defaultCurrency: e.target.value })
              }
              sx={{ minWidth: 150 }}
            >
              {["PEN", "USD", "EUR", "ARS", "JPY", "BHD"].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t("settings.timezone")}
              value={workspace?.timezone ?? "UTC"}
              onChange={(e) =>
                settingsMutation.mutate({ timezone: e.target.value })
              }
              sx={{ minWidth: 170 }}
            >
              {[
                "UTC",
                "America/Lima",
                "America/Bogota",
                "America/Mexico_City",
                "America/Santiago",
                "America/Argentina/Buenos_Aires",
                "America/New_York",
                "Europe/Madrid",
              ].map((tz) => (
                <MenuItem key={tz} value={tz}>
                  {tz}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t("settings.locale")}
              value={workspace?.locale ?? "es-PE"}
              onChange={(e) =>
                settingsMutation.mutate({ locale: e.target.value })
              }
              sx={{ minWidth: 130 }}
            >
              {["es-PE", "es-ES", "es-MX", "en-US", "en-GB"].map((l) => (
                <MenuItem key={l} value={l}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {accountMutation.error ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {errorMessage(accountMutation.error, t)}
            </Alert>
          ) : null}
          {accounts.length === 0 ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t("accounts.empty")}
            </Typography>
          ) : (
            <List dense>
              {accounts.map((a) => (
                <ListItem key={a.id} disableGutters>
                  <ListItemText
                    primary={a.name}
                    secondary={`${a.currency} · ${t(`accounts.kind.${a.kind}`)}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label={t("accounts.name")}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
            <TextField
              select
              size="small"
              label={t("accounts.currency")}
              value={accountCurrency}
              onChange={(e) => setAccountCurrency(e.target.value)}
              sx={{ minWidth: 110 }}
            >
              {["PEN", "USD", "EUR", "ARS", "JPY", "BHD"].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              disabled={accountMutation.isPending || !accountName.trim()}
              onClick={() =>
                accountMutation.mutate(
                  { name: accountName.trim(), currency: accountCurrency, kind: "bank" },
                  { onSuccess: () => setAccountName("") },
                )
              }
            >
              {t("accounts.create")}
            </Button>
          </Stack>
        </Paper>

        <CategoriesSection
          categories={categories}
          submitting={categoryMutation.isPending}
          error={
            categoryMutation.error
              ? errorMessage(categoryMutation.error, t)
              : null
          }
          onCreate={(input) =>
            categoryMutation.mutate({ kind: "create", input })
          }
          onRevise={(id, input) =>
            categoryMutation.mutate({ kind: "revise", id, input })
          }
          onArchive={(id) => categoryMutation.mutate({ kind: "archive", id })}
        />

        <Divider />

        <section aria-label={t("transactions.title")}>
          <Typography variant="h6" component="h2" gutterBottom>
            {t("transactions.title")}
          </Typography>
          <TransactionFilters
            categories={categories}
            value={filters}
            onChange={setFilters}
          />
          {transactionsQuery.isLoading ? (
            <Typography>{t("transactions.loading")}</Typography>
          ) : transactionsQuery.isError ? (
            <Typography color="error">
              {t("transactions.loadError")}
            </Typography>
          ) : (
            <TransactionTable
              transactions={tableRows}
              categories={categories}
              accounts={accounts}
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
        </section>
      </Stack>

      <EditTransactionDialog
        transaction={editing}
        categories={categories}
        accounts={accounts}
        defaultCurrency={workspace?.defaultCurrency ?? "PEN"}
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
    </Container>
  );
}
