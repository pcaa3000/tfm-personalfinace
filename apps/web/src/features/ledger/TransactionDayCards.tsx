import {
  alpha,
  Avatar,
  Box,
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AmountText } from "./AmountText";
import { formatDayTitle } from "./format";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreIcon,
  SwapIcon,
} from "./icons";
import { categoryLabel } from "./category-label";
import { TicketOriginBadge } from "./TicketOriginBadge";
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
  exponentOf?: (code: string) => number;
  onEdit: (transaction: LedgerRow) => void;
  onVoid: (transaction: LedgerRow) => void;
  onHistory: (transaction: LedgerRow) => void;
  onNewMovement?: () => void;
}

// S9: transfers use the dedicated palette token — the same
// violet-grey the desktop table uses (artboard --transfer).
const TYPE_COLOR: Record<
  TransactionType,
  "success" | "error" | "transfer"
> = {
  income: "success",
  expense: "error",
  transfer: "transfer",
};

function TypeIcon({ type }: { type: TransactionType }) {
  if (type === "income") return <ArrowUpIcon fontSize="small" />;
  if (type === "expense") return <ArrowDownIcon fontSize="small" />;
  return <SwapIcon fontSize="small" />;
}

/**
 * Mobile list (S12-6): transactions grouped into per-day cards with a
 * tinted circular type icon, meta line and signed coloured amount.
 */
export function TransactionDayCards({
  transactions,
  categories,
  accounts,
  exponentOf = () => 2,
  onEdit,
  onVoid,
  onHistory,
  onNewMovement,
}: Props) {
  const { t, i18n } = useTranslation();
  const [menuFor, setMenuFor] = useState<{
    row: LedgerRow;
    anchor: HTMLElement;
  } | null>(null);

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

  const groups = new Map<string, LedgerRow[]>();
  for (const row of transactions) {
    const list = groups.get(row.businessDate) ?? [];
    list.push(row);
    groups.set(row.businessDate, list);
  }

  const meta = (trx: LedgerRow): string => {
    const account = trx.accountId
      ? (accountLabels.get(trx.accountId) ?? trx.accountId)
      : t("table.noAccount");
    if (trx.type === "transfer") {
      const destination = trx.destinationAccountId
        ? (accountLabels.get(trx.destinationAccountId) ??
          trx.destinationAccountId)
        : t("table.noAccount");
      return `${account} → ${destination}`;
    }
    const category =
      trx.splits.length > 1
        ? t("table.splitCount", { count: trx.splits.length })
        : trx.categoryId
          ? (categoryLabels.get(trx.categoryId) ?? trx.categoryId)
          : t("form.uncategorized");
    return `${account} · ${category}`;
  };

  const sign = (trx: LedgerRow): "+" | "−" | "" =>
    trx.type === "income" ? "+" : trx.type === "expense" ? "−" : "";

  const menuRow = menuFor?.row;

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      {[...groups.entries()].map(([date, rows]) => (
        <Box
          component="section"
          key={date}
          data-day-group
          aria-label={formatDayTitle(date, i18n.language)}
        >
          <Typography
            variant="caption"
            sx={{
              display: "block",
              fontWeight: 700,
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              mb: 0.75,
              ml: 0.25,
            }}
          >
            {formatDayTitle(date, i18n.language)}
          </Typography>
          <Box sx={{ display: "grid", gap: 1 }}>
            {rows.map((trx) => {
              const voided = trx.status === "voided";
              const colorKey = TYPE_COLOR[trx.type];
              return (
                <Paper
                  key={trx.id}
                  component="article"
                  variant="outlined"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr auto auto",
                    gap: 1.25,
                    alignItems: "center",
                    borderRadius: "20px",
                    p: 1.25,
                    opacity: voided ? 0.5 : 1,
                  }}
                >
                  <Avatar
                    sx={(theme) => ({
                      width: 40,
                      height: 40,
                      bgcolor: alpha(theme.palette[colorKey].main, 0.14),
                      color: `${colorKey}.main`,
                    })}
                  >
                    <TypeIcon type={trx.type} />
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontSize: 14,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {trx.concept}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {meta(trx)}
                    </Typography>
                    {trx.origin === "ticket" ? (
                      <TicketOriginBadge
                        originReference={trx.originReference}
                      />
                    ) : null}
                  </Box>
                  <Box sx={{ textAlign: "right" }}>
                    <Typography
                      component="div"
                      sx={{
                        fontWeight: 700,
                        fontSize: 14.5,
                        color: `${colorKey}.main`,
                      }}
                    >
                      <AmountText
                        amount={trx.amount}
                        currency={trx.currency}
                        exponent={exponentOf(trx.currency)}
                        sign={sign(trx)}
                      />
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {trx.pendingSync
                        ? t("table.pendingSync")
                        : t(`form.${trx.type}`)}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={t("cards.more")}
                    onClick={(event) =>
                      setMenuFor({ row: trx, anchor: event.currentTarget })
                    }
                  >
                    <MoreIcon fontSize="small" />
                  </IconButton>
                </Paper>
              );
            })}
          </Box>
        </Box>
      ))}
      <Menu
        open={menuFor !== null}
        anchorEl={menuFor?.anchor}
        onClose={() => setMenuFor(null)}
      >
        <MenuItem
          disabled={menuRow?.status === "voided" || menuRow?.pendingSync === true}
          onClick={() => {
            if (menuRow) onEdit(menuRow);
            setMenuFor(null);
          }}
        >
          <ListItemIcon>
            <ArrowUpIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("table.edit")}</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={menuRow?.status === "voided" || menuRow?.pendingSync === true}
          onClick={() => {
            if (menuRow) onVoid(menuRow);
            setMenuFor(null);
          }}
        >
          <ListItemText>{t("table.void")}</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={menuRow?.pendingSync === true}
          onClick={() => {
            if (menuRow) onHistory(menuRow);
            setMenuFor(null);
          }}
        >
          <ListItemText>{t("table.history")}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
