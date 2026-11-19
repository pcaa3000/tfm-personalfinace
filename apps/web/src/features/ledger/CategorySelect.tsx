import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  type TextFieldProps,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "./api";
import { findReusableCategory } from "./category-key";
import { categoryLabel } from "./category-label";
import { errorMessage } from "./errors";
import { PlusIcon } from "./icons";
import type { CategoryView, CreateCategoryInput } from "./types";

/** Option value that opens the inline create mini-form (never emitted). */
const CREATE_CATEGORY_VALUE = "__tfm_create_category__";

const NATURES = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
] as const;

export interface CategorySelectProps
  extends Omit<
    TextFieldProps,
    "select" | "value" | "onChange" | "children"
  > {
  categories: CategoryView[];
  /** Raw option value — category ids may carry a `categoryValuePrefix`. */
  value: string;
  /** Emitted for regular options only; the "new category" item opens the mini-form. */
  onChange: (value: string) => void;
  /** Menu items rendered before the categories (e.g. "Sin categorizar"). */
  leadingOptions?: React.ReactNode;
  /** Prefix applied to category ids in option values ("" by default). */
  categoryValuePrefix?: string;
  /**
   * Enables the trailing "Nueva categoría" item (receipt-scan-drafts T8,
   * S8): opens a mini-form (label + nature, the same fields the
   * categories manager uses), posts through this callback and selects
   * the resolved category — create-or-reuse, so a CATEGORY_KEY_TAKEN
   * conflict maps back to the existing category instead of erroring.
   */
  onCreateCategory?:
    | ((input: CreateCategoryInput) => Promise<CategoryView>)
    | undefined;
}

/**
 * Shared category selector (S8): renders the workspace categories plus
 * caller-provided leading options and, when `onCreateCategory` is given,
 * a trailing action that creates a category without leaving the flow.
 * A freshly created category is kept as an extra option so its label
 * renders before the categories query refresh lands.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  leadingOptions,
  categoryValuePrefix = "",
  onCreateCategory,
  sx,
  ...textFieldProps
}: CategorySelectProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [nature, setNature] = useState<string>("essential");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [extraCategory, setExtraCategory] = useState<CategoryView | null>(
    null,
  );

  const prefix = categoryValuePrefix;
  const shownExtra =
    extraCategory && !categories.some((c) => c.id === extraCategory.id)
      ? extraCategory
      : null;

  const closeDialog = () => {
    setDialogOpen(false);
    setName("");
    setNature("essential");
    setCreateError(null);
    setCreating(false);
  };

  const submit = () => {
    const label = name.trim();
    if (!label || !onCreateCategory || creating) return;
    setCreating(true);
    setCreateError(null);
    void onCreateCategory({ label, nature })
      .then((created) => {
        if (!categories.some((c) => c.id === created.id)) {
          setExtraCategory(created);
        }
        onChange(`${prefix}${created.id}`);
        closeDialog();
      })
      .catch((cause: unknown) => {
        // Create-or-reuse (S8): a key conflict means the category
        // already exists — select it instead of erroring out.
        if (cause instanceof ApiError && cause.code === "CATEGORY_KEY_TAKEN") {
          const existing = findReusableCategory(label, categories);
          if (existing) {
            onChange(`${prefix}${existing.id}`);
            closeDialog();
            return;
          }
        }
        setCreateError(errorMessage(cause, t));
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const selectField = (
    <TextField
      {...textFieldProps}
      select
      value={value}
      // `sx` styles the component root: the wrapping Stack when the
      // inline-create button is rendered, the field itself otherwise.
      sx={onCreateCategory ? { flex: 1, minWidth: 0 } : sx}
      onChange={(event) => {
        const next = event.target.value;
        if (next === CREATE_CATEGORY_VALUE) {
          setDialogOpen(true);
          return;
        }
        onChange(next);
      }}
    >
      {leadingOptions}
      {categories.map((category) => (
        <MenuItem key={category.id} value={`${prefix}${category.id}`}>
          {categoryLabel(category, t)}
        </MenuItem>
      ))}
      {shownExtra ? (
        <MenuItem value={`${prefix}${shownExtra.id}`}>
          {categoryLabel(shownExtra, t)}
        </MenuItem>
      ) : null}
      {onCreateCategory ? (
        <Divider key="create-divider" />
      ) : null}
      {onCreateCategory ? (
        <MenuItem value={CREATE_CATEGORY_VALUE} sx={{ color: "primary.main" }}>
          <PlusIcon fontSize="small" sx={{ mr: 1 }} />
          {t("categories.inline.action")}
        </MenuItem>
      ) : null}
    </TextField>
  );

  return (
    <>
      {onCreateCategory ? (
        <Stack
          direction="row"
          spacing={1}
          sx={[
            { alignItems: "flex-start" },
            ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
          ]}
        >
          {selectField}
          <Tooltip title={t("categories.inline.action")}>
            {/* span keeps the tooltip working while the button is disabled */}
            <span>
              <IconButton
                aria-label={t("categories.inline.action")}
                color="primary"
                disabled={textFieldProps.disabled}
                onClick={() => setDialogOpen(true)}
                sx={{ mt: 0.5 }}
              >
                <PlusIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      ) : (
        selectField
      )}
      {onCreateCategory ? (
        <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="xs" fullWidth>
          <DialogTitle>{t("categories.inline.title")}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {createError ? (
                <Alert severity="error">{createError}</Alert>
              ) : null}
              <TextField
                label={t("categories.manage.name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                fullWidth
              />
              <TextField
                select
                label={t("categories.manage.nature")}
                value={nature}
                onChange={(event) => setNature(event.target.value)}
                fullWidth
              >
                {NATURES.map((n) => (
                  <MenuItem key={n} value={n}>
                    {t(`categories.nature.${n}`)}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeDialog} disabled={creating}>
              {t("categories.manage.cancel")}
            </Button>
            <Button
              variant="contained"
              disabled={creating || !name.trim()}
              onClick={submit}
            >
              {creating ? t("form.saving") : t("categories.manage.create")}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </>
  );
}
