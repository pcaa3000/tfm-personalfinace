import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { confirmReceipt, rejectReceipt } from "./api";
import { CategorySelect } from "./CategorySelect";
import { errorMessage } from "./errors";
import { minorToDecimalString, todayInTimeZone } from "./format";
import { TrashIcon } from "./icons";
import {
  draftToReviewState,
  reviewSplitsTotalMinorUnits,
  reviewStateToConfirmInput,
  type ReceiptReviewState,
  type ReceiptScanView,
  type SplitSelection,
} from "./receipt-draft";
import {
  ReceiptPollTimeoutError,
  ReceiptScanFailedError,
  uploadAndAwaitDraft,
} from "./receipt-scan-flow";
import { defaultCurrencyExponent } from "./summarize";
import type {
  AccountView,
  CategoryView,
  CreateCategoryInput,
  TransactionView,
} from "./types";

interface Props {
  categories: CategoryView[];
  accounts: AccountView[];
  defaultCurrency: string;
  currencies?: string[] | undefined;
  /** Workspace IANA zone used for the fallback businessDate. */
  timezone?: string | undefined;
  /** Workspace currency exponents (minor units ⇄ decimal text). */
  exponentOf?: ((code: string) => number) | undefined;
  /** Test hooks — default to ~2s cadence / ~60s budget. */
  pollIntervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  /** Inline category creation in the review rows (T8, S8). */
  onCreateCategory?:
    | ((input: CreateCategoryInput) => Promise<CategoryView>)
    | undefined;
  onConfirmed: (transaction: TransactionView) => void;
  onClose: () => void;
}

type Step = "pick" | "working" | "review";

const selectionValue = (selection: SplitSelection): string =>
  selection.kind === "category"
    ? `cat:${selection.categoryId}`
    : selection.kind === "new"
      ? "new"
      : "none";

const selectionFromValue = (
  value: string,
  current: SplitSelection,
): SplitSelection => {
  if (value === "new") return current; // keep the proposed new category
  if (value === "none") return { kind: "uncategorized" };
  return { kind: "category", categoryId: value.slice(4) };
};

/**
 * Ticket/photo movement (receipt-scan-drafts T7, S1+S2+S7+S10):
 * capture → upload → poll → review → confirm/reject. Uploads need
 * connectivity — IndexedDB cannot hold binaries, so a network
 * TypeError surfaces the "requires connection" copy instead of the
 * offline queue (out of scope for the MVP).
 */
export function ReceiptFlow({
  categories,
  accounts,
  defaultCurrency,
  currencies,
  timezone,
  exponentOf = defaultCurrencyExponent,
  pollIntervalMs,
  timeoutMs,
  onCreateCategory,
  onConfirmed,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("pick");
  const [phase, setPhase] = useState<"uploading" | "analyzing">("uploading");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scan, setScan] = useState<ReceiptScanView | null>(null);
  const [review, setReview] = useState<ReceiptReviewState | null>(null);
  const [submitting, setSubmitting] = useState<"confirm" | "reject" | null>(
    null,
  );
  const previewRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const effectiveTimezone =
    timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const flowError = (cause: unknown): string => {
    if (cause instanceof TypeError) return t("receipt.requiresConnection");
    if (cause instanceof ReceiptPollTimeoutError) {
      return t("receipt.pollTimeout");
    }
    if (cause instanceof ReceiptScanFailedError) {
      return t("receipt.scanFailed");
    }
    return errorMessage(cause, t);
  };

  const startScan = (picked: File) => {
    setStep("working");
    setPhase("uploading");
    setError(null);
    void uploadAndAwaitDraft(picked, {
      ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      onPhase: setPhase,
    })
      .then((result) => {
        setScan(result.scan);
        setReview(
          draftToReviewState(result.draft, {
            categories,
            defaultCurrency,
            fallbackDate: todayInTimeZone(effectiveTimezone),
            exponentOf,
          }),
        );
        setStep("review");
      })
      .catch((cause: unknown) => {
        setError(flowError(cause));
        setStep("pick");
      });
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current =
      typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(picked)
        : null;
    setPreviewUrl(previewRef.current);
    startScan(picked);
  };

  const patchReview = (patch: Partial<ReceiptReviewState>) =>
    setReview((prev) => (prev ? { ...prev, ...patch } : prev));

  const patchSplit = (index: number, patch: Partial<ReceiptReviewState["splits"][number]>) =>
    setReview((prev) =>
      prev
        ? {
            ...prev,
            splits: prev.splits.map((row, i) =>
              i === index ? { ...row, ...patch } : row,
            ),
          }
        : prev,
    );

  const onConfirm = () => {
    if (!review || !scan) return;
    const input = reviewStateToConfirmInput(review, exponentOf);
    if (!input) return;
    setSubmitting("confirm");
    setError(null);
    confirmReceipt(scan.id, {
      ...input,
      idempotencyKey: crypto.randomUUID(),
    })
      .then((result) => onConfirmed(result.transaction))
      .catch((cause: unknown) => {
        setError(flowError(cause));
        setSubmitting(null);
      });
  };

  const onReject = () => {
    if (!scan) return;
    setSubmitting("reject");
    setError(null);
    rejectReceipt(scan.id)
      .then(() => onClose())
      .catch((cause: unknown) => {
        setError(flowError(cause));
        setSubmitting(null);
      });
  };

  const preview = previewUrl ? (
    <Box
      component="img"
      src={previewUrl}
      alt={t("receipt.previewAlt")}
      sx={{
        maxWidth: "100%",
        maxHeight: 180,
        borderRadius: "12px",
        objectFit: "contain",
        border: "1px solid",
        borderColor: "divider",
      }}
    />
  ) : null;

  if (step === "working") {
    return (
      <Stack spacing={2} sx={{ py: 1 }} data-part="receipt-working">
        {preview}
        <Typography color="text.secondary" aria-live="polite">
          {phase === "uploading"
            ? t("receipt.uploading")
            : t("receipt.analyzing")}
        </Typography>
      </Stack>
    );
  }

  if (step === "review" && review) {
    const currencyAccounts = accounts.filter(
      (a) => a.currency === review.currency,
    );
    const totalMinor = reviewSplitsTotalMinorUnits(review, exponentOf);
    const totalText =
      totalMinor === null
        ? "—"
        : minorToDecimalString(
            BigInt(totalMinor),
            exponentOf(review.currency),
          );
    const confirmInput = reviewStateToConfirmInput(review, exponentOf);

    return (
      <Stack spacing={2} data-part="receipt-review">
        {error ? <Alert severity="error">{error}</Alert> : null}
        {review.totalMismatch ? (
          <Alert severity="warning">{t("receipt.totalMismatch")}</Alert>
        ) : null}
        <TextField
          select
          label={t("form.type")}
          value={review.type}
          onChange={(event) =>
            patchReview({ type: event.target.value as "expense" | "income" })
          }
          fullWidth
        >
          <MenuItem value="expense">{t("form.expense")}</MenuItem>
          <MenuItem value="income">{t("form.income")}</MenuItem>
        </TextField>
        <TextField
          label={t("form.concept")}
          value={review.concept}
          onChange={(event) => patchReview({ concept: event.target.value })}
          fullWidth
        />
        <Stack direction="row" spacing={1}>
          <TextField
            select
            label={t("form.currency")}
            value={review.currency}
            onChange={(event) =>
              patchReview({ currency: event.target.value, accountId: "" })
            }
            fullWidth
          >
            {(currencies?.length ? currencies : [defaultCurrency]).map(
              (code) => (
                <MenuItem key={code} value={code}>
                  {code}
                </MenuItem>
              ),
            )}
          </TextField>
          <TextField
            label={t("form.date")}
            type="date"
            value={review.businessDate}
            onChange={(event) =>
              patchReview({ businessDate: event.target.value })
            }
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Stack>
        <TextField
          select
          label={t("form.account")}
          value={
            currencyAccounts.some((a) => a.id === review.accountId)
              ? review.accountId
              : ""
          }
          onChange={(event) => patchReview({ accountId: event.target.value })}
          helperText={
            currencyAccounts.length === 0
              ? t("form.noAccountForCurrency")
              : undefined
          }
          fullWidth
        >
          {currencyAccounts.map((account) => (
            <MenuItem key={account.id} value={account.id}>
              {account.name}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="caption" color="text.secondary">
          {t("receipt.splitsHeading")}
        </Typography>
        {review.splits.map((row, index) => (
          <Stack
            key={index}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
            data-part="receipt-split-row"
          >
            <CategorySelect
              label={t("form.category")}
              categories={categories}
              value={selectionValue(row.selection)}
              onChange={(next) =>
                patchSplit(index, {
                  selection: selectionFromValue(next, row.selection),
                })
              }
              // Array, not a fragment: MUI Select only resolves the
              // selected option's display from direct children —
              // React.Children.map flattens arrays but not fragments.
              leadingOptions={[
                <MenuItem key="none" value="none">
                  {t("form.uncategorized")}
                </MenuItem>,
                row.selection.kind === "new" ? (
                  <MenuItem key="new" value="new">
                    {t("receipt.newCategoryOption", {
                      name: row.selection.name,
                    })}
                  </MenuItem>
                ) : null,
              ]}
              categoryValuePrefix="cat:"
              onCreateCategory={onCreateCategory}
              sx={{ flex: 1 }}
            />
            <TextField
              label={t("form.amount")}
              value={row.amount}
              onChange={(event) =>
                patchSplit(index, { amount: event.target.value })
              }
              slotProps={{ htmlInput: { inputMode: "decimal" } }}
              sx={{ width: 130 }}
            />
            {row.lowConfidence ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={t("receipt.lowConfidence")}
              />
            ) : null}
            <IconButton
              size="small"
              aria-label={t("receipt.removeSplit")}
              onClick={() =>
                setReview((prev) =>
                  prev
                    ? {
                        ...prev,
                        splits: prev.splits.filter((_, i) => i !== index),
                      }
                    : prev,
                )
              }
            >
              <TrashIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Button
            size="small"
            onClick={() =>
              setReview((prev) =>
                prev
                  ? {
                      ...prev,
                      splits: [
                        ...prev.splits,
                        {
                          selection: { kind: "uncategorized" },
                          amount: "",
                          itemCount: 0,
                          lowConfidence: false,
                        },
                      ],
                    }
                  : prev,
              )
            }
          >
            {t("receipt.addSplit")}
          </Button>
          <Typography sx={{ fontWeight: 700 }}>
            {t("receipt.total")}: {totalText} {review.currency}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button
            color="error"
            disabled={submitting !== null}
            onClick={onReject}
          >
            {submitting === "reject"
              ? t("receipt.discarding")
              : t("receipt.discard")}
          </Button>
          <Button
            variant="contained"
            disabled={submitting !== null || confirmInput === null}
            onClick={onConfirm}
          >
            {submitting === "confirm"
              ? t("receipt.confirming")
              : t("receipt.confirm")}
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} data-part="receipt-pick">
      {error ? <Alert severity="error">{error}</Alert> : null}
      {preview}
      <Button component="label" variant="outlined">
        {file ? t("receipt.changeImage") : t("receipt.chooseImage")}
        <input
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
        />
      </Button>
      {file && error ? (
        <Button variant="contained" onClick={() => startScan(file)}>
          {t("receipt.retry")}
        </Button>
      ) : null}
    </Stack>
  );
}
