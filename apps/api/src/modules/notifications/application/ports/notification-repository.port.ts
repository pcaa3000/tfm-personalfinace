import type { WorkspaceId } from "../../../shared-kernel/index.js";

/** Stored notification row as the read model needs it. */
export interface NotificationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
}

/**
 * Reads workspace notifications newest-first — written by the
 * ledger-events consumer on the worker side (worker-pgboss-outbox S2).
 */
export interface NotificationRepositoryPort {
  list(workspaceId: WorkspaceId): Promise<NotificationRow[]>;
}

export const NOTIFICATION_REPOSITORY = Symbol("NOTIFICATION_REPOSITORY");
