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
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import { useThemeMode } from "../../theme-mode";
import { ApiError, getWorkspace, listCurrencies } from "../ledger/api";
import { errorMessage } from "../ledger/errors";
import { formatBusinessDate } from "../ledger/format";
import { BrandMark } from "../ledger/BrandMark";
import { MoonIcon, SunIcon } from "../ledger/icons";
import { MobileNav } from "../ledger/MobileNav";
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
import { navigateToPanel } from "./route";

/** Desktop breakpoint shared with the ledger artboard (S12-6). */
const DESKTOP_QUERY = "(min-width:960px)";
const AUTO_MINI_QUERY = "(min-width:960px) and (max-width:1179.98px)";
const HEADER_HEIGHT = 56;

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
  children: React.ReactNode;
}

/**
 * Shared chrome of every report section: title + period badge + resolved
 * window caption, then skeleton / error+retry / content — the same
 * states the ledger list uses (S2, S3).
 */
function ReportSection({
  title,
  period,
  loading,
  error,
  onRetry,
  children,
}: SectionFrameProps) {
  const { t, i18n } = useTranslation();
  return (
    <Box component="section" aria-label={title} sx={{ mb: { xs: 3, md: 4 } }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "baseline",
          gap: 1.25,
          mb: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography
          component="h3"
          sx={{ fontSize: { xs: 13, md: 14 }, fontWeight: 750 }}
        >
          {title}
        </Typography>
        {period ? <PeriodBadge status={period.periodStatus} /> : null}
        {period ? (
          <Typography variant="caption" color="text.secondary">
            {`${formatBusinessDate(period.from, i18n.language)} – ${formatBusinessDate(period.to, i18n.language)}`}
          </Typography>
        ) : null}
      </Box>
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
      ) : error ? (
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
      ) : (
        children
      )}
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

/** S1 — per-account income/expense/transfers/net flow table. */
function CashFlowSection({ query, enabled }: ReportQuerySectionProps) {
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
  return (
    <ReportSection
      title={t("reports.cashFlow.title")}
      period={view?.period}
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
}: ReportQuerySectionProps) {
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
  return (
    <ReportSection
      title={t("reports.categories.title")}
      period={view?.period}
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
 * one detector (ant, recurring_charge, concentration, growth), with the
 * headline potential-savings figure and a chip per fired detector.
 */
function AvoidableExpensesSection({ query, enabled }: ReportQuerySectionProps) {
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
  return (
    <ReportSection
      title={t("reports.avoidable.title")}
      period={view?.period}
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
function MonthlySavingsSection({ query, enabled }: ReportQuerySectionProps) {
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

  return (
    <ReportSection
      title={t("reports.savings.title")}
      period={view?.period}
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

/**
 * Reports page (reports-monthly T7, S7, CA-013): the four monthly
 * reports as tables behind a shared month/year + currency selector.
 * Reuses the ledger's Sidebar/MobileNav chrome with `active="reports"`;
 * the Gestión group is hidden here because the management dialogs live
 * on the ledger page.
 */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const autoMiniRail = useMediaQuery(AUTO_MINI_QUERY);
  const { mode, toggleMode } = useThemeMode();
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

  const toggleRail = () => {
    const next = !effectiveRailCollapsed;
    persistRailCollapsed(next);
    setRailCollapsed(next);
  };

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      {desktop ? (
        <Sidebar
          collapsed={effectiveRailCollapsed}
          onToggleCollapsed={toggleRail}
          onNavigateList={navigateToPanel}
          onNavigateReports={() => {}}
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
        <Box
          component="header"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 70,
            height: HEADER_HEIGHT,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            px: { xs: 1.75, md: 2.75 },
            bgcolor: "background.paper",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {desktop ? (
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" sx={{ fontSize: 16, fontWeight: 700 }}>
                {t("app.brand")}{" "}
                <Box
                  component="span"
                  sx={{
                    fontWeight: 500,
                    color: "text.secondary",
                    fontSize: 13,
                  }}
                >
                  · {t("nav.reports")}
                </Box>
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ display: "block" }}
              >
                {t("app.tagline")}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <BrandMark />
              <Typography
                sx={{
                  fontWeight: 750,
                  fontSize: 15,
                  whiteSpace: "nowrap",
                  display: { xs: "none", sm: "block" },
                }}
              >
                {t("app.brand")}
              </Typography>
            </Box>
          )}

          <Box
            sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}
          >
            <IconButton
              onClick={toggleMode}
              aria-pressed={mode === "dark"}
              aria-label={
                mode === "dark"
                  ? t("topbar.themeToLight")
                  : t("topbar.themeToDark")
              }
              sx={{ border: "1px solid", borderColor: "divider" }}
            >
              {mode === "dark" ? (
                <MoonIcon sx={{ fontSize: 19 }} />
              ) : (
                <SunIcon sx={{ fontSize: 19 }} />
              )}
            </IconButton>
            <LanguageSwitcher />
          </Box>
        </Box>

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
          <CashFlowSection query={query} enabled={enabled} />
          <ExpensesByCategorySection query={query} enabled={enabled} />
          <AvoidableExpensesSection query={query} enabled={enabled} />
          <MonthlySavingsSection query={query} enabled={enabled} />
        </Box>
      </Box>

      {desktop ? null : (
        <MobileNav
          onNavigateList={navigateToPanel}
          onNavigateReports={() => {}}
          active="reports"
        />
      )}

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
