import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";

import { formatBusinessDate } from "./format";
import { categoryLabel } from "./TransactionForm";
import type {
  AccountView,
  CategoryView,
  LedgerRow,
  TransactionType,
} from "./types";

interface Props {
  transactions: LedgerRow[];
  categories: CategoryView[];
  accounts: AccountView[];
  onEdit: (transaction: LedgerRow) => void;
  onVoid: (transaction: LedgerRow) => void;
  onHistory: (transaction: LedgerRow) => void;
  onNewMovement?: () => void;
}

// S9: the transfer token keeps one identity across table and
// day-cards (the artboard's --transfer violet-grey).
const TYPE_COLOR: Record<
  TransactionType,
  "success" | "error" | "transfer"
> = {
  income: "success",
  expense: "error",
  transfer: "transfer",
};

/**
 * Dense desktop table (S12-6). The header sticks below the top
 * topbar+balance block via the --tfm-under-sticky offset maintained by
 * LedgerPage.
 */
export function TransactionTable({
  transactions,
  categories,
  accounts,
  onEdit,
  onVoid,
  onHistory,
  onNewMovement,
}: Props) {
  const { t, i18n } = useTranslation();
  const categoryLabels = new Map(
    categories.map((c) => [c.id, categoryLabel(c, t)]),
  );
  const accountLabels = new Map(accounts.map((a) => [a.id, a.name]));

  if (transactions.length === 0) {
    // S1: the empty state offers an action, not only text.
    return (
      <Box
        sx={{
          display: "grid",
          justifyItems: "center",
          gap: 1.25,
          py: { xs: 4, md: 6 },
          textAlign: "center",
        }}
      >
        <Typography color="text.secondary">{t("table.empty")}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t("table.emptyHint")}
        </Typography>
        {onNewMovement ? (
          <Button
            variant="contained"
            size="small"
            onClick={onNewMovement}
            sx={{ mt: 0.5 }}
          >
            {t("table.emptyAction")}
          </Button>
        ) : null}
      </Box>
    );
  }

  const accountCell = (trx: LedgerRow): string => {
    const source = trx.accountId
      ? (accountLabels.get(trx.accountId) ?? trx.accountId)
      : t("table.noAccount");
    if (trx.type === "transfer") {
      const destination = trx.destinationAccountId
        ? (accountLabels.get(trx.destinationAccountId) ??
          trx.destinationAccountId)
        : t("table.noAccount");
      return `${source} → ${destination}`;
    }
    return source;
  };

  return (
    <TableContainer
      sx={(theme) => ({
        // S8: horizontal scroll + a 720px floor (artboard table
        // min-width) so the 8 columns never compress at 960–1100px.
        // Only in the narrow band: overflow-x:auto makes this container
        // the sticky header's scrollport and would break its vertical
        // stick on wide screens (worker finding, T3).
        overflowX: "clip",
        "@media (max-width: 1179.98px)": { overflowX: "auto" },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "20px",
        bgcolor: "background.paper",
        boxShadow: theme.shadows[1],
      })}
    >
      <Table
        size="small"
        sx={{ minWidth: 720 }}
        aria-label={t("transactions.title")}
      >
        <TableHead>
          <TableRow
            sx={{
              "& th": {
                position: "sticky",
                top: "var(--tfm-under-sticky, 0px)",
                zIndex: 40,
                bgcolor: "action.hover",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "text.secondary",
                fontWeight: 700,
              },
            }}
          >
            <TableCell>{t("table.date")}</TableCell>
            <TableCell>{t("table.type")}</TableCell>
            <TableCell>{t("table.concept")}</TableCell>
            <TableCell>{t("table.account")}</TableCell>
            <TableCell>{t("table.category")}</TableCell>
            <TableCell>{t("table.status")}</TableCell>
            <TableCell align="right">{t("table.amount")}</TableCell>
            <TableCell align="right">{t("table.actions")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {transactions.map((trx) => {
            const voided = trx.status === "voided";
            const pending = trx.pendingSync === true;
            return (
              <TableRow key={trx.id} sx={voided ? { opacity: 0.5 } : undefined}>
                <TableCell>
                  {formatBusinessDate(trx.businessDate, i18n.language)}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={TYPE_COLOR[trx.type]}
                    label={t(`form.${trx.type}`)}
                  />
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{trx.concept}</TableCell>
                <TableCell>{accountCell(trx)}</TableCell>
                <TableCell>
                  {trx.type === "transfer"
                    ? "—"
                    : trx.categoryId
                      ? (categoryLabels.get(trx.categoryId) ?? trx.categoryId)
                      : t("form.uncategorized")}
                </TableCell>
                <TableCell>
                  {pending ? (
                    <Chip
                      size="small"
                      color="warning"
                      label={t("table.pendingSync")}
                    />
                  ) : (
                    <>
                      {trx.status === "voided"
                        ? t("table.statusVoided")
                        : t("table.statusConfirmed")}
                      {trx.revisionCount > 0 ? ` (${trx.revisionCount})` : ""}
                    </>
                  )}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ color: `${TYPE_COLOR[trx.type]}.main` }}
                >
                  {trx.type === "income" ? "+" : trx.type === "expense" ? "−" : ""}
                  {trx.amount} {trx.currency}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                    <Button
                      size="small"
                      disabled={voided || pending}
                      onClick={() => onEdit(trx)}
                    >
                      {t("table.edit")}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={voided || pending}
                      onClick={() => onVoid(trx)}
                    >
                      {t("table.void")}
                    </Button>
                    <Button
                      size="small"
                      disabled={pending}
                      onClick={() => onHistory(trx)}
                    >
                      {t("table.history")}
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
