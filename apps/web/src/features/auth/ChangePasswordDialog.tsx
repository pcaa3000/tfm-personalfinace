import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "./auth";

/** Supabase Auth minimum password length. */
const MIN_PASSWORD_LENGTH = 6;

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Account menu → Cambiar contraseña (T29, L38): updates the signed-in
 * user's password through Supabase Auth (`auth.updateUser`). Fields
 * reset every time the dialog opens; inline validation blocks submit
 * until both passwords are present, ≥ 6 chars and matching.
 */
export function ChangePasswordDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState({ password: false, confirm: false });
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  // Fresh fields every time the dialog opens.
  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirm("");
      setTouched({ password: false, confirm: false });
      setSubmitting(false);
      setFailed(false);
    }
  }, [open]);

  const passwordError = !password
    ? t("account.passwordRequired")
    : password.length < MIN_PASSWORD_LENGTH
      ? t("account.passwordTooShort")
      : null;
  const confirmError = !confirm
    ? t("account.passwordRequired")
    : confirm !== password
      ? t("account.passwordMismatch")
      : null;
  const invalid = passwordError !== null || confirmError !== null;

  // Show the inline error once the field has content or was blurred —
  // an untouched empty field stays quiet but still blocks submit.
  const showPasswordError =
    passwordError !== null && (touched.password || password !== "");
  const showConfirmError =
    confirmError !== null && (touched.confirm || confirm !== "");

  const submit = async () => {
    setSubmitting(true);
    setFailed(false);
    try {
      await updatePassword(password);
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("account.changePassword")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {failed ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {t("account.error")}
          </Alert>
        ) : null}
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            type="password"
            size="small"
            label={t("account.newPassword")}
            autoComplete="new-password"
            fullWidth
            value={password}
            error={showPasswordError}
            helperText={showPasswordError ? passwordError : undefined}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() =>
              setTouched((current) => ({ ...current, password: true }))
            }
          />
          <TextField
            type="password"
            size="small"
            label={t("account.confirmPassword")}
            autoComplete="new-password"
            fullWidth
            value={confirm}
            error={showConfirmError}
            helperText={showConfirmError ? confirmError : undefined}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() =>
              setTouched((current) => ({ ...current, confirm: true }))
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>
          {t("account.cancel")}
        </Button>
        <Button
          variant="contained"
          disabled={submitting || invalid}
          onClick={() => void submit()}
        >
          {submitting ? t("form.saving") : t("account.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
