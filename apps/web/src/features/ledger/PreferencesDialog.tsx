import {
  Alert,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
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

/** Gestión → Preferencias (S12-1): workspace settings (RF-003/RF-004). */
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

  const currencyOptions = currencies.length
    ? currencies
    : [workspace?.defaultCurrency ?? "PEN"];

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
            value={workspace?.defaultCurrency ?? "PEN"}
            disabled={submitting}
            onChange={(e) => onPatch({ defaultCurrency: e.target.value })}
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
            value={workspace?.timezone ?? "UTC"}
            disabled={submitting}
            onChange={(e) => onPatch({ timezone: e.target.value })}
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
            value={workspace?.locale ?? "es-PE"}
            disabled={submitting}
            onChange={(e) => onPatch({ locale: e.target.value })}
          >
            {LOCALES.map((locale) => (
              <MenuItem key={locale} value={locale}>
                {locale}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
