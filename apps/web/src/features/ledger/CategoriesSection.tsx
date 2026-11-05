import {
  Alert,
  Button,
  List,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ManageListItem } from "./ManageListItem";
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
      {/* Form sticky above the list (L26/L27): it is the primary
          action and stays visible while the list scrolls inside the
          dialog. Rendered as Paper elevation 24 so its surface matches
          the Dialog's elevation overlay exactly (L28: a plain
          background.paper looked like a different color and killed
          text contrast in dark mode). Responsive grid (L25): single
          column on xs. */}
      <Paper
        square
        elevation={24}
        data-testid="category-form"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 1,
          mb: 1.5,
          pb: 1.5,
          position: "sticky",
          top: 0,
          zIndex: 5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
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
        >
          {NATURES.map((n) => (
            <MenuItem key={n} value={n}>
              {t(`categories.nature.${n}`)}
            </MenuItem>
          ))}
        </TextField>
        <Stack
          direction="row"
          spacing={1}
          sx={{ gridColumn: { xs: "1", sm: "1 / -1" } }}
        >
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
            <Button onClick={resetForm}>
              {t("categories.manage.cancel")}
            </Button>
          ) : null}
        </Stack>
      </Paper>
      <List dense>
        {categories.map((category) => (
          <ManageListItem
            key={category.id}
            primary={categoryLabel(category, t)}
            secondary={`${t(`categories.nature.${category.nature}`)}${
              category.custom ? ` · ${t("categories.manage.custom")}` : ""
            }`}
            actions={
              category.custom ? (
                <>
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
                </>
              ) : undefined
            }
          />
        ))}
      </List>
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
