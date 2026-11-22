import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { getWorkspace, listCurrencies } from "../ledger/api";
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
  fetchAntExpenses,
  fetchCashFlowReport,
  fetchExpensesByCategory,
  fetchMonthlySavings,
  type AntExpensesView,
  type CashFlowReportView,
  type ExpensesByCategoryView,
  type MonthlySavingsView,
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

interface ReportQuerySectionProps {
  query: ReportPeriodQuery;
  enabled: boolean;
}

/** S1 — per-account income/expense/transfers/net flow table. */
function CashFlowSection({ query, enabled }: ReportQuerySectionProps) {
  const { t, i18n } = useTranslation();
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
          </>
        )
      ) : null}
    </ReportSection>
  );
}

/** S3 — hormiga candidates: ops count, totals, % discretionary, confidence. */
function AntExpensesSection({ query, enabled }: ReportQuerySectionProps) {
  const { t, i18n } = useTranslation();
  const report = useQuery({
    queryKey: ["reports", "ant-expenses", query],
    queryFn: () => fetchAntExpenses(query),
    enabled,
  });
  const money = (decimal: string) =>
    formatReportAmount(decimal, query.currency, i18n.language);
  const view: AntExpensesView | undefined = report.data;
  return (
    <ReportSection
      title={t("reports.ant.title")}
      period={view?.period}
      loading={enabled && report.isLoading}
      error={report.isError ? errorMessage(report.error, t) : null}
      onRetry={() => void report.refetch()}
    >
      {view ? (
        view.groups.length === 0 ? (
          <EmptyState text={t("reports.ant.empty")} />
        ) : (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1 }}
            >
              {`${t("reports.ant.totalDiscretionary")}: ${money(view.totalDiscretionary)}`}
            </Typography>
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={tablePaperSx}
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("reports.ant.label")}</TableCell>
                    <TableCell align="right">
                      {t("reports.ant.operations")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.ant.total")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.ant.average")}
                    </TableCell>
                    <TableCell align="right">
                      {t("reports.ant.percentDiscretionary")}
                    </TableCell>
                    <TableCell>{t("reports.ant.confidence")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {view.groups.map((group) => (
                    <TableRow key={group.key}>
                      <TableCell>{group.label}</TableCell>
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
                              ? "reports.ant.confidenceHigh"
                              : "reports.ant.confidenceLow",
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
              size="small"
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
              size="small"
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
              size="small"
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
          <AntExpensesSection query={query} enabled={enabled} />
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
    </Box>
  );
}
