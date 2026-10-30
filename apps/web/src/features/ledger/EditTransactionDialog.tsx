import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { useTranslation } from "react-i18next";

import { TransactionForm, type TransactionFormValues } from "./TransactionForm";
import type { CategoryView, TransactionView } from "./types";

interface Props {
  transaction: TransactionView | null;
  categories: CategoryView[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (id: string, values: TransactionFormValues) => void;
}

export function EditTransactionDialog({
  transaction,
  categories,
  submitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={transaction !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("dialog.editTitle")}</DialogTitle>
      <DialogContent>
        {transaction ? (
          <TransactionForm
            categories={categories}
            submitting={submitting}
            error={error}
            submitLabel={t("form.saveChanges")}
            initialValues={{
              type: transaction.type,
              amount: transaction.amount,
              currency: transaction.currency,
              businessDate: transaction.businessDate,
              concept: transaction.concept,
              categoryId: transaction.categoryId,
            }}
            onSubmit={(values) => onSubmit(transaction.id, values)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
