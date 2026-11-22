import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getVoiceConsent,
  setVoiceConsent,
  type VoiceConsentView,
  type WorkspacePreferencesPatch,
} from "./api";
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
}

function draftFrom(workspace: WorkspaceView | undefined): Draft {
  return {
    defaultCurrency: workspace?.defaultCurrency ?? "PEN",
    timezone: workspace?.timezone ?? "UTC",
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
  // T5 (S6 — docs/05 revocación): the voice provider consent —
  // fetched fresh on every open so the switch mirrors the persisted
  // flag; a fetch failure hides the section rather than showing a
  // stale decision.
  const [consent, setConsent] = useState<VoiceConsentView | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  // Reset the draft from the workspace each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(workspace));
    }
  }, [open, workspace]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getVoiceConsent()
      .then((view) => {
        if (!cancelled) setConsent(view);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onToggleConsent = (granted: boolean) => {
    setConsentBusy(true);
    setVoiceConsent(granted)
      .then((view) => setConsent(view))
      .catch(() => undefined)
      .finally(() => setConsentBusy(false));
  };

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
          {/* T5 (S6): revoke/re-grant the voice provider consent —
              docs/05 stops new audio sends immediately on revoke. */}
          {consent !== null ? (
            <Stack spacing={0.5}>
              <FormControlLabel
                control={
                  <Switch
                    checked={consent.granted}
                    disabled={consentBusy}
                    onChange={(event) =>
                      onToggleConsent(event.target.checked)
                    }
                  />
                }
                label={t("preferences.voiceConsent")}
              />
              <Typography variant="caption" color="text.secondary">
                {t("preferences.voiceConsentHint")}
              </Typography>
            </Stack>
          ) : null}
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
