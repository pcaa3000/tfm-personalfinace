import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { useTranslation } from "react-i18next";

import { CategoriesSection } from "./CategoriesSection";
import type {
  CategoryView,
  CreateCategoryInput,
  ReviseCategoryInput,
} from "./types";

interface Props {
  open: boolean;
  categories: CategoryView[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: CreateCategoryInput) => void;
  onRevise: (id: string, input: ReviseCategoryInput) => void;
  onArchive: (id: string) => void;
}

/** Gestión → Categorías: the existing CRUD surface inside a dialog (S12-1). */
export function CategoriesDialog(props: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("categories.manage.title")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <CategoriesSection
          framed={false}
          categories={props.categories}
          submitting={props.submitting}
          error={props.error}
          onCreate={props.onCreate}
          onRevise={props.onRevise}
          onArchive={props.onArchive}
        />
      </DialogContent>
    </Dialog>
  );
}
