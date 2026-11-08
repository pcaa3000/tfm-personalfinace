// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const getSupabaseClient = vi.hoisted(() => vi.fn());
const isAuthConfigured = vi.hoisted(() => vi.fn(() => true));
vi.mock("../auth/supabase", () => ({ getSupabaseClient, isAuthConfigured }));

import i18n from "../../i18n";
import { AuthProvider } from "../auth/auth";
import { ThemeModeProvider } from "../../theme-mode";
import { TopBar } from "./TopBar";

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

function makeClient() {
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

describe("TopBar logout (T6-web)", () => {
  it("offers a logout action inside the Gestión menu when a session exists", async () => {
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);
    isAuthConfigured.mockReturnValue(true);

    renderTopBar();
    await openManagementMenu();

    const item = await screen.findByRole("menuitem", { name: "Cerrar sesión" });
    fireEvent.click(item);

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("hides the logout action when auth is not configured", async () => {
    isAuthConfigured.mockReturnValue(false);

    renderTopBar();
    await openManagementMenu();

    await screen.findByRole("menuitem", { name: "Cuentas" });
    expect(
      screen.queryByRole("menuitem", { name: "Cerrar sesión" }),
    ).toBeNull();
  });
});
