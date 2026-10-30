import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { z } from "zod";

import type { AccountView, CategoryView } from "./types";

type FormValues = {
  type: "income" | "expense";
  amount: string;
  currency: string;
  accountId: string;
  businessDate: string;
  concept: string;
  categoryId: string | null;
};

export interface TransactionFormValues extends FormValues {
  timezone: string;
}

const CURRENCIES = ["PEN", "USD", "EUR", "ARS", "JPY", "BHD"];

/** Stable catalog key → localized label; custom categories keep their label. */
export function categoryLabel(
  category: CategoryView,
  t: TFunction,
): string {
  return t(`categories.${category.key}`, { defaultValue: category.label });
}

interface Props {
  categories: CategoryView[];
  accounts: AccountView[];
  defaultCurrency: string;
  submitting: boolean;
  error: string | null;
  initialValues?: Partial<FormValues>;
  submitLabel?: string;
  onSubmit: (values: TransactionFormValues) => void;
}

export function TransactionForm({
  categories,
  accounts,
  defaultCurrency,
  submitting,
  error,
  initialValues,
  submitLabel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();

  const schema = useMemo(
    () =>
      z.object({
        type: z.enum(["income", "expense"]),
        amount: z
          .string()
          .min(1, t("form.validation.amountRequired"))
          .regex(/^\d+(\.\d+)?$/, t("form.validation.amountDecimal")),
        currency: z.string().length(3),
        accountId: z.string().min(1, t("form.validation.accountRequired")),
        businessDate: z.string().min(10, t("form.validation.dateRequired")),
        concept: z
          .string()
          .trim()
          .min(1, t("form.validation.conceptRequired"))
          .max(500),
        categoryId: z.string().nullable(),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "expense",
      amount: "",
      currency: defaultCurrency,
      accountId: "",
      businessDate: new Date().toISOString().slice(0, 10),
      concept: "",
      categoryId: null,
      ...initialValues,
    },
  });

  const selectedCurrency = watch("currency");
  const currencyAccounts = accounts.filter(
    (a) => a.currency === selectedCurrency,
  );

  const submit = handleSubmit((values) => {
    onSubmit({
      ...values,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if (!initialValues) {
      reset();
    }
  });

  return (
    <form onSubmit={submit} aria-label={t("form.newTransaction")}>
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label={t("form.type")} fullWidth>
              <MenuItem value="income">{t("form.income")}</MenuItem>
              <MenuItem value="expense">{t("form.expense")}</MenuItem>
            </TextField>
          )}
        />
        <TextField
          {...register("amount")}
          label={t("form.amount")}
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
          error={Boolean(errors.amount)}
          helperText={errors.amount?.message}
          fullWidth
        />
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label={t("form.currency")} fullWidth>
              {CURRENCIES.map((code) => (
                <MenuItem key={code} value={code}>
                  {code}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
        <Controller
          name="accountId"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              label={t("form.account")}
              error={Boolean(errors.accountId)}
              helperText={
                errors.accountId?.message ??
                (currencyAccounts.length === 0
                  ? t("form.noAccountForCurrency")
                  : undefined)
              }
              fullWidth
            >
              {currencyAccounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
        <TextField
          {...register("businessDate")}
          label={t("form.date")}
          type="date"
          slotProps={{ inputLabel: { shrink: true } }}
          error={Boolean(errors.businessDate)}
          helperText={errors.businessDate?.message}
          fullWidth
        />
        <TextField
          {...register("concept")}
          label={t("form.concept")}
          error={Boolean(errors.concept)}
          helperText={errors.concept?.message}
          fullWidth
        />
        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              label={t("form.category")}
              value={field.value ?? ""}
              onChange={(event) =>
                field.onChange(event.target.value === "" ? null : event.target.value)
              }
              fullWidth
            >
              <MenuItem value="">{t("form.uncategorized")}</MenuItem>
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {categoryLabel(category, t)}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={submitting || (initialValues !== undefined && !isDirty)}
        >
          {submitting ? t("form.saving") : (submitLabel ?? t("form.save"))}
        </Button>
      </Stack>
    </form>
  );
}
