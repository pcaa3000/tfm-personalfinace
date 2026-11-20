import { PgBoss } from "pg-boss";

import { requiredEnv } from "./env.js";
import { createDrizzleDb } from "./drizzle/db.js";
import {
  createReceiptStorage,
  receiptStorageFromProcess,
} from "./hono/composition.js";
import {
  LEDGER_EVENTS_QUEUE,
  drainOutboxOnce,
  type LedgerEventJob,
} from "./jobs/drain-outbox.js";
import { handleLedgerEvent } from "./jobs/ledger-notifications.js";
import {
  handleReceiptScan,
  type ReceiptScanJob,
} from "./jobs/receipt-scan.js";
import {
  handleVoiceDraft,
  type VoiceDraftJob,
} from "./jobs/voice-draft.js";
import {
  purgeExpiredReceiptMedia,
  RECEIPT_MEDIA_PURGE_CRON,
  RECEIPT_MEDIA_PURGE_QUEUE,
} from "./jobs/purge-receipt-media.js";
import { purgeExpiredVoiceMedia } from "./jobs/purge-voice-media.js";
import { DrizzleCategoryValidationAdapter } from "./modules/categorization/index.js";
import { SystemClock } from "./modules/ledger/infrastructure/system-clock.adapter.js";
import {
  DrizzleReceiptScanRepository,
  GeminiReceiptScanAdapter,
  GEMINI_DEFAULT_MODEL,
  RECEIPT_SCAN_QUEUE,
} from "./modules/receipts/index.js";
import {
  DrizzleVoiceConsentRepository,
  DrizzleVoiceNoteRepository,
  DrizzleVoiceWorkspaceContextAdapter,
  GeminiVoiceDraftAdapter,
  VOICE_DRAFT_QUEUE,
  VoiceDraftConsentGuard,
} from "./modules/voices/index.js";

const DRAIN_INTERVAL_MS = Number(process.env.WORKER_DRAIN_MS ?? 2_000);

/**
 * Standalone worker process (S4): drains the transactional outbox into
 * pg-boss and runs the ledger-events consumer. pg-boss lives ONLY here
 * and in the jobs adapters — domain/application stay framework-free (S5).
 */
async function main(): Promise<void> {
  // NEW-SEC-13 (S8): no silent localhost fallback — fail fast at boot.
  const databaseUrl = requiredEnv("DATABASE_URL");
  const { db, pool } = createDrizzleDb(databaseUrl);
  const boss = new PgBoss({ connectionString: databaseUrl });

  boss.on("error", (error) => {
    console.error("[worker] pg-boss error:", error);
  });

  await boss.start();
  await boss.createQueue(LEDGER_EVENTS_QUEUE);
  await boss.createQueue(RECEIPT_SCAN_QUEUE);
  await boss.createQueue(RECEIPT_MEDIA_PURGE_QUEUE);
  await boss.createQueue(VOICE_DRAFT_QUEUE);

  await boss.work(LEDGER_EVENTS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleLedgerEvent(db, job.data as LedgerEventJob);
    }
  });

  // receipt-scan-drafts T4+T5 (D1, S9): Gemini extraction+categorization.
  // GEMINI_API_KEY is mandatory — the worker refuses to boot without it
  // (fail-fast, same policy as DATABASE_URL); GEMINI_MODEL is optional.
  const receiptScanDeps = {
    scans: new DrizzleReceiptScanRepository(db),
    storage: createReceiptStorage(receiptStorageFromProcess()),
    categories: new DrizzleCategoryValidationAdapter(db),
    scanner: new GeminiReceiptScanAdapter({
      apiKey: requiredEnv("GEMINI_API_KEY"),
      model: process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
    }),
    clock: new SystemClock(),
  };
  await boss.work(RECEIPT_SCAN_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleReceiptScan(receiptScanDeps, job.data as ReceiptScanJob);
    }
  });

  // voice-drafts T2 (D1, S2): Gemini audio transcription+extraction +
  // categorization. Shares the receipts storage driver instance (the
  // voices port is the same contract) and the same GEMINI_API_KEY
  // fail-fast — the worker already refuses to boot without it.
  const voiceDraftDeps = {
    notes: new DrizzleVoiceNoteRepository(db),
    storage: createReceiptStorage(receiptStorageFromProcess()),
    categories: new DrizzleCategoryValidationAdapter(db),
    processor: new GeminiVoiceDraftAdapter({
      apiKey: requiredEnv("GEMINI_API_KEY"),
      model: process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
    }),
    workspaceContext: new DrizzleVoiceWorkspaceContextAdapter(db),
    clock: new SystemClock(),
  };
  // voice-drafts T5 (S6 — docs/05 revocación): drain-side consent
  // gate — a note queued BEFORE a revoke must not be sent to the
  // provider either. Same guard the API wraps dispatchers with: it
  // fails the pending row with VOICE_CONSENT_REVOKED and skips the
  // LLM call entirely.
  const voiceConsentGuard = new VoiceDraftConsentGuard(
    voiceDraftDeps.notes,
    new DrizzleVoiceConsentRepository(db),
    voiceDraftDeps.clock,
  );
  await boss.work(VOICE_DRAFT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as VoiceDraftJob;
      if (
        await voiceConsentGuard.ensureDispatchable(
          data.voiceNoteId,
          data.workspaceId,
        )
      ) {
        await handleVoiceDraft(voiceDraftDeps, data);
      }
    }
  });

  // receipt-retention-30d T4 (S4): daily purge of expired media —
  // pg-boss `schedule` (v12 supports cron schedules) enqueues onto the
  // purge queue; the handler deletes objects + stamps mediaDeletedAt.
  // voice-drafts T6 (S7): the same run also purges voices_voice_notes —
  // the sibling table shares this storage instance and each row carries
  // its own storageKey, so one schedule covers both.
  const purgeStorage = receiptScanDeps.storage;
  const purgeClock = new SystemClock();
  await boss.schedule(RECEIPT_MEDIA_PURGE_QUEUE, RECEIPT_MEDIA_PURGE_CRON);
  await boss.work(RECEIPT_MEDIA_PURGE_QUEUE, async () => {
    await purgeExpiredReceiptMedia({
      db,
      storage: purgeStorage,
      clock: purgeClock,
    });
    await purgeExpiredVoiceMedia({
      db,
      storage: purgeStorage,
      clock: purgeClock,
    });
  });

  const timer = setInterval(() => {
    void drainOutboxOnce(db, boss).catch((error) => {
      console.error("[worker] outbox drain failed:", error);
    });
  }, DRAIN_INTERVAL_MS);

  console.log(
    `[worker] up — draining outbox every ${DRAIN_INTERVAL_MS}ms, consuming ${LEDGER_EVENTS_QUEUE}`,
  );

  const shutdown = async () => {
    clearInterval(timer);
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
