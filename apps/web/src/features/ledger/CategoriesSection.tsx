import {
  Alert,
  Button,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { categoryLabel } from "./TransactionForm";
import type {
  CategoryView,
  CreateCategoryInput,
  ReviseCategoryInput,
} from "./types";

const NATURES = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
] as const;

interface CategoriesSectionProps {
  categories: CategoryView[];
  submitting?: boolean;
  error?: string | null;
  /** When false, renders the manager without its Paper frame and
   *  heading — used inside the Gestión dialog (S12-1). */
  framed?: boolean;
  onCreate: (input: CreateCategoryInput) => void;
  onRevise: (id: string, input: ReviseCategoryInput) => void;
  onArchive: (id: string) => void;
}

/**
 * Workspace category management: global catalog entries are read-only;
 * custom categories can be created, renamed, re-natured and archived
 * without touching historical transactions (RF-040, RF-041, RF-044).
 */
export function CategoriesSection({
  categories,
  submitting,
  error,
  framed = true,
  onCreate,
  onRevise,
  onArchive,
}: CategoriesSectionProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<CategoryView | null>(null);
  const [label, setLabel] = useState("");
  const [nature, setNature] = useState<string>("essential");

  const startEdit = (category: CategoryView) => {
    setEditing(category);
    setLabel(category.label);
    setNature(category.nature);
  };
  const resetForm = () => {
    setEditing(null);
    setLabel("");
    setNature("essential");
  };
  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (editing) {
      onRevise(editing.id, { label: trimmed, nature });
    } else {
      onCreate({ label: trimmed, nature });
    }
    resetForm();
  };

  const content = (
    <>
      {framed ? (
        <Typography variant="h6" component="h2" gutterBottom>
          {t("categories.manage.title")}
        </Typography>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      ) : null}
      <List dense>
        {categories.map((category) => (
          <ListItem
            key={category.id}
            disableGutters
            secondaryAction={
              category.custom ? (
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => startEdit(category)}>
                    {t("categories.manage.edit")}
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => onArchive(category.id)}
                  >
                    {t("categories.manage.archive")}
                  </Button>
                </Stack>
              ) : undefined
            }
          >
            <ListItemText
              primary={categoryLabel(category, t)}
              secondary={`${t(`categories.nature.${category.nature}`)}${
                category.custom ? ` · ${t("categories.manage.custom")}` : ""
              }`}
            />
          </ListItem>
        ))}
      </List>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField
          size="small"
          label={t("categories.manage.name")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <TextField
          select
          size="small"
          label={t("categories.manage.nature")}
          value={nature}
          onChange={(e) => setNature(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          {NATURES.map((n) => (
            <MenuItem key={n} value={n}>
              {t(`categories.nature.${n}`)}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          disabled={submitting || !label.trim()}
          onClick={submit}
        >
          {editing
            ? t("categories.manage.save")
            : t("categories.manage.create")}
        </Button>
        {editing ? (
          <Button onClick={resetForm}>{t("categories.manage.cancel")}</Button>
        ) : null}
      </Stack>
    </>
  );

  return framed ? (
    <Paper variant="outlined" sx={{ p: 3 }}>
      {content}
    </Paper>
  ) : (
    content
  );
}
