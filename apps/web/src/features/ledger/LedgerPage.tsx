import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Container, Divider, Paper, Stack, Typography } from "@mui/material";

import { createTransaction, listCategories, listTransactions } from "./api";
import { summarizeByCurrency } from "./summarize";
import { TransactionForm } from "./TransactionForm";
import { TransactionTable } from "./TransactionTable";
import type { CreateTransactionInput } from "./types";

function formatMinor(minor: bigint, currency: string): string {
  const exponent = ({ JPY: 0, KRW: 0, BHD: 3, KWD: 3, CLF: 4 })[currency] ?? 2;
  const sign = minor < 0n ? "-" : "";
  const digits = minor.toString().replace("-", "").padStart(exponent + 1, "0");
  if (exponent === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function LedgerPage() {
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const transactionsQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: listTransactions,
  });

  const mutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const categories = categoriesQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];
  const categoryLabels = new Map(categories.map((c) => [c.id, c.label]));
  const summaries = summarizeByCurrency(transactions);

  const onSubmit = (input: CreateTransactionInput) => {
    mutation.mutate(input);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Personal Finance — Ledger
        </Typography>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" gutterBottom>
            New transaction
          </Typography>
          <TransactionForm
            categories={categories}
            submitting={mutation.isPending}
            error={mutation.error?.message ?? null}
            onSubmit={onSubmit}
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" gutterBottom>
            Summary by currency
          </Typography>
          {summaries.length === 0 ? (
            <Typography color="text.secondary">
              No confirmed movements yet.
            </Typography>
          ) : (
            <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap" }}>
              {summaries.map((s) => (
                <Box key={s.currency}>
                  <Typography variant="overline">{s.currency}</Typography>
                  <Typography>
                    Income {formatMinor(s.incomeMinor, s.currency)} · Expenses{" "}
                    {formatMinor(s.expenseMinor, s.currency)} · Net{" "}
                    {formatMinor(s.netMinor, s.currency)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>

        <Divider />

        <section aria-label="Transactions">
          <Typography variant="h6" component="h2" gutterBottom>
            Transactions
          </Typography>
          {transactionsQuery.isLoading ? (
            <Typography>Loading…</Typography>
          ) : transactionsQuery.isError ? (
            <Typography color="error">
              Could not load transactions.
            </Typography>
          ) : (
            <TransactionTable
              transactions={transactions}
              categoryLabels={categoryLabels}
            />
          )}
        </section>
      </Stack>
    </Container>
  );
}
