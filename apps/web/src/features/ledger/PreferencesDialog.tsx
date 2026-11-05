import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WorkspacePreferencesPatch } from "./api";
import type { WorkspaceView } from "./types";

const TIMEZONES = [
  "UTC",
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
  "Europe/Madrid",
];

const LOCALES = ["es-PE", "es-ES", "es-MX", "en-US", "en-GB"];

interface Props {
  open: boolean;
  workspace: WorkspaceView | undefined;
  /** Workspace currency codes for the default-currency selector. */
  currencies: string[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onPatch: (patch: WorkspacePreferencesPatch) => void;
}

interface Draft {
  defaultCurrency: string;
  timezone: string;
  locale: string;
}

function draftFrom(workspace: WorkspaceView | undefined): Draft {
  return {
    defaultCurrency: workspace?.defaultCurrency ?? "PEN",
    timezone: workspace?.timezone ?? "UTC",
    locale: workspace?.locale ?? "es-PE",
  };
}

/**
 * Gestión → Preferencias (S12-1): workspace settings (RF-003/RF-004).
 * Explicit-save draft (T19): selects edit a local copy and a single
 * PATCH with the dirty fields is sent on Guardar — users perceive the
 * save and can preview combinations before committing.
 */
export function PreferencesDialog({
  open,
  workspace,
  currencies,
  submitting,
  error,
  onClose,
  onPatch,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(workspace));

  // Reset the draft from the workspace each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(workspace));
    }
  }, [open, workspace]);

  const currencyOptions = currencies.length
    ? currencies
    : [draft.defaultCurrency];

  const patch: WorkspacePreferencesPatch = {};
  const baseline = draftFrom(workspace);
  if (draft.defaultCurrency !== baseline.defaultCurrency) {
    patch.defaultCurrency = draft.defaultCurrency;
  }
  if (draft.timezone !== baseline.timezone) {
    patch.timezone = draft.timezone;
  }
  if (draft.locale !== baseline.locale) {
    patch.locale = draft.locale;
  }
  const dirty = Object.keys(patch).length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("preferences.title")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            select
            size="small"
            label={t("settings.defaultCurrency")}
            value={draft.defaultCurrency}
            disabled={submitting}
            onChange={(e) =>
              setDraft((current) => ({
                ...current,
                defaultCurrency: e.target.value,
              }))
            }
          >
            {currencyOptions.map((code) => (
              <MenuItem key={code} value={code}>
                {code}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("settings.timezone")}
            value={draft.timezone}
            disabled={submitting}
            onChange={(e) =>
              setDraft((current) => ({ ...current, timezone: e.target.value }))
            }
          >
            {TIMEZONES.map((timezone) => (
              <MenuItem key={timezone} value={timezone}>
                {timezone}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("settings.locale")}
            value={draft.locale}
            disabled={submitting}
            onChange={(e) =>
              setDraft((current) => ({ ...current, locale: e.target.value }))
            }
          >
            {LOCALES.map((locale) => (
              <MenuItem key={locale} value={locale}>
                {locale}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>
          {t("preferences.cancel")}
        </Button>
        <Button
          variant="contained"
          disabled={submitting || !dirty}
          onClick={() => {
            if (dirty) {
              onPatch(patch);
            }
          }}
        >
          {submitting ? t("form.saving") : t("preferences.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
