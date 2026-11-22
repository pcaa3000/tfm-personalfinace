// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { ApiError, getVoiceFile } from "./api";
import { VoiceOriginBadge } from "./VoiceOriginBadge";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getVoiceFile: vi.fn() };
});

beforeAll(async () => {
  await i18n.changeLanguage("es");
  // jsdom has no URL.createObjectURL — stub it for the audio player.
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:voice-note"),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe("VoiceOriginBadge (voice-drafts T4)", () => {
  it("renders a plain non-clickable badge when the note reference is missing", () => {
    render(<VoiceOriginBadge originReference={null} />);

    expect(screen.getByText("voz")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Escuchar nota de voz" }),
    ).toBeNull();
  });

  it("opens the authenticated audio player from the badge", async () => {
    vi.mocked(getVoiceFile).mockResolvedValue(
      new Blob(["audio"], { type: "audio/webm" }),
    );
    render(<VoiceOriginBadge originReference="vn-9" />);

    // The raw /voices/:id/file URL 401s without the Authorization
    // header — the badge fetches through the api client, never a link.
    const badge = screen.getByRole("button", {
      name: "Escuchar nota de voz",
    });
    expect(
      screen.queryByRole("link", { name: "Escuchar nota de voz" }),
    ).toBeNull();

    fireEvent.click(badge);

    expect(getVoiceFile).toHaveBeenCalledWith("vn-9");
    const dialog = await screen.findByRole("dialog", {
      name: "Audio de la nota de voz",
    });
    const audio = await within(dialog).findByTestId("voice-audio");
    expect(audio.getAttribute("src")).toBe("blob:voice-note");
  });

  it("shows the media-deleted copy when the stored audio is gone (410)", async () => {
    vi.mocked(getVoiceFile).mockRejectedValue(
      new ApiError("VOICE_MEDIA_DELETED", "gone", 410),
    );
    render(<VoiceOriginBadge originReference="vn-9" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Escuchar nota de voz" }),
    );

    expect(
      await screen.findByText(
        "El audio de esta nota ya fue eliminado.",
      ),
    ).toBeTruthy();
  });
});
