import { MenuItem, Stack, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";

import type { TransactionListFilters } from "./api";
import { categoryLabel } from "./TransactionForm";
import type { CategoryView } from "./types";

const FALLBACK_CURRENCIES = ["PEN", "USD", "EUR", "ARS", "JPY", "BHD"];

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
  const currencyOptions = currencies ?? FALLBACK_CURRENCIES;
  const update = (patch: Partial<TransactionListFilters>) =>
    onChange({ ...value, ...patch });

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mb: 1 }}>
      <TextField
        size="small"
        label={t("filters.search")}
        value={value.q ?? ""}
        onChange={(e) => update({ q: e.target.value || undefined })}
      />
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
    </Stack>
  );
}
