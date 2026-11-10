import { desc, eq } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { notifications } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  NotificationRepositoryPort,
  NotificationRow,
} from "../application/ports/notification-repository.port.js";

export class DrizzleNotificationRepository
  implements NotificationRepositoryPort
{
  constructor(private readonly db: DrizzleDb) {}

  async list(workspaceId: WorkspaceId): Promise<NotificationRow[]> {
    return await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceId, workspaceId.value))
      .orderBy(desc(notifications.createdAt));
  }
}
