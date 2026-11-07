import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { NotificationView } from "./notification.view.js";
import type {
  NotificationRepositoryPort,
  NotificationRow,
} from "./ports/notification-repository.port.js";

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export class ListNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepositoryPort) {}

  async execute(workspaceId: WorkspaceId): Promise<NotificationView[]> {
    const rows = await this.notifications.list(workspaceId);
    return rows.map(toView);
  }
}
