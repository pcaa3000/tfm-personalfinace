import {
  alpha,
  Avatar,
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CameraIcon,
  MicIcon,
  SwapIcon,
} from "./icons";
import { ReceiptFlow } from "./ReceiptFlow";
import { VoiceFlow } from "./VoiceFlow";
import {
  TransactionForm,
  type TransactionFormValues,
} from "./TransactionForm";
import type {
  AccountView,
  CategoryView,
  CreateCategoryInput,
  TransactionType,
  TransactionView,
} from "./types";

interface Props {
  open: boolean;
  categories: CategoryView[];
  accounts: AccountView[];
  defaultCurrency: string;
  currencies: string[];
  /** Workspace IANA zone used for the businessDate default and submit. */
  timezone?: string | undefined;
  /** Workspace currency exponents (receipt review split amounts). */
  exponentOf?: ((code: string) => number) | undefined;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: TransactionFormValues) => void;
  /** Receipt flow finished — the confirmed movement already exists. */
  onReceiptConfirmed?: ((transaction: TransactionView) => void) | undefined;
  /** Voice flow finished — the confirmed movement already exists. */
  onVoiceConfirmed?: ((transaction: TransactionView) => void) | undefined;
  /** Inline category creation in the manual + review forms (T8, S8). */
  onCreateCategory?:
    | ((input: CreateCategoryInput) => Promise<CategoryView>)
    | undefined;
}

type Picked = TransactionType | "receipt" | "voice";

/**
 * "+ Nuevo movimiento" dialog (S12-1): first step offers the movement
 * types + the ticket/photo entry (receipt-scan-drafts T7, S1) as quick
 * actions; choosing one shows the matching form.
 */
export function NewMovementDialog({
  open,
  categories,
  accounts,
  defaultCurrency,
  currencies,
  timezone,
  exponentOf,
  submitting,
  error,
  onClose,
  onSubmit,
  onReceiptConfirmed,
  onVoiceConfirmed,
  onCreateCategory,
}: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    if (!open) setPicked(null);
  }, [open]);

  const options: {
    type: Picked;
    label: string;
    hint: string;
    icon: React.ReactNode;
    colorKey: "success" | "error" | "secondary" | "primary";
  }[] = [
    {
      type: "income",
      label: t("form.income"),
      hint: t("movement.incomeHint"),
      icon: <ArrowUpIcon fontSize="small" />,
      colorKey: "success",
    },
    {
      type: "expense",
      label: t("form.expense"),
      hint: t("movement.expenseHint"),
      icon: <ArrowDownIcon fontSize="small" />,
      colorKey: "error",
    },
    {
      type: "transfer",
      label: t("form.transfer"),
      hint: t("movement.transferHint"),
      icon: <SwapIcon fontSize="small" />,
      colorKey: "secondary",
    },
    {
      type: "receipt",
      label: t("movement.receipt"),
      hint: t("movement.receiptHint"),
      icon: <CameraIcon fontSize="small" />,
      colorKey: "primary",
    },
    {
      type: "voice",
      label: t("movement.voice"),
      hint: t("movement.voiceHint"),
      icon: <MicIcon fontSize="small" />,
      colorKey: "primary",
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={picked === "receipt" || picked === "voice" ? "sm" : "xs"}
      fullWidth
    >
      <DialogTitle>{t("movement.chooseType")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {picked === null ? (
          <Box sx={{ display: "grid", gap: 1.25 }}>
            {options.map((option) => (
              <ButtonBase
                key={option.type}
                onClick={() => setPicked(option.type)}
                sx={(theme) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  width: "100%",
                  p: 1.5,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "16px",
                  textAlign: "left",
                  "&:hover": {
                    borderColor: theme.palette.primary.main,
                    bgcolor: alpha(theme.palette.primary.main, 0.06),
                  },
                })}
              >
                <Avatar
                  sx={(theme) => ({
                    width: 40,
                    height: 40,
                    bgcolor: alpha(theme.palette[option.colorKey].main, 0.14),
                    color: `${option.colorKey}.main`,
                  })}
                >
                  {option.icon}
                </Avatar>
                <Box>
                  <Typography sx={{ display: "block", fontSize: 14, fontWeight: 700 }}>
                    {option.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.hint}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        ) : picked === "receipt" ? (
          <ReceiptFlow
            categories={categories}
            accounts={accounts}
            defaultCurrency={defaultCurrency}
            currencies={currencies}
            timezone={timezone}
            exponentOf={exponentOf}
            onClose={onClose}
            onConfirmed={(transaction) => onReceiptConfirmed?.(transaction)}
            onCreateCategory={onCreateCategory}
          />
        ) : picked === "voice" ? (
          <VoiceFlow
            categories={categories}
            accounts={accounts}
            defaultCurrency={defaultCurrency}
            currencies={currencies}
            timezone={timezone}
            exponentOf={exponentOf}
            onClose={onClose}
            onConfirmed={(transaction) => onVoiceConfirmed?.(transaction)}
            onCreateCategory={onCreateCategory}
          />
        ) : (
          <TransactionForm
            categories={categories}
            accounts={accounts}
            defaultCurrency={defaultCurrency}
            currencies={currencies}
            submitting={submitting}
            error={error}
            initialValues={{ type: picked }}
            timezone={timezone}
            onCreateCategory={onCreateCategory}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
