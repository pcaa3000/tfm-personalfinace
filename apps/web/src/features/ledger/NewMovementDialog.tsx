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

import { ArrowDownIcon, ArrowUpIcon, SwapIcon } from "./icons";
import {
  TransactionForm,
  type TransactionFormValues,
} from "./TransactionForm";
import type {
  AccountView,
  CategoryView,
  TransactionType,
} from "./types";

interface Props {
  open: boolean;
  categories: CategoryView[];
  accounts: AccountView[];
  defaultCurrency: string;
  currencies: string[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: TransactionFormValues) => void;
}

/**
 * "+ Nuevo movimiento" dialog (S12-1): first step offers the three
 * movement types as quick actions; choosing one shows the transaction
 * form with that type pre-selected (artboard quick-action pattern).
 */
export function NewMovementDialog({
  open,
  categories,
  accounts,
  defaultCurrency,
  currencies,
  submitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [pickedType, setPickedType] = useState<TransactionType | null>(null);

  useEffect(() => {
    if (!open) setPickedType(null);
  }, [open]);

  const options: {
    type: TransactionType;
    hint: string;
    icon: React.ReactNode;
    colorKey: "success" | "error" | "secondary";
  }[] = [
    {
      type: "income",
      hint: t("movement.incomeHint"),
      icon: <ArrowUpIcon fontSize="small" />,
      colorKey: "success",
    },
    {
      type: "expense",
      hint: t("movement.expenseHint"),
      icon: <ArrowDownIcon fontSize="small" />,
      colorKey: "error",
    },
    {
      type: "transfer",
      hint: t("movement.transferHint"),
      icon: <SwapIcon fontSize="small" />,
      colorKey: "secondary",
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("movement.chooseType")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {pickedType === null ? (
          <Box sx={{ display: "grid", gap: 1.25 }}>
            {options.map((option) => (
              <ButtonBase
                key={option.type}
                onClick={() => setPickedType(option.type)}
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
                    {t(`form.${option.type}`)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.hint}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        ) : (
          <TransactionForm
            categories={categories}
            accounts={accounts}
            defaultCurrency={defaultCurrency}
            currencies={currencies}
            submitting={submitting}
            error={error}
            initialValues={{ type: pickedType }}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
