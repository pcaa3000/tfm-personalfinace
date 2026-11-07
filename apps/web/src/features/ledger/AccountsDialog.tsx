import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AmountText } from "./AmountText";
import { ManageListItem } from "./ManageListItem";
import {
  ACCOUNT_KINDS,
  type AccountView,
  type CreateAccountInput,
  type ReviseAccountInput,
} from "./types";

interface Props {
  open: boolean;
  accounts: AccountView[];
  /** Workspace currency codes for the selector. */
  currencies: string[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: CreateAccountInput) => void;
  onRevise: (id: string, input: ReviseAccountInput) => void;
  onArchive: (id: string) => void;
  /** Restores an archived account (T25). Optional for older callers. */
  onUnarchive?: (id: string) => void;
}

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Gestión → Cuentas (S12-1, S12-2): list, create (name, currency, one of
 * the 8 kinds, optional initialBalance), revise and archive.
 */
export function AccountsDialog({
  open,
  accounts,
  currencies,
  submitting,
  error,
  onClose,
  onCreate,
  onRevise,
  onArchive,
  onUnarchive,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<AccountView | null>(null);
  const activeAccounts = accounts.filter((a) => a.archivedAt === null);
  const archivedAccounts = accounts.filter((a) => a.archivedAt !== null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "PEN");
  const [kind, setKind] = useState<string>("bank");
  const [initialBalance, setInitialBalance] = useState("");

  // keep the select value inside the workspace currency options even
  // when the catalog resolves after the dialog mounted
  const currencyValue = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? currency);

  const startEdit = (account: AccountView) => {
    setEditing(account);
    setName(account.name);
    setCurrency(account.currency);
    setKind(account.kind);
    setInitialBalance(account.initialBalance);
  };

  const resetForm = () => {
    setEditing(null);
    setName("");
    setCurrency(currencies[0] ?? "PEN");
    setKind("bank");
    setInitialBalance("");
  };

  const balanceInvalid =
    initialBalance !== "" && !DECIMAL.test(initialBalance);

  const dirty = editing
    ? name.trim() !== editing.name ||
      kind !== editing.kind ||
      initialBalance !== editing.initialBalance
    : name.trim() !== "";

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || balanceInvalid) return;
    const balance = initialBalance === "" ? undefined : initialBalance;
    if (editing) {
      onRevise(editing.id, {
        name: trimmed,
        kind,
        ...(balance !== undefined ? { initialBalance: balance } : {}),
      });
    } else {
      onCreate({
        name: trimmed,
        currency,
        kind,
        ...(balance !== undefined ? { initialBalance: balance } : {}),
      });
    }
    resetForm();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("accounts.title")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        ) : null}
        {activeAccounts.length === 0 ? (
          <Typography color="text.secondary">{t("accounts.empty")}</Typography>
        ) : (
          <List dense>
            {activeAccounts.map((account) => (
              <ManageListItem
                key={account.id}
                primary={account.name}
                secondary={
                  <>
                    {`${account.currency} · ${t(
                      `accounts.kind.${account.kind}`,
                      { defaultValue: account.kind },
                    )} · ${t("accounts.initialBalance")} `}
                    <AmountText
                      amount={account.initialBalance}
                      currency={account.currency}
                    />
                  </>
                }
                actions={
                  <>
                    <Button size="small" onClick={() => startEdit(account)}>
                      {t("accounts.edit")}
                    </Button>
                    <Button
                      size="small"
                      color="warning"
                      onClick={() => onArchive(account.id)}
                    >
                      {t("accounts.archive")}
                    </Button>
                  </>
                }
              />
            ))}
          </List>
        )}
        {archivedAccounts.length > 0 ? (
          <Box data-part="archived-accounts" sx={{ mt: 1.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 700, textTransform: "uppercase" }}
            >
              {t("accounts.archivedTitle")}
            </Typography>
            <List dense>
              {archivedAccounts.map((account) => (
                <ManageListItem
                  key={account.id}
                  primary={account.name}
                  secondary={`${account.currency} · ${t(`accounts.kind.${account.kind}`, { defaultValue: account.kind })}`}
                  actions={
                    <Button
                      size="small"
                      onClick={() => onUnarchive?.(account.id)}
                    >
                      {t("accounts.restore")}
                    </Button>
                  }
                />
              ))}
            </List>
          </Box>
        ) : null}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 1,
            mt: 1.5,
          }}
        >
          <TextField
            size="small"
            label={t("accounts.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            select
            size="small"
            label={t("accounts.currency")}
            value={currencyValue}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={editing !== null}
          >
            {currencies.map((code) => (
              <MenuItem key={code} value={code}>
                {code}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("accounts.kindLabel")}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {ACCOUNT_KINDS.map((accountKind) => (
              <MenuItem key={accountKind} value={accountKind}>
                {t(`accounts.kind.${accountKind}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t("accounts.initialBalance")}
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            error={balanceInvalid}
            helperText={
              balanceInvalid ? t("form.validation.amountDecimal") : undefined
            }
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
          />
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button
            variant="contained"
            disabled={submitting || !dirty || balanceInvalid}
            onClick={submit}
          >
            {editing ? t("accounts.save") : t("accounts.create")}
          </Button>
          {editing ? (
            <Button onClick={resetForm}>{t("accounts.cancel")}</Button>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
