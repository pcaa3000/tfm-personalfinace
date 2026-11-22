import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  confirmVoiceDraft,
  getVoiceConsent,
  rejectVoiceNote,
  retryVoiceNote,
  setVoiceConsent,
} from "./api";
import { CategorySelect } from "./CategorySelect";
import { errorMessage } from "./errors";
import { minorToDecimalString, todayInTimeZone } from "./format";
import { MicIcon, TrashIcon } from "./icons";
import {
  reviewSplitsTotalMinorUnits,
  type SplitSelection,
} from "./receipt-draft";
import { defaultCurrencyExponent } from "./summarize";
import type {
  AccountView,
  CategoryView,
  CreateCategoryInput,
  TransactionView,
} from "./types";
import {
  voiceDraftToReviewState,
  voiceReviewStateToConfirmInput,
  type VoiceDraftPayload,
  type VoiceNoteView,
  type VoiceReviewState,
} from "./voice-draft";
import {
  awaitVoiceDraft,
  uploadAndAwaitVoiceDraft,
  VoiceNoteFailedError,
  VoicePollTimeoutError,
} from "./voice-flow";

interface Props {
  categories: CategoryView[];
  accounts: AccountView[];
  defaultCurrency: string;
  currencies?: string[] | undefined;
  /** Workspace IANA zone used for the fallback businessDate. */
  timezone?: string | undefined;
  /** Workspace currency exponents (minor units ⇄ decimal text). */
  exponentOf?: ((code: string) => number) | undefined;
  /** Test hooks — default to ~2s cadence / ~60s budget / 60s take cap. */
  pollIntervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  /** Hard take cap (S1): the recorder auto-stops at this many ms. */
  maxDurationMs?: number | undefined;
  /** Inline category creation in the review rows (T8, S8). */
  onCreateCategory?:
    | ((input: CreateCategoryInput) => Promise<CategoryView>)
    | undefined;
  onConfirmed: (transaction: TransactionView) => void;
  onClose: () => void;
}

type Step = "record" | "working" | "review";
type MicState = "idle" | "recording" | "recorded";

/** Default take cap — S1: short dictations, ~60s. */
const DEFAULT_MAX_DURATION_MS = 60_000;

/**
 * Ordered recording-format candidates (S1): webm/opus first — the
 * compact browser-native choice — then fallbacks checked through
 * `MediaRecorder.isTypeSupported`. The server allowlists
 * webm/ogg/mp3/wav/m4a; the recorder picks whatever the browser
 * supports from the same family.
 */
const VOICE_MIME_CANDIDATES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
];

function preferredVoiceMime(): string | undefined {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined;
  }
  return VOICE_MIME_CANDIDATES.find((mime) =>
    MediaRecorder.isTypeSupported(mime),
  );
}

/** Filename extension for a recorded mime — mpeg→mp3, mp4→m4a. */
function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split(";")[0]?.split("/")[1] ?? "webm";
  if (subtype === "mpeg") return "mp3";
  if (subtype === "mp4") return "m4a";
  return subtype;
}

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

const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Voice movement (voice-drafts T4, S1+S2+S4): record a short dictation
 * with getUserMedia + MediaRecorder (persistent indicator, 60s cap,
 * replay/discard) → upload `POST /voices` → poll → review the draft
 * (transcript read-only, splits per category, `nueva:` flags,
 * low-confidence chips, totalMismatch + duplicate warnings) →
 * confirm/reject. Uploads need connectivity — online-only like
 * tickets (S8): a network TypeError surfaces the "requires
 * connection" copy instead of an offline queue.
 *
 * The review JSX mirrors ReceiptFlow's step — kept as its own copy on
 * purpose (voice shows the transcript + prefills the dictated type).
 */
export function VoiceFlow({
  categories,
  accounts,
  defaultCurrency,
  currencies,
  timezone,
  exponentOf = defaultCurrencyExponent,
  pollIntervalMs,
  timeoutMs,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  onCreateCategory,
  onConfirmed,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("record");
  const [micState, setMicState] = useState<MicState>("idle");
  const [micError, setMicError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<"uploading" | "analyzing">("uploading");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState<VoiceNoteView | null>(null);
  const [review, setReview] = useState<VoiceReviewState | null>(null);
  // S11 pattern: the latest note observed + the thrown flow error let a
  // retry resume the SAME note (or reset it via POST retry) instead of
  // re-uploading the audio.
  const [lastNote, setLastNote] = useState<VoiceNoteView | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // S6 (docs/05 RF-070): provider consent — the dialog blocks the
  // first audio send until an explicit grant; `notice` carries the
  // friendly decline message (manual registration stays available).
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"confirm" | "reject" | null>(
    null,
  );
  const previewRef = useRef<string | null>(null);
  const pendingTakeRef = useRef<File | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const clearRecordingTimers = () => {
    if (capTimerRef.current !== null) {
      clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  // Unmount cleanup: release the mic, the timers and the take preview.
  useEffect(
    () => () => {
      clearRecordingTimers();
      recorderRef.current = null;
      stopStream();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const effectiveTimezone =
    timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const flowError = (cause: unknown): string => {
    if (cause instanceof TypeError) return t("voice.requiresConnection");
    if (cause instanceof VoicePollTimeoutError) {
      return t("voice.pollTimeout");
    }
    if (cause instanceof VoiceNoteFailedError) {
      return t("voice.draftFailed");
    }
    return errorMessage(cause, t);
  };

  const flowOptions = () => ({
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    onPhase: setPhase,
    onNote: setLastNote,
  });

  const showReview = (result: {
    note: VoiceNoteView;
    draft: VoiceDraftPayload;
  }) => {
    setNote(result.note);
    setReview(
      voiceDraftToReviewState(result.draft, {
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
    setStep("record");
  };

  const sendUpload = (taken: File) => {
    setStep("working");
    setPhase("uploading");
    setError(null);
    setNotice(null);
    setFailure(null);
    setLastNote(null);
    void uploadAndAwaitVoiceDraft(taken, flowOptions())
      .then(showReview)
      .catch(showFlowError);
  };

  /**
   * S6 (docs/05 RF-070): the FIRST send of audio to the provider is
   * gated on the persisted consent flag — undecided or revoked opens
   * the dialog and the take waits; granted proceeds straight to the
   * upload. The audio never leaves the device without an explicit
   * grant; every later send re-reads the flag so a revocation from
   * Preferences takes effect immediately.
   */
  const startUpload = (taken: File) => {
    setNotice(null);
    void getVoiceConsent()
      .then((consent) => {
        if (consent.granted) {
          sendUpload(taken);
          return;
        }
        pendingTakeRef.current = taken;
        setConsentOpen(true);
      })
      .catch((cause: unknown) => showFlowError(cause));
  };

  const onConsentAccept = () => {
    const taken = pendingTakeRef.current;
    setConsentBusy(true);
    setVoiceConsent(true)
      .then(() => {
        pendingTakeRef.current = null;
        setConsentOpen(false);
        setConsentBusy(false);
        if (taken) sendUpload(taken);
      })
      .catch((cause: unknown) => {
        pendingTakeRef.current = null;
        setConsentOpen(false);
        setConsentBusy(false);
        showFlowError(cause);
      });
  };

  const onConsentDecline = () => {
    pendingTakeRef.current = null;
    setConsentOpen(false);
    // Declining never blocks manual registration (docs/05).
    setNotice(t("voice.consentDeclined"));
  };

  /**
   * S11 pattern: retry NEVER re-uploads. A poll timeout resumes
   * polling the same note (the job may still be running); a `failed`
   * note first calls POST /voices/:id/retry to reset it server-side,
   * then polls the same id again. Only when no note exists yet (the
   * upload itself failed) does a retry upload the take again.
   */
  const onRetry = () => {
    if (!lastNote) {
      if (file) startUpload(file);
      return;
    }
    setStep("working");
    setPhase("analyzing");
    setError(null);
    const resume = async () => {
      const seed =
        failure instanceof VoiceNoteFailedError
          ? await retryVoiceNote(lastNote.id)
          : lastNote;
      return awaitVoiceDraft(seed, flowOptions());
    };
    void resume()
      .then(showReview)
      .catch(showFlowError);
  };

  const startRecording = async () => {
    // Re-entrancy guard: a second click while getUserMedia is still pending
    // must not run the flow twice (orphaned stream, timers and interleaved chunks).
    if (startingRef.current || micState === "recording") return;
    startingRef.current = true;
    setMicError(false);
    const mediaDevices = navigator.mediaDevices;
    if (
      !mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setMicError(true);
      startingRef.current = false;
      return;
    }
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicError(true);
      startingRef.current = false;
      return;
    }
    streamRef.current = stream;

    const mimeType = preferredVoiceMime();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      clearRecordingTimers();
      stopStream();
      recorderRef.current = null;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const taken = new File([blob], `voz.${extensionForMime(type)}`, {
        type,
      });
      setFile(taken);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current =
        typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(taken)
          : null;
      setPreviewUrl(previewRef.current);
      setMicState("recorded");
    };
    recorderRef.current = recorder;
    recorder.start();
    startingRef.current = false;
    setElapsed(0);
    setMicState("recording");
    elapsedTimerRef.current = setInterval(
      () => setElapsed((seconds) => seconds + 1),
      1_000,
    );
    // S1: hard take cap — auto-stop, no silent truncation.
    capTimerRef.current = setTimeout(() => {
      recorderRef.current?.stop();
    }, maxDurationMs);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const discardRecording = () => {
    setFile(null);
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setPreviewUrl(null);
    setMicState("idle");
    setError(null);
  };

  const useRecording = () => {
    if (file) startUpload(file);
  };

  const patchReview = (patch: Partial<VoiceReviewState>) =>
    setReview((prev) => (prev ? { ...prev, ...patch } : prev));

  const patchSplit = (
    index: number,
    patch: Partial<VoiceReviewState["splits"][number]>,
  ) =>
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
    if (!review || !note) return;
    const input = voiceReviewStateToConfirmInput(review, exponentOf);
    if (!input) return;
    setSubmitting("confirm");
    setError(null);
    confirmVoiceDraft(note.id, {
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
    if (!note) return;
    setSubmitting("reject");
    setError(null);
    rejectVoiceNote(note.id)
      .then(() => onClose())
      .catch((cause: unknown) => {
        setError(flowError(cause));
        setSubmitting(null);
      });
  };

  if (step === "working") {
    return (
      <Stack spacing={2} sx={{ py: 1 }} data-part="voice-working">
        {previewUrl ? (
          <Box
            component="audio"
            controls
            src={previewUrl}
            sx={{ width: "100%" }}
          />
        ) : null}
        <Typography color="text.secondary" aria-live="polite">
          {phase === "uploading"
            ? t("voice.uploading")
            : t("voice.analyzing")}
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
    const confirmInput = voiceReviewStateToConfirmInput(
      review,
      exponentOf,
    );

    return (
      <Stack spacing={2} sx={{ pt: 1 }} data-part="voice-review">
        {error ? <Alert severity="error">{error}</Alert> : null}
        {review.totalMismatch ? (
          <Alert severity="warning">{t("voice.totalMismatch")}</Alert>
        ) : null}
        {review.currencyConflict ? (
          <Alert severity="warning">{t("voice.currencyConflict")}</Alert>
        ) : null}
        {review.possibleDuplicates.length > 0 ? (
          <Alert severity="warning" data-part="voice-possible-duplicates">
            {review.possibleDuplicates.map((duplicate) => (
              <Box key={duplicate.transactionId}>
                {t("voice.possibleDuplicates", {
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
        {/* S7: verbatim transcript — evidence of what the model heard,
            read-only so it never drifts from the stored row. */}
        <TextField
          label={t("voice.transcript")}
          value={review.transcript}
          multiline
          minRows={2}
          slotProps={{ htmlInput: { readOnly: true } }}
          fullWidth
        />
        <TextField
          select
          label={t("form.type")}
          value={review.type}
          onChange={(event) =>
            patchReview({ type: event.target.value as "expense" | "income" })
          }
          slotProps={{ inputLabel: { shrink: true } }}
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
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          data-part="voice-currency-date"
        >
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
          {t("voice.splitsHeading")}
        </Typography>
        {review.splits.map((row, index) => (
          <Stack
            key={index}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { xs: "stretch", sm: "center" } }}
            data-part="voice-split-row"
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
              leadingOptions={[
                <MenuItem key="none" value="none">
                  {t("form.uncategorized")}
                </MenuItem>,
                row.selection.kind === "new" ? (
                  <MenuItem key="new" value="new">
                    {t("voice.newCategoryOption", {
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
              sx={{ width: { xs: "100%", sm: 130 } }}
            />
            {row.lowConfidence ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={t("voice.lowConfidence")}
              />
            ) : null}
            <IconButton
              size="small"
              aria-label={t("voice.removeSplit")}
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
            {t("voice.addSplit")}
          </Button>
          <Typography sx={{ fontWeight: 700 }}>
            {t("voice.total")}: {totalText} {review.currency}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button
            color="error"
            disabled={submitting !== null}
            onClick={onReject}
          >
            {submitting === "reject"
              ? t("voice.discarding")
              : t("voice.discard")}
          </Button>
          <Button
            variant="contained"
            disabled={submitting !== null || confirmInput === null}
            onClick={onConfirm}
          >
            {submitting === "confirm"
              ? t("voice.confirming")
              : t("voice.confirm")}
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} data-part="voice-record">
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="info">{notice}</Alert> : null}
      {/* S6 (docs/05 RF-070): provider-consent dialog — names the
          provider, the data sent, the purpose, the free-tier
          training caveat, revocation path and the manual fallback. */}
      <Dialog open={consentOpen} onClose={onConsentDecline}>
        <DialogTitle>{t("voice.consentTitle")}</DialogTitle>
        <DialogContent>
          <Typography>{t("voice.consentBody")}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onConsentDecline} disabled={consentBusy}>
            {t("voice.consentDecline")}
          </Button>
          <Button
            variant="contained"
            onClick={onConsentAccept}
            disabled={consentBusy}
          >
            {consentBusy ? t("form.saving") : t("voice.consentAccept")}
          </Button>
        </DialogActions>
      </Dialog>
      {micError ? (
        <Alert severity="error">{t("voice.micUnavailable")}</Alert>
      ) : null}
      {micState === "recording" ? (
        <Stack spacing={1} data-part="voice-recording">
          {/* Persistent indicator — stays up for the whole take, with
              the running time and the hard cap. */}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Chip
              color="error"
              icon={<MicIcon />}
              label={t("voice.recording", {
                elapsed: formatElapsed(elapsed),
              })}
            />
            <Typography variant="caption" color="text.secondary">
              {t("voice.maxDuration", {
                seconds: Math.round(maxDurationMs / 1000),
              })}
            </Typography>
          </Stack>
          <Button
            variant="contained"
            color="error"
            onClick={stopRecording}
          >
            {t("voice.stopRecording")}
          </Button>
        </Stack>
      ) : (
        <Button
          variant="contained"
          startIcon={<MicIcon />}
          onClick={() => void startRecording()}
        >
          {t("voice.startRecording")}
        </Button>
      )}
      {micState === "recorded" && previewUrl ? (
        <Stack spacing={1} data-part="voice-take">
          {/* Replay the take before it leaves the device. */}
          <Box
            component="audio"
            controls
            src={previewUrl}
            sx={{ width: "100%" }}
          />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={useRecording}>
              {t("voice.useRecording")}
            </Button>
            <Button variant="outlined" onClick={discardRecording}>
              {t("voice.discardRecording")}
            </Button>
          </Stack>
        </Stack>
      ) : null}
      {error && (file !== null || lastNote !== null) ? (
        <Button variant="contained" onClick={onRetry}>
          {t("voice.retry")}
        </Button>
      ) : null}
    </Stack>
  );
}
