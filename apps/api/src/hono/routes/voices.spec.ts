import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  DomainError,
  WorkspaceId,
  err,
  ok,
} from "../../modules/shared-kernel/index.js";
import { CryptoFileHasher } from "../../modules/receipts/index.js";
import {
  encodeVoiceNoteCursor,
  UploadVoiceNoteUseCase,
  type UploadVoiceNoteCommand,
  type VoiceDraftDispatcher,
  type VoiceFileHashPort,
  type VoiceNote,
  type VoiceNoteListItem,
  type VoiceNoteListPage,
  type VoiceNoteRepositoryPort,
  type VoiceNoteView,
  type VoiceStoragePort,
} from "../../modules/voices/index.js";
import { httpErrorHandler } from "../middleware/errors.js";
import type { HonoEnv } from "../middleware/auth.js";
import { registerVoiceRoutes } from "./voices.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
]);

const NOTE_VIEW: VoiceNoteView = {
  id: "note-1",
  workspaceId: "ws-1",
  status: "pending",
  originalFilename: "nota.webm",
  mimeType: "audio/webm",
  sizeBytes: WEBM.byteLength,
  transactionId: null,
  transcript: null,
  error: null,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  expiresAt: "2026-12-10T12:00:00.000Z",
  mediaDeletedAt: null,
};

const LIST_ITEM: VoiceNoteListItem = {
  id: "note-1",
  status: "pending",
  originalFilename: "nota.webm",
  fileMimeType: "audio/webm",
  createdAt: "2026-11-10T12:00:00.000Z",
  transactionId: null,
  expiresAt: "2026-12-10T12:00:00.000Z",
  mediaDeletedAt: null,
};

function buildApp(options: {
  authenticated?: boolean;
  uploadResult?:
    | ReturnType<typeof ok<VoiceNoteView>>
    | ReturnType<typeof err<DomainError>>;
  /** Dedup specs: inject the real use case instead of the mock. */
  uploadVoiceNote?: Pick<UploadVoiceNoteUseCase, "execute">;
} = {}) {
  const authenticated = options.authenticated ?? true;
  const deps = {
    callerResolver: {
      resolve: vi.fn(async () =>
        authenticated ? { issuer: "test", subject: "user-1" } : null,
      ),
    },
    workspaceContext: {
      resolve: vi.fn(async () => ({
        workspaceId: WS,
        timezone: "UTC",
        defaultCurrency: "PEN",
      })),
    },
    uploadVoiceNote: options.uploadVoiceNote ?? {
      execute: vi.fn(
        async (_command: UploadVoiceNoteCommand) =>
          options.uploadResult ?? ok(NOTE_VIEW),
      ),
    },
    listVoiceNotes: {
      execute: vi.fn(
        async (_workspaceId: WorkspaceId): Promise<VoiceNoteListPage> => ({
          items: [LIST_ITEM],
          nextCursor: null,
        }),
      ),
    },
    getVoiceNote: {
      execute: vi.fn(async (_workspaceId: WorkspaceId, id: string) =>
        id === "note-1"
          ? ok(NOTE_VIEW)
          : err(new DomainError("VOICE_NOT_FOUND", "not found")),
      ),
    },
    getVoiceFile: {
      execute: vi.fn(async (_workspaceId: WorkspaceId, id: string) =>
        id === "note-1"
          ? ok({
              bytes: WEBM,
              mimeType: "audio/webm",
              originalFilename: "nota.webm",
            })
          : err(new DomainError("VOICE_NOT_FOUND", "not found")),
      ),
    },
  };
  const app = new Hono<HonoEnv>();
  registerVoiceRoutes(app, deps);
  app.onError(httpErrorHandler());
  return { app, deps };
}

function uploadRequest(file?: { bytes: Uint8Array; name: string; type: string }) {
  const form = new FormData();
  if (file) {
    form.append("file", new File([file.bytes], file.name, { type: file.type }));
  }
  return {
    method: "POST",
    body: form,
    headers: { "x-dev-user": "t" },
  } satisfies RequestInit;
}

/**
 * Dedup lives in the real use case — this app wires it with in-memory
 * fakes so the route spec exercises the actual SHA-256 + lookup path.
 */
function buildDedupApp() {
  const storedById = new Map<string, VoiceNote>();
  const storedByHash = new Map<string, VoiceNote>();
  const storage: VoiceStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(async (note: VoiceNote) => {
      storedById.set(note.id, note);
      if (note.fileHash) {
        storedByHash.set(`${note.workspaceId.value}:${note.fileHash}`, note);
      }
    }),
    findById: vi.fn(async (workspaceId: WorkspaceId, id: string) => {
      const note = storedById.get(id) ?? null;
      return note && note.workspaceId.value === workspaceId.value
        ? note
        : null;
    }),
  };
  const fileHashes: VoiceFileHashPort = {
    findByFileHash: vi.fn(
      async (workspaceId: WorkspaceId, fileHash: string) =>
        storedByHash.get(`${workspaceId.value}:${fileHash}`) ?? null,
    ),
  };
  const dispatcher: VoiceDraftDispatcher = {
    enqueueDraft: vi.fn(async () => undefined),
  };
  let nextId = 0;
  const { app } = buildApp({
    uploadVoiceNote: new UploadVoiceNoteUseCase(
      storage,
      notes,
      fileHashes,
      new CryptoFileHasher(),
      dispatcher,
      { now: () => new Date("2026-11-10T12:00:00.000Z") },
      { next: () => `note-${++nextId}` },
      { maxBytes: 1024 },
    ),
  });
  return { app, storage, notes, dispatcher, storedById };
}

describe("POST /api/v1/voices (voice-drafts T1, S1+S5)", () => {
  it("accepts a multipart audio file and returns 201 with the pending note", async () => {
    const { app, deps } = buildApp();

    const res = await app.request(
      "/api/v1/voices",
      uploadRequest({ bytes: WEBM, name: "nota.webm", type: "audio/webm" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(NOTE_VIEW);
    expect(deps.uploadVoiceNote.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        uploaderSubject: "user-1",
        originalFilename: "nota.webm",
      }),
    );
    const [command] = vi.mocked(deps.uploadVoiceNote.execute).mock.calls[0]!;
    expect(command!.bytes).toBeInstanceOf(Uint8Array);
    expect(command!.bytes).toEqual(WEBM);
  });

  it("rejects a multipart body with no file with 400 INVALID_BODY", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/voices", uploadRequest());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_BODY");
    expect(deps.uploadVoiceNote.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["VOICE_TYPE_NOT_ALLOWED"],
    ["VOICE_TOO_LARGE"],
    ["VOICE_EMPTY"],
  ])("maps use-case error %s to a 400 {code, message} envelope", async (code) => {
    const { app } = buildApp({
      uploadResult: err(new DomainError(code, `${code} detail`)),
    });

    const res = await app.request(
      "/api/v1/voices",
      uploadRequest({ bytes: WEBM, name: "x.webm", type: "audio/webm" }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body).toEqual({ code, message: `${code} detail` });
  });

  it("rejects unauthenticated uploads with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request(
      "/api/v1/voices",
      uploadRequest({ bytes: WEBM, name: "x.webm", type: "audio/webm" }),
    );

    expect(res.status).toBe(401);
    expect(deps.uploadVoiceNote.execute).not.toHaveBeenCalled();
  });

  it("duplicate upload of the same bytes returns the same note id without storing again (dedup, S5)", async () => {
    const { app, storage, notes, dispatcher, storedById } = buildDedupApp();

    const first = await app.request(
      "/api/v1/voices",
      uploadRequest({ bytes: WEBM, name: "a.webm", type: "audio/webm" }),
    );
    const second = await app.request(
      "/api/v1/voices",
      uploadRequest({ bytes: WEBM, name: "b.webm", type: "audio/webm" }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);

    // Idempotent: exactly one stored object, one row, one job.
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(notes.save).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueDraft).toHaveBeenCalledTimes(1);
    expect(storedById.size).toBe(1);

    // Different bytes → a brand-new note.
    const third = await app.request(
      "/api/v1/voices",
      uploadRequest({
        bytes: Uint8Array.from([...WEBM, 0xaa]),
        name: "c.webm",
        type: "audio/webm",
      }),
    );
    expect(third.status).toBe(201);
    const thirdBody = (await third.json()) as { id: string };
    expect(thirdBody.id).not.toBe(firstBody.id);
    expect(storage.save).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/v1/voices (voice-drafts T1, S5)", () => {
  it("returns a {items, nextCursor} page with the default limit 50", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/voices", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [LIST_ITEM],
      nextCursor: null,
    });
    expect(deps.listVoiceNotes.execute).toHaveBeenCalledWith(WS, {
      limit: 50,
    });
  });

  it("forwards ?limit and a decoded ?cursor to the use case", async () => {
    const { app, deps } = buildApp();
    const cursor = encodeVoiceNoteCursor({
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      id: "note-1",
    });
    vi.mocked(deps.listVoiceNotes.execute).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    const res = await app.request(
      `/api/v1/voices?limit=2&cursor=${encodeURIComponent(cursor)}`,
      { headers: { "x-dev-user": "t" } },
    );

    expect(res.status).toBe(200);
    expect(deps.listVoiceNotes.execute).toHaveBeenCalledWith(WS, {
      limit: 2,
      after: {
        createdAt: new Date("2026-11-10T12:00:00.000Z"),
        id: "note-1",
      },
    });
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("echoes the use-case nextCursor so a client can walk pages", async () => {
    const { app, deps } = buildApp();
    const nextCursor = encodeVoiceNoteCursor({
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      id: "note-1",
    });
    vi.mocked(deps.listVoiceNotes.execute).mockResolvedValueOnce({
      items: [LIST_ITEM],
      nextCursor,
    });

    const res = await app.request("/api/v1/voices?limit=1", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [LIST_ITEM],
      nextCursor,
    });
  });

  it.each([["limit=0"], ["limit=101"], ["limit=abc"], ["limit=1.5"]])(
    "rejects an invalid limit with 400 INVALID_QUERY (%s — pinned, not clamped)",
    async (query) => {
      const { app, deps } = buildApp();

      const res = await app.request(`/api/v1/voices?${query}`, {
        headers: { "x-dev-user": "t" },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("INVALID_QUERY");
      expect(deps.listVoiceNotes.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed cursor with 400 INVALID_CURSOR (pinned, not silently empty)", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/voices?cursor=not-a-cursor", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_CURSOR");
    expect(deps.listVoiceNotes.execute).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request("/api/v1/voices", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(401);
    expect(deps.listVoiceNotes.execute).not.toHaveBeenCalled();
  });

  it("does not shadow GET /api/v1/voices/:id", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/voices/note-1", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(NOTE_VIEW);
  });
});

describe("GET /api/v1/voices/:id (polling)", () => {
  it("returns the note row for the workspace", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/voices/note-1", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(NOTE_VIEW);
  });

  it("returns 404 VOICE_NOT_FOUND for unknown or foreign notes", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/voices/nope", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VOICE_NOT_FOUND");
  });
});

describe("GET /api/v1/voices/:id/file", () => {
  it("streams the stored bytes with the sniffed content type", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/voices/note-1/file", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/webm");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBM);
  });

  it("returns 404 for a missing file", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/voices/nope/file", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
  });

  it("maps VOICE_MEDIA_DELETED to 410 — media gone is distinct from 404 note-not-found (S7)", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.getVoiceFile.execute).mockResolvedValueOnce(
      err(new DomainError("VOICE_MEDIA_DELETED", "media deleted")),
    );

    const res = await app.request("/api/v1/voices/note-1/file", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VOICE_MEDIA_DELETED");
  });
});
