import { PgBoss } from "pg-boss";

import type { VoiceDraftDispatcher } from "../application/ports/voice-draft-dispatcher.port.js";
import { VOICE_DRAFT_QUEUE } from "../application/ports/voice-draft-dispatcher.port.js";

/**
 * pg-boss producer for the `voice-draft` queue (voice-drafts T1, S5;
 * the T2 worker consumes it). Started lazily on first send so the API
 * does not hold a second pg-boss schema connection unless voice notes
 * are actually uploaded; safe when no worker handler exists yet —
 * jobs wait in the queue.
 */
export class PgBossVoiceDraftDispatcher implements VoiceDraftDispatcher {
  private readonly boss: PgBoss;
  private started: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString });
    this.boss.on("error", (error) => {
      console.error("[voices] pg-boss error:", error);
    });
  }

  async enqueueDraft(voiceNoteId: string, workspaceId: string): Promise<void> {
    await this.ensureStarted();
    await this.boss.send(VOICE_DRAFT_QUEUE, { voiceNoteId, workspaceId });
  }

  async close(): Promise<void> {
    if (this.started !== null) {
      await this.boss.stop();
    }
  }

  private ensureStarted(): Promise<void> {
    this.started ??= (async () => {
      await this.boss.start();
      // createQueue is ON CONFLICT-safe; the worker creates it too.
      await this.boss.createQueue(VOICE_DRAFT_QUEUE);
    })();
    return this.started;
  }
}
