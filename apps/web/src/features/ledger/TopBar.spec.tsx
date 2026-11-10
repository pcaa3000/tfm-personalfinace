// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const getSupabaseClient = vi.hoisted(() => vi.fn());
const isAuthConfigured = vi.hoisted(() => vi.fn(() => true));
const isAuthBypassed = vi.hoisted(() => vi.fn(() => false));
vi.mock("../auth/supabase", () => ({
  getSupabaseClient,
  isAuthConfigured,
  isAuthBypassed,
}));

import i18n from "../../i18n";
import { AuthProvider } from "../auth/auth";
import { ThemeModeProvider } from "../../theme-mode";
import { TopBar } from "./TopBar";

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(() => {
  cleanup();
  isAuthBypassed.mockReturnValue(false);
});

function makeClient(overrides: Record<string, unknown> = {}) {
  const unsubscribe = vi.fn();
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "tok", user: { id: "u", email: "a@b.c" } } },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe } },
      })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      ...overrides,
    },
  };
}

function renderTopBar() {
  return render(
    <ThemeModeProvider>
      <AuthProvider>
        <TopBar
          pendingCount={0}
          desktop
          onNewMovement={() => {}}
          onOpenManagement={() => {}}
        />
      </AuthProvider>
    </ThemeModeProvider>,
  );
}

async function openManagementMenu() {
  fireEvent.click(await screen.findByRole("button", { name: "Gestión" }));
}

describe("TopBar user menu (T29, L38)", () => {
  it("shows the session email and account actions when a session exists", async () => {
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);
    isAuthConfigured.mockReturnValue(true);

    renderTopBar();
    fireEvent.click(
      await screen.findByRole("button", { name: "Menú de cuenta" }),
    );

    expect(await screen.findByText("a@b.c")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Cambiar contraseña" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Cerrar sesión" }),
    ).toBeTruthy();
  });

  it("hides the user menu when there is no session (bypass)", async () => {
    isAuthBypassed.mockReturnValue(true);
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    renderTopBar();

    await screen.findByRole("button", { name: "Gestión" });
    expect(
      screen.queryByRole("button", { name: "Menú de cuenta" }),
    ).toBeNull();
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it("hides the user menu when configured but the session is empty", async () => {
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    });
    getSupabaseClient.mockReturnValue(client);

    renderTopBar();

    await waitFor(() => {
      expect(client.auth.getSession).toHaveBeenCalled();
    });
    await screen.findByRole("button", { name: "Gestión" });
    expect(
      screen.queryByRole("button", { name: "Menú de cuenta" }),
    ).toBeNull();
  });

  it("no longer offers logout inside the Gestión menu", async () => {
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);
    isAuthConfigured.mockReturnValue(true);

    renderTopBar();
    await openManagementMenu();

    await screen.findByRole("menuitem", { name: "Cuentas" });
    expect(
      screen.queryByRole("menuitem", { name: "Cerrar sesión" }),
    ).toBeNull();
  });

  it("signs out from the user menu", async () => {
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);
    isAuthConfigured.mockReturnValue(true);

    renderTopBar();
    fireEvent.click(
      await screen.findByRole("button", { name: "Menú de cuenta" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Cerrar sesión" }),
    );

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the change-password dialog from the user menu", async () => {
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);
    isAuthConfigured.mockReturnValue(true);

    renderTopBar();
    fireEvent.click(
      await screen.findByRole("button", { name: "Menú de cuenta" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Cambiar contraseña" }),
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Nueva contraseña")).toBeTruthy();
    expect(screen.getByLabelText("Confirmar contraseña")).toBeTruthy();
  });
});
