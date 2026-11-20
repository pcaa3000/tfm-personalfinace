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

import { confirmReceipt, rejectReceipt, retryReceiptScan } from "./api";
import { CategorySelect } from "./CategorySelect";
import { errorMessage } from "./errors";
import { minorToDecimalString, todayInTimeZone } from "./format";
import { TrashIcon } from "./icons";
import {
  draftToReviewState,
  reviewSplitsTotalMinorUnits,
  reviewStateToConfirmInput,
  type ReceiptDraftPayload,
  type ReceiptReviewState,
  type ReceiptScanView,
  type SplitSelection,
} from "./receipt-draft";
import {
  awaitDraft,
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
  // T12 (S11): the latest scan observed + the thrown flow error let a
  // retry resume the SAME scan (or reset it via POST retry) instead of
  // re-uploading the image.
  const [lastScan, setLastScan] = useState<ReceiptScanView | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState<"confirm" | "reject" | null>(
    null,
  );
  const previewRef = useRef<string | null>(null);
  // Camera capture (T11+T15): `capture="environment"` on the gallery
  // input hijacked mobile into the camera app; the gallery input stays
  // capture-free and mobile gets a dedicated hidden capture input
  // instead. The getUserMedia preview only runs on fine pointers — on
  // mobile prod it fails permission checks, so the native camera app
  // handles capture.
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

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

  const flowOptions = () => ({
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    onPhase: setPhase,
    onScan: setLastScan,
  });

  const showReview = (result: {
    scan: ReceiptScanView;
    draft: ReceiptDraftPayload;
  }) => {
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
  };

  const showFlowError = (cause: unknown) => {
    setFailure(cause);
    setError(flowError(cause));
    setStep("pick");
  };

  const startScan = (picked: File) => {
    setStep("working");
    setPhase("uploading");
    setError(null);
    setFailure(null);
    setLastScan(null);
    void uploadAndAwaitDraft(picked, flowOptions())
      .then(showReview)
      .catch(showFlowError);
  };

  /**
   * T12 (S11): retry NEVER re-uploads. A poll timeout resumes polling
   * the same scan (the job may still be running); a `failed` scan first
   * calls POST /receipts/:id/retry to reset it server-side, then polls
   * the same id again. Only when no scan exists yet (upload itself
   * failed) does a retry upload the picked file again.
   */
  const onRetry = () => {
    if (!lastScan) {
      if (file) startScan(file);
      return;
    }
    setStep("working");
    setPhase("analyzing");
    setError(null);
    const resume = async () => {
      const seed =
        failure instanceof ReceiptScanFailedError
          ? await retryReceiptScan(lastScan.id)
          : lastScan;
      return awaitDraft(seed, flowOptions());
    };
    void resume()
      .then(showReview)
      .catch(showFlowError);
  };

  const acceptFile = (picked: File) => {
    setFile(picked);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current =
      typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(picked)
        : null;
    setPreviewUrl(previewRef.current);
    startScan(picked);
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Clear the selection so re-picking the same file re-fires `change`
    // while the input stays mounted (e.g. after a flow error).
    event.target.value = "";
    if (!picked) return;
    acceptFile(picked);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  /**
   * T15: coarse pointers (touch/mobile) route "Capturar con cámara" to
   * the hidden `capture="environment"` input — the native camera app,
   * no getUserMedia permission round-trip. `matchMedia` may be absent
   * (jsdom): fall back to the desktop getUserMedia preview.
   */
  const isCoarsePointer = () =>
    window.matchMedia?.("(pointer: coarse)")?.matches === true;

  const onCaptureCamera = () => {
    if (isCoarsePointer()) {
      cameraInputRef.current?.click();
      return;
    }
    void openCamera();
  };

  const openCamera = async () => {
    setCameraError(false);
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setCameraError(true);
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        stream = await mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setCameraActive(true);
    } catch {
      setCameraError(true);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        stopCamera();
        if (!blob) {
          setCameraError(true);
          return;
        }
        acceptFile(
          new File([blob], "captura.jpg", { type: "image/jpeg" }),
        );
      },
      "image/jpeg",
      0.9,
    );
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
        {/* T13 (S12): semantic dedup — informational, confirm still allowed. */}
        {review.possibleDuplicates.length > 0 ? (
          <Alert severity="warning" data-part="receipt-possible-duplicates">
            {review.possibleDuplicates.map((duplicate) => (
              <Box key={duplicate.transactionId}>
                {t("receipt.possibleDuplicates", {
                  date: duplicate.occurredOn,
                  concept: duplicate.concept,
                  amount: minorToDecimalString(
                    BigInt(duplicate.amount),
                    exponentOf(review.currency),
                  ),
                  currency: review.currency,
                })}
              </Box>
            ))}
          </Alert>
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
      {cameraError ? (
        <Alert severity="error">{t("receipt.cameraUnavailable")}</Alert>
      ) : null}
      {preview}
      {cameraActive ? (
        <Stack spacing={1} data-part="receipt-camera">
          <Box
            component="video"
            ref={videoRef}
            autoPlay
            muted
            playsInline
            sx={{
              maxWidth: "100%",
              maxHeight: 240,
              borderRadius: "12px",
              border: "1px solid",
              borderColor: "divider",
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={capturePhoto}>
              {t("receipt.capture")}
            </Button>
            <Button variant="outlined" onClick={stopCamera}>
              {t("receipt.cancel")}
            </Button>
          </Stack>
        </Stack>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button component="label" variant="outlined">
          {file ? t("receipt.changeImage") : t("receipt.chooseImage")}
          <input
            hidden
            type="file"
            accept="image/*"
            onChange={onFileChange}
          />
        </Button>
        {/* T15: mobile-only native camera entry — `capture` lives here,
            never on the gallery input. */}
        <input
          ref={cameraInputRef}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
        />
        <Button variant="outlined" onClick={onCaptureCamera}>
          {t("receipt.captureCamera")}
        </Button>
      </Stack>
      {file && error ? (
        <Button variant="contained" onClick={onRetry}>
          {t("receipt.retry")}
        </Button>
      ) : null}
    </Stack>
  );
}
