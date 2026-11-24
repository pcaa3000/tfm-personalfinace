import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { TFunction } from "i18next";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AccountsDialog } from "../ledger/AccountsDialog";
import {
  addCurrency,
  ApiError,
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
  reviseAccount,
  reviseCategory,
  reviseCurrency,
  unarchiveAccount,
  updateWorkspace,
} from "../ledger/api";
import { CategoriesDialog } from "../ledger/CategoriesDialog";
import { CurrenciesDialog } from "../ledger/CurrenciesDialog";
import { errorMessage } from "../ledger/errors";
import {
  currencyExponentResolver,
  formatBusinessDate,
} from "../ledger/format";
import { ChevronDownIcon } from "../ledger/icons";
import { MobileNav } from "../ledger/MobileNav";
import { NewMovementDialog } from "../ledger/NewMovementDialog";
import { createTransactionOrQueue } from "../ledger/offline/create-or-queue";
import { PreferencesDialog } from "../ledger/PreferencesDialog";
import { TicketsDialog } from "../ledger/TicketsDialog";
import {
  TopBar,
  type ManagementSection,
} from "../ledger/TopBar";
import type { TransactionFormValues } from "../ledger/TransactionForm";
import type {
  CreateAccountInput,
  CreateCategoryInput,
  ReviseAccountInput,
} from "../ledger/types";
import {
  persistRailCollapsed,
  railCollapsedPreference,
  Sidebar,
  storedRailCollapsed,
} from "../ledger/Sidebar";
import {
  closePeriod,
  fetchAvoidableExpenses,
  fetchCashFlowReport,
  fetchExpensesByCategory,
  fetchMonthlySavings,
  fetchReportExport,
  listPeriodCloses,
  type AvoidableExpenseDetector,
  type AvoidableExpensesView,
  type CashFlowReportView,
  type ExpenseCategoryView,
  type ExpensesByCategoryView,
  type MonthlySavingsView,
  type ReportExportFormat,
  type ReportPeriod,
  type ReportPeriodQuery,
  type ReportPeriodStatus,
} from "./api";
import {
  formatReportAmount,
  formatReportPercent,
  monthName,
} from "./format";
import { navigateToPanel, navigateToReports } from "./route";

/** Desktop breakpoint shared with the ledger artboard (S12-6). */
const DESKTOP_QUERY = "(min-width:960px)";
const AUTO_MINI_QUERY = "(min-width:960px) and (max-width:1179.98px)";

/** Years offered by the period selector: a little history, no future. */
function yearOptions(now: Date): number[] {
  const current = now.getFullYear();
  const years: number[] = [];
  for (let y = current; y >= current - 5; y -= 1) years.push(y);
  return years;
}

/** "YYYY-MM" key the close's `periodStart` shares for a year+month. */
function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Current year/month on the workspace timezone's calendar (S5): only a
 * month fully ended there may be closed. Falls back to the local clock
 * while the workspace is loading — the POST fails closed server-side
 * (PERIOD_NOT_FINISHED) if the UI ever offers it too early.
 */
function workspaceYearMonth(
  timezone: string | undefined,
  now: Date,
): { year: number; month: number } {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(now);
      const value = (type: string) =>
        Number(parts.find((part) => part.type === type)?.value);
      const year = value("year");
      const month = value("month");
      if (Number.isFinite(year) && Number.isFinite(month)) {
        return { year, month };
      }
    } catch {
      // Unparseable timezone — fall through to the local clock.
    }
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const KNOWN_NATURES = new Set([
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
]);

/** Localized expense nature; report rows may also carry "uncategorized". */
function natureLabel(nature: string, t: TFunction): string {
  if (nature === "uncategorized") return t("movement.uncategorized");
  return KNOWN_NATURES.has(nature) ? t(`categories.nature.${nature}`) : nature;
}

/** S7/CA-013: the resolved window status, "Provisional" or "Cerrado". */
function PeriodBadge({ status }: { status: ReportPeriodStatus }) {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      color={status === "closed" ? "success" : "warning"}
      label={t(status === "closed" ? "reports.closed" : "reports.provisional")}
    />
  );
}

interface SectionFrameProps {
  title: string;
  period: ReportPeriod | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** S13/T14 — whether the section content is expanded. */
  expanded: boolean;
  onToggle: () => void;
  /** S13/T14 — one-line headline figures kept in the always-visible header. */
  summary: string | null;
  children: React.ReactNode;
}

/**
 * Shared chrome of every report section: a heading button (title +
 * period badge + resolved window + headline `summary` + chevron) that
 * expands/collapses the content (S13), then skeleton / error+retry /
 * content — the same states the ledger list uses (S2, S3).
 */
function ReportSection({
  title,
  period,
  loading,
  error,
  onRetry,
  expanded,
  onToggle,
  summary,
  children,
}: SectionFrameProps) {
  const { t, i18n } = useTranslation();
  return (
    <Box component="section" aria-label={title} sx={{ mb: { xs: 3, md: 4 } }}>
      <Typography
        component="h3"
        sx={{ m: 0, mb: 1, fontSize: { xs: 13, md: 14 }, fontWeight: 750 }}
      >
        <ButtonBase
          onClick={onToggle}
          aria-expanded={expanded}
          sx={{
            width: "100%",
            display: "flex",
            alignItems: "baseline",
            gap: 1.25,
            flexWrap: "wrap",
            justifyContent: "flex-start",
            textAlign: "left",
            py: 0.5,
            font: "inherit",
            color: "inherit",
          }}
        >
          <Box component="span">{title}</Box>
          {period ? <PeriodBadge status={period.periodStatus} /> : null}
          {period ? (
            <Typography variant="caption" color="text.secondary">
              {`${formatBusinessDate(period.from, i18n.language)} – ${formatBusinessDate(period.to, i18n.language)}`}
            </Typography>
          ) : null}
          {summary ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {summary}
            </Typography>
          ) : null}
          <ChevronDownIcon
            sx={{
              ml: "auto",
              fontSize: 18,
              flexShrink: 0,
              alignSelf: "center",
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 200ms",
            }}
          />
        </ButtonBase>
      </Typography>
      <Collapse in={expanded}>
        <Box>
          {loading ? (
            <Box
              data-part="report-skeleton"
              aria-label={t("reports.loading")}
              sx={{ display: "grid", gap: 1 }}
            >
              <Skeleton variant="rounded" height={36} />
              <Skeleton variant="rounded" height={52} />
              <Skeleton variant="rounded" height={52} />
            </Box>
          ) : error ? null : (
            children
          )}
        </Box>
      </Collapse>
      {/* A load error is a signal — it stays visible even collapsed (S13). */}
      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              {t("reports.retry")}
            </Button>
          }
        >
          {t("reports.loadError")} {error}
        </Alert>
      ) : null}
    </Box>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  );
}

const tablePaperSx = { borderRadius: "12px", overflow: "hidden" } as const;
const amountCellSx = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
const stackedCardSx = {
  borderRadius: "12px",
  px: 1.5,
  py: 1.25,
  display: "grid",
  gap: 0.5,
} as const;

/**
 * S12 (T13) — mobile variant of a wide report table: one Paper card
 * per record, identifying field + headline figure prominent, every
 * remaining column as a labeled caption line. Nothing is dropped.
 */
function StackedRows({ children }: { children: React.ReactNode }) {
  return (
    <Box
      data-part="report-stacked-rows"
      sx={{ display: "grid", gap: 1 }}
    >
      {children}
    </Box>
  );
}

/** S12 — labeled secondary figure inside a stacked row. */
function RowStat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          fontVariantNumeric: "tabular-nums",
          fontWeight: strong ? 700 : 400,
          textAlign: "right",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/** S12 — the prominent figure + its label at the top of a stacked row. */
function CardHeadline({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box sx={{ textAlign: "right", flexShrink: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

interface ReportQuerySectionProps {
  query: ReportPeriodQuery;
  enabled: boolean;
}

/** S13/T14 — a section whose content sits behind a collapsible header. */
interface CollapsibleReportSectionProps extends ReportQuerySectionProps {
  expanded: boolean;
  onToggle: () => void;
}

/** Display-only decimal sum of the per-account net flows (single currency). */
function totalNetFlow(view: CashFlowReportView): string {
  const total = view.accounts.reduce(
    (sum, account) => sum + (Number(account.netFlow) || 0),
    0,
  );
  return total.toFixed(2);
}

/** S1 — per-account income/expense/transfers/net flow table. */
function CashFlowSection({
  query,
  enabled,
  expanded,
  onToggle,
}: CollapsibleReportSectionProps) {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const report = useQuery({
    queryKey: ["reports", "cash-flow", query],
    queryFn: () => fetchCashFlowReport(query),
    enabled,
  });
  const money = (decimal: string) =>
    formatReportAmount(decimal, query.currency, i18n.language);
  const view: CashFlowReportView | undefined = report.data;
  const summary = view
    ? `${money(totalNetFlow(view))} · ${t("reports.summary.accounts", { count: view.accounts.length })}`
    : null;
  return (
    <ReportSection
      title={t("reports.cashFlow.title")}
      period={view?.period}
      expanded={expanded}
      onToggle={onToggle}
      summary={summary}
      loading={enabled && report.isLoading}
      error={report.isError ? errorMessage(report.error, t) : null}
      onRetry={() => void report.refetch()}
    >
      {view ? (
        view.accounts.length === 0 ? (
          <EmptyState text={t("reports.cashFlow.empty")} />
        ) : !desktop ? (
          <StackedRows>
            {view.accounts.map((account) => (
              <Paper
                key={account.accountId ?? "unassigned"}
                variant="outlined"
                sx={stackedCardSx}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 1,
                    alignItems: "start",
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 650, fontSize: 14 }}>
                      {account.name ?? t("reports.cashFlow.unassigned")}
                    </Typography>
                    {account.kind ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {account.kind}
                      </Typography>
                    ) : null}
                  </Box>
                  <CardHeadline
                    label={t("reports.cashFlow.netFlow")}
                    value={money(account.netFlow)}
                  />
                </Box>
                <RowStat
                  label={t("reports.cashFlow.income")}
                  value={money(account.income)}
                />
                <RowStat
                  label={t("reports.cashFlow.expense")}
                  value={money(account.expense)}
                />
                <RowStat
                  label={t("reports.cashFlow.transfersIn")}
                  value={money(account.transfersIn)}
                />
                <RowStat
                  label={t("reports.cashFlow.transfersOut")}
                  value={money(account.transfersOut)}
                />
              </Paper>
            ))}
          </StackedRows>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={tablePaperSx}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("reports.cashFlow.account")}</TableCell>
                  <TableCell align="right">
                    {t("reports.cashFlow.income")}
                  </TableCell>
                  <TableCell align="right">
                    {t("reports.cashFlow.expense")}
                  </TableCell>
                  <TableCell align="right">
                    {t("reports.cashFlow.transfersIn")}
                  </TableCell>
                  <TableCell align="right">
                    {t("reports.cashFlow.transfersOut")}
                  </TableCell>
                  <TableCell align="right">
                    {t("reports.cashFlow.netFlow")}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.accounts.map((account) => (
                  <TableRow key={account.accountId ?? "unassigned"}>
                    <TableCell>
                      {account.name ?? t("reports.cashFlow.unassigned")}
                      {account.kind ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          {account.kind}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell sx={amountCellSx}>
                      {money(account.income)}
                    </TableCell>
                    <TableCell sx={amountCellSx}>
                      {money(account.expense)}
                    </TableCell>
                    <TableCell sx={amountCellSx}>
                      {money(account.transfersIn)}
                    </TableCell>
                    <TableCell sx={amountCellSx}>
                      {money(account.transfersOut)}
                    </TableCell>
                    <TableCell sx={{ ...amountCellSx, fontWeight: 650 }}>
                      {money(account.netFlow)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : null}
    </ReportSection>
  );
}

/** S2 — category table with nature, share of spend and nature subtotals. */
function ExpensesByCategorySection({
  query,
  enabled,
  expanded,
  onToggle,
}: CollapsibleReportSectionProps) {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const report = useQuery({
    queryKey: ["reports", "expenses-by-category", query],
    queryFn: () => fetchExpensesByCategory(query),
    enabled,
  });
  const money = (decimal: string) =>
    formatReportAmount(decimal, query.currency, i18n.language);
  const view: ExpensesByCategoryView | undefined = report.data;
  const natureEntries = view
    ? Object.entries(view.natureTotals).filter(
        ([, total]) => Number(total) !== 0,
      )
    : [];
  const summary = view
    ? `${money(view.totalExpenses)} · ${t("reports.summary.categories", { count: view.categories.length })}`
    : null;
  return (
    <ReportSection
      title={t("reports.categories.title")}
      period={view?.period}
      expanded={expanded}
      onToggle={onToggle}
      summary={summary}
      loading={enabled && report.isLoading}
      error={report.isError ? errorMessage(report.error, t) : null}
      onRetry={() => void report.refetch()}
    >
      {view ? (
        view.categories.length === 0 ? (
          <EmptyState text={t("reports.categories.empty")} />
        ) : (
          <>
            <Box
              sx={{
                display: "flex",
                gap: 1,
                flexWrap: "wrap",
                alignItems: "center",
                mb: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {`${t("reports.categories.totalExpenses")}: ${money(view.totalExpenses)}`}
              </Typography>
              {natureEntries.length > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`· ${t("reports.categories.byNature")}:`}
                </Typography>
              ) : null}
              {natureEntries.map(([nature, total]) => (
                <Chip
                  key={nature}
                  size="small"
                  variant="outlined"
                  label={`${natureLabel(nature, t)}: ${money(total)}`}
                />
              ))}
            </Box>
            {!desktop ? (
              <StackedRows>
                {view.categories.map((category) => (
                  <Paper
                    key={category.key}
                    variant="outlined"
                    sx={stackedCardSx}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 1,
                        alignItems: "start",
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 650, fontSize: 14 }}>
                          {category.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          {natureLabel(category.nature, t)}
                        </Typography>
                      </Box>
                      <CardHeadline
                        label={t("reports.categories.total")}
                        value={money(category.total)}
                      />
                    </Box>
                    <RowStat
                      label={t("reports.categories.percent")}
                      value={formatReportPercent(
                        category.percentOfExpenses,
                        i18n.language,
                      )}
                    />
                    <RowStat
                      label={t("reports.categories.count")}
                      value={category.transactionCount}
                    />
                  </Paper>
                ))}
              </StackedRows>
            ) : (
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={tablePaperSx}
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("reports.categories.category")}</TableCell>
                    <TableCell>{t("reports.categories.nature")}</TableCell>
                    <TableCell align="right">
                      {t("reports.categories.total")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.categories.percent")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.categories.count")}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {view.categories.map((category) => (
                    <TableRow key={category.key}>
                      <TableCell>{category.label}</TableCell>
                      <TableCell>{natureLabel(category.nature, t)}</TableCell>
                      <TableCell sx={amountCellSx}>
                        {money(category.total)}
                      </TableCell>
                      <TableCell sx={amountCellSx}>
                        {formatReportPercent(
                          category.percentOfExpenses,
                          i18n.language,
                        )}
                      </TableCell>
                      <TableCell sx={amountCellSx}>
                        {category.transactionCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            )}
          </>
        )
      ) : null}
    </ReportSection>
  );
}

/** Translated detector key — unknown keys pass through verbatim. */
function detectorLabel(detector: AvoidableExpenseDetector, t: TFunction) {
  return t(`reports.avoidable.detector.${detector}`);
}

/**
 * S3+S11 (T12) — avoidable expenses: every group admitted by at least
 * one detector (ant, recurring_charge, monthly_recurring, concentration,
 * growth), with the
 * headline potential-savings figure and a chip per fired detector.
 */
function AvoidableExpensesSection({
  query,
  enabled,
  expanded,
  onToggle,
}: CollapsibleReportSectionProps) {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const report = useQuery({
    queryKey: ["reports", "avoidable-expenses", query],
    queryFn: () => fetchAvoidableExpenses(query),
    enabled,
  });
  const money = (decimal: string) =>
    formatReportAmount(decimal, query.currency, i18n.language);
  const view: AvoidableExpensesView | undefined = report.data;
  const summary = view
    ? `${money(view.potentialSavings)} · ${t("reports.summary.groups", { count: view.groups.length })}`
    : null;
  return (
    <ReportSection
      title={t("reports.avoidable.title")}
      period={view?.period}
      expanded={expanded}
      onToggle={onToggle}
      summary={summary}
      loading={enabled && report.isLoading}
      error={report.isError ? errorMessage(report.error, t) : null}
      onRetry={() => void report.refetch()}
    >
      {view ? (
        view.groups.length === 0 ? (
          <EmptyState text={t("reports.avoidable.empty")} />
        ) : (
          <>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 1 }}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700 }}
              >
                {`${t("reports.avoidable.potentialSavings")}: ${money(view.potentialSavings)}`}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ alignSelf: "center" }}
              >
                {`${t("reports.avoidable.totalDiscretionary")}: ${money(view.totalDiscretionary)}`}
              </Typography>
            </Box>
            {!desktop ? (
              <StackedRows>
                {view.groups.map((group) => (
                  <Paper
                    key={group.key}
                    variant="outlined"
                    sx={stackedCardSx}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 1,
                        alignItems: "start",
                      }}
                    >
                      <Typography
                        sx={{ fontWeight: 650, fontSize: 14, minWidth: 0 }}
                      >
                        {group.label}
                      </Typography>
                      <CardHeadline
                        label={t("reports.avoidable.total")}
                        value={money(group.total)}
                      />
                    </Box>
                    <Box
                      sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}
                    >
                      {group.detectors.map((detector) => (
                        <Chip
                          key={detector}
                          size="small"
                          variant="outlined"
                          label={detectorLabel(detector, t)}
                        />
                      ))}
                      <Chip
                        size="small"
                        color={
                          group.confidence === "high" ? "success" : "warning"
                        }
                        variant="outlined"
                        label={t(
                          group.confidence === "high"
                            ? "reports.avoidable.confidenceHigh"
                            : "reports.avoidable.confidenceLow",
                        )}
                      />
                    </Box>
                    <RowStat
                      label={t("reports.avoidable.operations")}
                      value={group.operationCount}
                    />
                    <RowStat
                      label={t("reports.avoidable.average")}
                      value={money(group.average)}
                    />
                    <RowStat
                      label={t("reports.avoidable.percentDiscretionary")}
                      value={formatReportPercent(
                        group.percentOfDiscretionary,
                        i18n.language,
                      )}
                    />
                  </Paper>
                ))}
              </StackedRows>
            ) : (
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={tablePaperSx}
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("reports.avoidable.label")}</TableCell>
                    <TableCell>{t("reports.avoidable.detectors")}</TableCell>
                    <TableCell align="right">
                      {t("reports.avoidable.operations")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.avoidable.total")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.avoidable.average")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.avoidable.percentDiscretionary")}
                    </TableCell>
                    <TableCell>{t("reports.avoidable.confidence")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {view.groups.map((group) => (
                    <TableRow key={group.key}>
                      <TableCell>{group.label}</TableCell>
                      <TableCell>
                        <Box
                          sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}
                        >
                          {group.detectors.map((detector) => (
                            <Chip
                              key={detector}
                              size="small"
                              variant="outlined"
                              label={detectorLabel(detector, t)}
                            />
                          ))}
                        </Box>
                      </TableCell>
                      <TableCell sx={amountCellSx}>
                        {group.operationCount}
                      </TableCell>
                      <TableCell sx={amountCellSx}>
                        {money(group.total)}
                      </TableCell>
                      <TableCell sx={amountCellSx}>
                        {money(group.average)}
                      </TableCell>
                      <TableCell sx={amountCellSx}>
                        {formatReportPercent(
                          group.percentOfDiscretionary,
                          i18n.language,
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={
                            group.confidence === "high" ? "success" : "warning"
                          }
                          variant="outlined"
                          label={t(
                            group.confidence === "high"
                              ? "reports.avoidable.confidenceHigh"
                              : "reports.avoidable.confidenceLow",
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            )}
          </>
        )
      ) : null}
    </ReportSection>
  );
}

/** S4 — saved amount + observed rate, with deficit/no_income notes. */
function MonthlySavingsSection({
  query,
  enabled,
  expanded,
  onToggle,
}: CollapsibleReportSectionProps) {
  const { t, i18n } = useTranslation();
  const report = useQuery({
    queryKey: ["reports", "monthly-savings", query],
    queryFn: () => fetchMonthlySavings(query),
    enabled,
  });
  const money = (decimal: string) =>
    formatReportAmount(decimal, query.currency, i18n.language);
  const view: MonthlySavingsView | undefined = report.data;

  const stat = (label: string, value: string) => (
    <Paper
      key={label}
      variant="outlined"
      sx={{ borderRadius: "12px", px: 1.5, py: 1.25 }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontSize: 16 }}>{value}</Typography>
    </Paper>
  );

  const summary = view
    ? `${money(view.saved)} · ${view.observedRate !== null ? formatReportPercent(view.observedRate, i18n.language) : "—"}`
    : null;

  return (
    <ReportSection
      title={t("reports.savings.title")}
      period={view?.period}
      expanded={expanded}
      onToggle={onToggle}
      summary={summary}
      loading={enabled && report.isLoading}
      error={report.isError ? errorMessage(report.error, t) : null}
      onRetry={() => void report.refetch()}
    >
      {view ? (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
              gap: 1,
              mb: 1,
            }}
          >
            {stat(t("reports.savings.income"), money(view.income))}
            {stat(t("reports.savings.expense"), money(view.expense))}
            {stat(t("reports.savings.saved"), money(view.saved))}
            {stat(
              t("reports.savings.observedRate"),
              view.observedRate !== null
                ? formatReportPercent(view.observedRate, i18n.language)
                : "—",
            )}
          </Box>
          {view.note === "deficit" ? (
            <Alert severity="warning">
              {t("reports.savings.deficitNote", {
                amount: money(view.deficit ?? "0"),
              })}
            </Alert>
          ) : null}
          {view.note === "no_income" ? (
            <Alert severity="info">{t("reports.savings.noIncomeNote")}</Alert>
          ) : null}
        </>
      ) : null}
    </ReportSection>
  );
}

/** S13/T14 — one KPI card of the executive summary strip. */
function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: "12px", px: 1.5, py: 1.25, minWidth: 0 }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography
        noWrap
        sx={{
          fontWeight: 700,
          fontSize: 16,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {hint}
      </Typography>
    </Paper>
  );
}

/**
 * S13/T14 — always-visible executive summary: four KPIs computed from
 * the same `reports` query keys the sections use (react-query dedupes
 * the observers, so no extra requests). Missing views render "—";
 * loaded zeroes render a real 0.
 */
function ExecutiveSummary({ query, enabled }: ReportQuerySectionProps) {
  const { t, i18n } = useTranslation();
  const savings = useQuery({
    queryKey: ["reports", "monthly-savings", query],
    queryFn: () => fetchMonthlySavings(query),
    enabled,
  }).data;
  const avoidable = useQuery({
    queryKey: ["reports", "avoidable-expenses", query],
    queryFn: () => fetchAvoidableExpenses(query),
    enabled,
  }).data;
  const cashFlow = useQuery({
    queryKey: ["reports", "cash-flow", query],
    queryFn: () => fetchCashFlowReport(query),
    enabled,
  }).data;
  const categories = useQuery({
    queryKey: ["reports", "expenses-by-category", query],
    queryFn: () => fetchExpensesByCategory(query),
    enabled,
  }).data;
  const money = (decimal: string) =>
    formatReportAmount(decimal, query.currency, i18n.language);

  const topCategory = categories?.categories
    .filter((category) => category.nature === "discretionary")
    .reduce<ExpenseCategoryView | undefined>(
      (best, category) =>
        best === undefined || Number(category.total) > Number(best.total)
          ? category
          : best,
      undefined,
    );

  const savingsHint = savings
    ? savings.note === "deficit"
      ? `${t("reports.summary.deficit")}: ${money(savings.deficit ?? "0")}`
      : savings.observedRate !== null
        ? `${t("reports.savings.observedRate")}: ${formatReportPercent(savings.observedRate, i18n.language)}`
        : "—"
    : "—";

  return (
    <Box
      component="section"
      aria-label={t("reports.summary.title")}
      sx={{ mb: { xs: 3, md: 4 } }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
          gap: 1,
        }}
      >
        <SummaryCard
          label={t("reports.summary.observedSavings")}
          value={savings ? money(savings.saved) : "—"}
          hint={savingsHint}
        />
        <SummaryCard
          label={t("reports.summary.potentialSavings")}
          value={avoidable ? money(avoidable.potentialSavings) : "—"}
          hint={
            avoidable
              ? t("reports.summary.groups", { count: avoidable.groups.length })
              : "—"
          }
        />
        <SummaryCard
          label={t("reports.summary.cashFlow")}
          value={cashFlow ? money(totalNetFlow(cashFlow)) : "—"}
          hint={
            cashFlow
              ? t("reports.summary.accounts", {
                  count: cashFlow.accounts.length,
                })
              : "—"
          }
        />
        <SummaryCard
          label={t("reports.summary.topCategory")}
          value={topCategory?.label ?? "—"}
          hint={topCategory ? money(topCategory.total) : "—"}
        />
      </Box>
    </Box>
  );
}

type ReportSectionKey = "cashFlow" | "categories" | "avoidable" | "savings";

/**
 * Reports page (reports-monthly T7, S7, CA-013): the four monthly
 * reports as tables behind a shared month/year + currency selector.
 * S15/T16: shares the app chrome with the ledger — TopBar (new
 * movement + Gestión menu + theme/language), Sidebar (nav + Gestión
 * group) and MobileNav (list navigation + movement FAB). The reports
 * page renders the same shared dialogs (movement + management) wired
 * to the same API calls as LedgerPage.
 */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const autoMiniRail = useMediaQuery(AUTO_MINI_QUERY);
  const [movementOpen, setMovementOpen] = useState(false);
  const [management, setManagement] = useState<ManagementSection | null>(
    null,
  );
  const [railCollapsed, setRailCollapsed] = useState(storedRailCollapsed);
  const effectiveRailCollapsed =
    railCollapsedPreference() === null ? autoMiniRail : railCollapsed;

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies"],
    queryFn: listCurrencies,
  });
  // Shared-chrome data (T16): the movement dialog and the management
  // dialogs read the same query keys as the ledger page.
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts({ includeArchived: true }),
  });
  const catalogQuery = useQuery({
    queryKey: ["currencies", "catalog"],
    queryFn: listCurrencyCatalog,
    enabled: management === "currencies",
  });

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(
    null,
  );

  const workspace = workspaceQuery.data;
  // Same source the ledger filters use (S12-4): the workspace currency
  // catalog, active rows only.
  const currencyCodes = (currenciesQuery.data ?? [])
    .filter((c) => c.archivedAt === null)
    .map((c) => c.code);
  const currency =
    selectedCurrency ??
    workspace?.defaultCurrency ??
    currencyCodes[0] ??
    "";

  const query: ReportPeriodQuery = { currency, year, month };
  const enabled = currency !== "";

  const queryClient = useQueryClient();
  const reportsFetching = useIsFetching({ queryKey: ["reports"] }) > 0;
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  const closesQuery = useQuery({
    queryKey: ["reports", "period-closes", currency],
    queryFn: () => listPeriodCloses(currency),
    enabled,
  });

  // S5/T9: the close action exists only for a calendar month fully
  // ended in the workspace timezone, and only while no fresh close
  // covers it — a stale close may be re-closed (it gets superseded).
  const wsNow = workspaceYearMonth(workspace?.timezone, now);
  const monthFinished =
    year < wsNow.year || (year === wsNow.year && month < wsNow.month);
  const key = periodKey(year, month);
  const hasActiveClose = (closesQuery.data ?? []).some(
    (close) =>
      close.currency === currency &&
      close.periodStart.slice(0, 7) === key &&
      !close.stale,
  );
  const canCloseMonth =
    enabled && monthFinished && closesQuery.isFetched && !hasActiveClose;

  const invalidateReports = () =>
    queryClient.invalidateQueries({ queryKey: ["reports"] });

  const closeMutation = useMutation({
    mutationFn: () => closePeriod(currency, year, month),
    onSuccess: async () => {
      await invalidateReports();
      setCloseDialogOpen(false);
    },
    onError: async (error) => {
      // A 409 just means a fresher close already exists — refetch and
      // let the sections settle into "Cerrado" instead of an error.
      if (
        error instanceof ApiError &&
        error.code === "PERIOD_ALREADY_CLOSED"
      ) {
        await invalidateReports();
        setCloseDialogOpen(false);
      }
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (format: ReportExportFormat) => {
      const blob = await fetchReportExport(query, format);
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `reportes-${currency}-${key}.${format}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  });
  const exportDisabled =
    !enabled || reportsFetching || exportMutation.isPending;

  // --- Shared-chrome mutations (T16, same wiring as LedgerPage) ---

  const categories = categoriesQuery.data ?? [];
  const allAccounts = accountsQuery.data ?? [];
  const accounts = allAccounts.filter((a) => a.archivedAt === null);
  const currencies = currenciesQuery.data ?? [];
  const exponentOf = currencyExponentResolver(currencies);

  // A new movement changes the reports (and the ledger caches), so
  // every affected query is invalidated on confirm — same set as
  // LedgerPage plus the reports keys this page renders.
  const invalidateAfterMovement = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reports"] }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["balance"] }),
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
    ]);

  const createMutation = useMutation({
    mutationFn: createTransactionOrQueue,
    onSuccess: async () => {
      await invalidateAfterMovement();
      setMovementOpen(false);
    },
  });

  const onSubmit = (values: TransactionFormValues) => {
    createMutation.mutate({ ...values, idempotencyKey: crypto.randomUUID() });
  };

  // Inline create from the category selector (same helper as
  // LedgerPage): post, refresh categories, hand the created category
  // back so the select auto-selects it.
  const createCategoryInline = async (input: CreateCategoryInput) => {
    const category = await createCategory(input);
    await queryClient.invalidateQueries({ queryKey: ["categories"] });
    return category;
  };

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

  const settingsMutation = useMutation({
    mutationFn: updateWorkspace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const toggleRail = () => {
    const next = !effectiveRailCollapsed;
    persistRailCollapsed(next);
    setRailCollapsed(next);
  };

  // S13/T14: every section starts collapsed except avoidable expenses,
  // which auto-opens once it detects groups — until the user overrides
  // either way (a recorded toggle always wins).
  // Manual toggles reset when the selected period+currency changes —
  // a hidden section for one month must not stay hidden for the next
  // (render-time reset, currency resolves async: "" then real code).
  const [sectionToggles, setSectionToggles] = useState<
    Partial<Record<ReportSectionKey, boolean>>
  >({});
  const togglesKey = `${query.currency}:${query.year}:${query.month}`;
  const togglesKeyRef = useRef(togglesKey);
  if (togglesKeyRef.current !== togglesKey) {
    const previousKey = togglesKeyRef.current;
    togglesKeyRef.current = togglesKey;
    // "" -> real currency for the SAME year+month while the workspace
    // resolves is hydration, not a selector change — keep the toggles
    // only in that case; every other transition resets them.
    const [prevCurrency, prevYear, prevMonth] = previousKey.split(":");
    const isHydration =
      prevCurrency === "" &&
      prevYear === String(query.year) &&
      prevMonth === String(query.month);
    if (!isHydration) {
      setSectionToggles({});
    }
  }
  const avoidablePeek = useQuery({
    queryKey: ["reports", "avoidable-expenses", query],
    queryFn: () => fetchAvoidableExpenses(query),
    enabled,
  });
  const avoidableHasGroups =
    (avoidablePeek.data?.groups.length ?? 0) > 0;
  const autoExpanded = (key: ReportSectionKey) =>
    key === "avoidable" ? avoidableHasGroups : false;
  const sectionExpanded = (key: ReportSectionKey) =>
    sectionToggles[key] ?? autoExpanded(key);
  const toggleSection = (key: ReportSectionKey) =>
    setSectionToggles((previous) => ({
      ...previous,
      [key]: !(previous[key] ?? autoExpanded(key)),
    }));

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      {desktop ? (
        <Sidebar
          collapsed={effectiveRailCollapsed}
          onToggleCollapsed={toggleRail}
          onOpenManagement={setManagement}
          onNavigateList={navigateToPanel}
          onNavigateReports={navigateToReports}
          active="reports"
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
        {/* S15/T16: the shared TopBar carries brand, the new-movement
            action, the Gestión menu and the theme/language controls —
            the reports page keeps no header of its own. pendingCount
            is 0: the outbox badge is a ledger-list concern. */}
        <TopBar
          crumbKey="nav.reports"
          pendingCount={0}
          desktop={desktop}
          onNewMovement={() => setMovementOpen(true)}
          onOpenManagement={setManagement}
        />

        <Box
          sx={{
            px: { xs: 1.75, md: 2.75 },
            pt: { xs: 1.5, md: 2 },
            pb: { xs: 1.25, md: 1.75 },
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.25 }}>
            <Typography
              component="h2"
              sx={{ fontSize: { xs: 13, md: 14 }, fontWeight: 750 }}
            >
              {t("reports.title")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("reports.subtitle")}
            </Typography>
          </Box>
          <Box
            sx={{
              mt: 1.25,
              display: "flex",
              gap: 1.25,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <TextField
              select
              size={desktop ? "small" : "medium"}
              label={t("reports.month")}
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              sx={{ minWidth: 150 }}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map(
                (value) => (
                  <MenuItem key={value} value={value}>
                    {monthName(value, i18n.language)}
                  </MenuItem>
                ),
              )}
            </TextField>
            <TextField
              select
              size={desktop ? "small" : "medium"}
              label={t("reports.year")}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              sx={{ minWidth: 110 }}
            >
              {yearOptions(now).map((value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size={desktop ? "small" : "medium"}
              label={t("reports.currency")}
              value={currency}
              onChange={(event) => setSelectedCurrency(event.target.value)}
              disabled={currencyCodes.length === 0 && currency === ""}
              sx={{ minWidth: 120 }}
            >
              {(currencyCodes.includes(currency)
                ? currencyCodes
                : currency === ""
                  ? currencyCodes
                  : [currency, ...currencyCodes]
              ).map((code) => (
                <MenuItem key={code} value={code}>
                  {code}
                </MenuItem>
              ))}
            </TextField>
            <Box
              sx={{
                display: "flex",
                gap: 0.75,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {`${t("reports.export.label")}:`}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={exportDisabled}
                onClick={() => exportMutation.mutate("csv")}
                sx={desktop ? undefined : { minHeight: 44 }}
              >
                {t("reports.export.csv")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={exportDisabled}
                onClick={() => exportMutation.mutate("xlsx")}
                sx={desktop ? undefined : { minHeight: 44 }}
              >
                {t("reports.export.xlsx")}
              </Button>
            </Box>
            {canCloseMonth ? (
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  closeMutation.reset();
                  setCloseDialogOpen(true);
                }}
                sx={desktop ? undefined : { minHeight: 44 }}
              >
                {t("reports.closeMonth")}
              </Button>
            ) : null}
          </Box>
          {!enabled ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1 }}
            >
              {t("reports.noCurrency")}
            </Typography>
          ) : null}
          {exportMutation.isError ? (
            <Alert
              severity="error"
              sx={{ mt: 1 }}
              onClose={() => exportMutation.reset()}
            >
              {t("reports.export.error")}{" "}
              {errorMessage(exportMutation.error, t)}
            </Alert>
          ) : null}
        </Box>

        <Box
          sx={{
            px: { xs: 1.75, md: 2.75 },
            pt: { xs: 1.75, md: 2.25 },
            pb: {
              xs: "calc(58px + env(safe-area-inset-bottom, 0px) + 24px)",
              md: 7.5,
            },
          }}
        >
          <ExecutiveSummary query={query} enabled={enabled} />
          <CashFlowSection
            query={query}
            enabled={enabled}
            expanded={sectionExpanded("cashFlow")}
            onToggle={() => toggleSection("cashFlow")}
          />
          <ExpensesByCategorySection
            query={query}
            enabled={enabled}
            expanded={sectionExpanded("categories")}
            onToggle={() => toggleSection("categories")}
          />
          <AvoidableExpensesSection
            query={query}
            enabled={enabled}
            expanded={sectionExpanded("avoidable")}
            onToggle={() => toggleSection("avoidable")}
          />
          <MonthlySavingsSection
            query={query}
            enabled={enabled}
            expanded={sectionExpanded("savings")}
            onToggle={() => toggleSection("savings")}
          />
        </Box>
      </Box>

      {desktop ? null : (
        <MobileNav
          onNavigateList={navigateToPanel}
          onNavigateReports={navigateToReports}
          onNewMovement={() => setMovementOpen(true)}
          active="reports"
        />
      )}

      {/* S15/T16: the same shared dialogs LedgerPage owns — a new
          movement or a management change also lands in the reports. */}
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
          void invalidateAfterMovement().then(() => setMovementOpen(false));
        }}
        onVoiceConfirmed={() => {
          void invalidateAfterMovement().then(() => setMovementOpen(false));
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

      <Dialog
        open={closeDialogOpen}
        onClose={() => {
          if (!closeMutation.isPending) setCloseDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("reports.closeDialog.title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t("reports.closeDialog.body", {
              month: monthName(month, i18n.language),
              year,
              currency,
            })}
          </Typography>
          {closeMutation.isError ? (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {errorMessage(closeMutation.error, t)}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setCloseDialogOpen(false)}
            disabled={closeMutation.isPending}
          >
            {t("reports.closeDialog.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
          >
            {closeMutation.isPending
              ? t("reports.closeDialog.closing")
              : t("reports.closeDialog.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
