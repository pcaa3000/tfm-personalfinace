import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { z } from "zod";

import type { AccountView, CategoryView, TransactionType } from "./types";

type FormValues = {
  type: TransactionType;
  amount: string;
  currency: string;
  accountId: string;
  destinationAccountId: string;
  businessDate: string;
  concept: string;
  categoryId: string | null;
};

export interface TransactionFormValues
  extends Omit<FormValues, "destinationAccountId"> {
  timezone: string;
  /** null unless type === "transfer" (server forbids it otherwise). */
  destinationAccountId: string | null;
}

const FALLBACK_CURRENCIES = ["PEN", "USD", "EUR", "ARS", "JPY", "BHD"];

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
  /** Workspace currency codes; falls back to the built-in catalog. */
  currencies?: string[] | undefined;
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
  currencies,
  submitting,
  error,
  initialValues,
  submitLabel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const currencyOptions = currencies ?? FALLBACK_CURRENCIES;

  const schema = useMemo(
    () =>
      z
        .object({
          type: z.enum(["income", "expense", "transfer"]),
          amount: z
            .string()
            .min(1, t("form.validation.amountRequired"))
            .regex(/^\d+(\.\d+)?$/, t("form.validation.amountDecimal")),
          currency: z.string().length(3),
          accountId: z.string().min(1, t("form.validation.accountRequired")),
          destinationAccountId: z.string(),
          businessDate: z.string().min(10, t("form.validation.dateRequired")),
          concept: z
            .string()
            .trim()
            .min(1, t("form.validation.conceptRequired"))
            .max(500),
          categoryId: z.string().nullable(),
        })
        .superRefine((values, ctx) => {
          if (values.type !== "transfer") return;
          if (!values.destinationAccountId) {
            ctx.addIssue({
              code: "custom",
              path: ["destinationAccountId"],
              message: t("form.validation.destinationRequired"),
            });
          } else if (values.destinationAccountId === values.accountId) {
            ctx.addIssue({
              code: "custom",
              path: ["destinationAccountId"],
              message: t("form.validation.destinationSameAccount"),
            });
          }
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "expense",
      amount: "",
      currency: defaultCurrency,
      accountId: "",
      destinationAccountId: "",
      businessDate: new Date().toISOString().slice(0, 10),
      concept: "",
      categoryId: null,
      ...initialValues,
    },
  });

  const selectedType = watch("type");
  const selectedCurrency = watch("currency");
  const selectedAccountId = watch("accountId");
  const currencyAccounts = accounts.filter(
    (a) => a.currency === selectedCurrency,
  );
  const destinationAccounts = currencyAccounts.filter(
    (a) => a.id !== selectedAccountId,
  );
  const isTransfer = selectedType === "transfer";

  useEffect(() => {
    if (initialValues?.currency === undefined && !isDirty) {
      setValue("currency", defaultCurrency, { shouldDirty: false });
    }
  }, [defaultCurrency, initialValues?.currency, isDirty, setValue]);

  // INV-CTA-04: a destination that becomes equal to the source account is
  // cleared (e.g. the user picks the same account in both selectors).
  useEffect(() => {
    if (
      isTransfer &&
      selectedAccountId &&
      watch("destinationAccountId") === selectedAccountId
    ) {
      setValue("destinationAccountId", "", { shouldValidate: false });
    }
  }, [isTransfer, selectedAccountId, setValue, watch]);

  const submit = handleSubmit((values) => {
    onSubmit({
      ...values,
      destinationAccountId:
        values.type === "transfer" ? values.destinationAccountId : null,
      categoryId: values.type === "transfer" ? null : values.categoryId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if (!initialValues) {
      reset({
        type: "expense",
        amount: "",
        currency: defaultCurrency,
        accountId: "",
        destinationAccountId: "",
        businessDate: new Date().toISOString().slice(0, 10),
        concept: "",
        categoryId: null,
      });
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
              <MenuItem value="transfer">{t("form.transfer")}</MenuItem>
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
            <TextField
              {...field}
              select
              label={t("form.currency")}
              onChange={(event) => {
                const nextCurrency = event.target.value;
                field.onChange(nextCurrency);
                const currentAccount = accounts.find(
                  (a) => a.id === selectedAccountId,
                );
                if (currentAccount && currentAccount.currency !== nextCurrency) {
                  setValue("accountId", "", { shouldValidate: false });
                }
                setValue("destinationAccountId", "", { shouldValidate: false });
              }}
              fullWidth
            >
              {currencyOptions.map((code) => (
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
              value={
                currencyAccounts.some((a) => a.id === field.value)
                  ? field.value
                  : ""
              }
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
        {isTransfer ? (
          <Controller
            name="destinationAccountId"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                value={
                  destinationAccounts.some((a) => a.id === field.value)
                    ? field.value
                    : ""
                }
                select
                label={t("form.destinationAccount")}
                error={Boolean(errors.destinationAccountId)}
                helperText={
                  errors.destinationAccountId?.message ??
                  t("form.destinationAccountHint")
                }
                fullWidth
              >
                {destinationAccounts.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        ) : null}
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
        {!isTransfer ? (
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
        ) : null}
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
