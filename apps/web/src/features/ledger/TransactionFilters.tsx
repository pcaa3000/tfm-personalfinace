import {
  Box,
  Button,
  Chip,
  Collapse,
  MenuItem,
  Stack,
  TextField,
  useMediaQuery,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { TransactionListFilters } from "./api";
import {
  currentMonthRange,
  last30DaysRange,
  type DateRange,
} from "./period";
import { categoryLabel } from "./category-label";
import type { CategoryView } from "./types";

const FALLBACK_CURRENCIES = ["PEN", "USD", "EUR", "ARS", "JPY", "BHD"];

/** Desktop breakpoint of the hybrid artboard (same as LedgerPage, S12-6). */
const DESKTOP_QUERY = "(min-width:960px)";

const SECONDARY_PANEL_ID = "transaction-filters-secondary";

interface Props {
  categories: CategoryView[];
  value: TransactionListFilters;
  /** Workspace currency codes; falls back to the built-in catalog. */
  currencies?: string[] | undefined;
  onChange: (next: TransactionListFilters) => void;
}

export function TransactionFilters({
  categories,
  value,
  currencies,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [expanded, setExpanded] = useState(false);
  const currencyOptions = currencies ?? FALLBACK_CURRENCIES;
  const update = (patch: Partial<TransactionListFilters>) =>
    onChange({ ...value, ...patch });

  // S5: quick-period chips mirror the artboard group; the active range
  // (matching from/to) renders pressed.
  const shortcuts: { label: string; range: DateRange }[] = [
    { label: t("filters.currentMonth"), range: currentMonthRange() },
    { label: t("filters.last30Days"), range: last30DaysRange() },
  ];
  const isActive = (range: DateRange) =>
    value.from === range.from && value.to === range.to;
  const shortcutChips = shortcuts.map(({ label, range }) => (
    <Chip
      key={label}
      size="small"
      label={label}
      color={isActive(range) ? "primary" : "default"}
      aria-pressed={isActive(range)}
      onClick={() => update(range)}
    />
  ));

  const searchField = (
    <TextField
      size="small"
      label={t("filters.search")}
      placeholder={t("filters.searchPlaceholder")}
      value={value.q ?? ""}
      onChange={(e) => update({ q: e.target.value || undefined })}
    />
  );

  const secondaryFields = (
    <>
      <TextField
        size="small"
        type="date"
        label={t("filters.from")}
        value={value.from ?? ""}
        onChange={(e) => update({ from: e.target.value || undefined })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        size="small"
        type="date"
        label={t("filters.to")}
        value={value.to ?? ""}
        onChange={(e) => update({ to: e.target.value || undefined })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        size="small"
        select
        label={t("form.type")}
        value={value.type ?? ""}
        onChange={(e) =>
          update({
            type: (e.target.value || undefined) as
              | "income"
              | "expense"
              | "transfer"
              | undefined,
          })
        }
        sx={{ minWidth: 140 }}
      >
        <MenuItem value="">{t("filters.all")}</MenuItem>
        <MenuItem value="income">{t("form.income")}</MenuItem>
        <MenuItem value="expense">{t("form.expense")}</MenuItem>
        <MenuItem value="transfer">{t("form.transfer")}</MenuItem>
      </TextField>
      <TextField
        size="small"
        select
        label={t("form.currency")}
        value={value.currency ?? ""}
        onChange={(e) => update({ currency: e.target.value || undefined })}
        sx={{ minWidth: 100 }}
      >
        <MenuItem value="">{t("filters.all")}</MenuItem>
        {currencyOptions.map((code) => (
          <MenuItem key={code} value={code}>
            {code}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        select
        label={t("form.category")}
        value={value.category ?? ""}
        onChange={(e) => update({ category: e.target.value || undefined })}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="">{t("filters.all")}</MenuItem>
        <MenuItem value="uncategorized">{t("form.uncategorized")}</MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {categoryLabel(category, t)}
          </MenuItem>
        ))}
      </TextField>
    </>
  );

  // S4: below 960px only search stays visible; the rest folds behind a
  // "Filtros" toggle (artboard chip row + collapsible .range pattern).
  return (
    <Box sx={{ mb: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center" }}
      >
        {searchField}
        {desktop ? (
          <>
            {shortcutChips}
            {secondaryFields}
          </>
        ) : (
          <Button
            size="small"
            variant="outlined"
            aria-expanded={expanded}
            aria-controls={SECONDARY_PANEL_ID}
            onClick={() => setExpanded((current) => !current)}
          >
            {t("filters.toggle")}
          </Button>
        )}
      </Stack>
      {desktop ? null : (
        <Collapse id={SECONDARY_PANEL_ID} in={expanded} unmountOnExit>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "center", pt: 1 }}
          >
            {shortcutChips}
            {secondaryFields}
          </Stack>
        </Collapse>
      )}
    </Box>
  );
}
