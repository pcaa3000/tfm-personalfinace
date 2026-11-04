import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CurrencyView, IsoCurrencyView } from "./types";

interface Props {
  open: boolean;
  currencies: CurrencyView[];
  catalog: IsoCurrencyView[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: (code: string) => void;
  onRevise: (id: string, input: { code: string }) => void;
  onArchive: (id: string) => void;
}

function currencyName(
  entry: Pick<CurrencyView, "code" | "nameEn" | "nameEs">,
  language: string,
): string {
  return language.startsWith("en") ? entry.nameEn : entry.nameEs;
}

/**
 * Gestión → Monedas (S12-4, L20/L21): active workspace currencies with
 * code edit + archive, and the searchable ISO 4217 catalog with an
 * "Agregar" action per row.
 */
export function CurrenciesDialog({
  open,
  currencies,
  catalog,
  submitting,
  error,
  onClose,
  onAdd,
  onRevise,
  onArchive,
}: Props) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CurrencyView | null>(null);
  const [code, setCode] = useState("");

  // Basic-name search (L21): accent/case-insensitive so 'dolar' finds
  // 'Dólar' and 'soles' finds 'Sol' without typing the diacritic.
  const fold = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const normalized = fold(query.trim());
  const activeCodes = new Set(currencies.map((c) => c.code));
  const matches = normalized
    ? catalog.filter(
        (entry) =>
          fold(entry.code).includes(normalized) ||
          fold(entry.nameEs).includes(normalized) ||
          fold(entry.nameEn).includes(normalized),
      )
    : [];

  const startEdit = (currency: CurrencyView) => {
    setEditing(currency);
    setCode(currency.code);
  };

  const submitRevise = () => {
    const next = code.trim().toUpperCase();
    if (!editing || next.length !== 3 || next === editing.code) return;
    onRevise(editing.id, { code: next });
    setEditing(null);
    setCode("");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("currencies.title")}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        ) : null}

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t("currencies.active")}
        </Typography>
        <List dense>
          {currencies.map((currency) => (
            <ListItem
              key={currency.id}
              disableGutters
              secondaryAction={
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => startEdit(currency)}>
                    {t("currencies.edit")}
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => onArchive(currency.id)}
                  >
                    {t("currencies.archive")}
                  </Button>
                </Stack>
              }
            >
              <ListItemText
                primary={`${currency.code} — ${currencyName(currency, i18n.language)}`}
              />
            </ListItem>
          ))}
        </List>
        {editing ? (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label={t("currencies.code")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              slotProps={{ htmlInput: { maxLength: 3 } }}
              sx={{ width: 120 }}
            />
            <Button
              variant="contained"
              disabled={
                submitting ||
                code.trim().length !== 3 ||
                code.trim().toUpperCase() === editing.code
              }
              onClick={submitRevise}
            >
              {t("currencies.save")}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setCode("");
              }}
            >
              {t("currencies.cancel")}
            </Button>
          </Stack>
        ) : null}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t("currencies.catalog")}
        </Typography>
        <TextField
          size="small"
          fullWidth
          label={t("currencies.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {normalized ? (
          matches.length === 0 ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t("currencies.empty")}
            </Typography>
          ) : (
            <List dense>
              {matches.map((entry) => (
                <ListItem
                  key={entry.code}
                  disableGutters
                  secondaryAction={
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={submitting || activeCodes.has(entry.code)}
                      onClick={() => onAdd(entry.code)}
                    >
                      {t("currencies.add")}
                    </Button>
                  }
                >
                  <ListItemText
                    primary={`${entry.code} — ${currencyName(entry, i18n.language)}`}
                  />
                </ListItem>
              ))}
            </List>
          )
        ) : (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("currencies.catalogHint")}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
