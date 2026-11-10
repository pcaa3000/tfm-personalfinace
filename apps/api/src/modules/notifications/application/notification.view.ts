/** Serializable notification read model for `GET /api/v1/notifications`. */
export interface NotificationView {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string; // ISO instant
}
