import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ListNotificationsUseCase } from "./list-notifications.use-case.js";
import type { NotificationRepositoryPort } from "./ports/notification-repository.port.js";

const wsResult = WorkspaceId.create("ws-notif-spec");
if (!wsResult.ok) throw new Error("setup failed");
const WS = wsResult.value;

describe("ListNotificationsUseCase", () => {
  it("maps stored rows to notification views", async () => {
    const repo: NotificationRepositoryPort = {
      list: async () => [
        {
          id: "n-1",
          workspaceId: WS.value,
          kind: "transaction.confirmed",
          title: "Movimiento registrado",
          body: "Sueldo · 4500.00 PEN",
          createdAt: new Date("2026-11-07T10:00:00Z"),
        },
      ],
    };
    const useCase = new ListNotificationsUseCase(repo);

    const views = await useCase.execute(WS);

    expect(views).toEqual([
      {
        id: "n-1",
        workspaceId: "ws-notif-spec",
        kind: "transaction.confirmed",
        title: "Movimiento registrado",
        body: "Sueldo · 4500.00 PEN",
        createdAt: "2026-11-07T10:00:00.000Z",
      },
    ]);
  });
});
