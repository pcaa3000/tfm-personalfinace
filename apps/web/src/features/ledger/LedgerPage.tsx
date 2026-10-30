import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import {
  listCategories,
  listTransactions,
  reviseTransaction,
  voidTransaction,
} from "./api";
import { EditTransactionDialog } from "./EditTransactionDialog";
import { errorMessage } from "./errors";
import { createTransactionOrQueue, toPendingView } from "./offline/create-or-queue";
import { listPendingTransactions } from "./offline/queue";
import { PENDING_QUERY_KEY, usePendingSync } from "./offline/use-pending-sync";
import { summarizeByCurrency } from "./summarize";
import { TransactionForm, type TransactionFormValues } from "./TransactionForm";
import { TransactionHistoryDialog } from "./TransactionHistoryDialog";
import { TransactionTable } from "./TransactionTable";
import { VoidTransactionDialog } from "./VoidTransactionDialog";
import type { TransactionView } from "./types";

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
  usePendingSync();

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const transactionsQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: listTransactions,
  });
  const pendingQuery = useQuery({
    queryKey: PENDING_QUERY_KEY,
    queryFn: listPendingTransactions,
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

  const voidMutation = useMutation({
    mutationFn: voidTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setVoiding(null);
    },
  });

  const categories = categoriesQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];
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

        <Divider />

        <section aria-label={t("transactions.title")}>
          <Typography variant="h6" component="h2" gutterBottom>
            {t("transactions.title")}
          </Typography>
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
              onEdit={setEditing}
              onVoid={setVoiding}
              onHistory={setHistoryFor}
            />
          )}
        </section>
      </Stack>

      <EditTransactionDialog
        transaction={editing}
        categories={categories}
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
