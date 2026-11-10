// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const getSupabaseClient = vi.hoisted(() => vi.fn());
const isAuthConfigured = vi.hoisted(() => vi.fn(() => true));
const isAuthBypassed = vi.hoisted(() => vi.fn(() => false));
vi.mock("./supabase", () => ({
  getSupabaseClient,
  isAuthConfigured,
  isAuthBypassed,
}));

import i18n from "../../i18n";
import { AuthProvider } from "./auth";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

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
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe } },
      })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      ...overrides,
    },
    unsubscribe,
  };
}

function renderDialog({
  onClose = vi.fn(),
  clientOverrides = {},
}: {
  onClose?: () => void;
  clientOverrides?: Record<string, unknown>;
} = {}) {
  const client = makeClient(clientOverrides);
  getSupabaseClient.mockReturnValue(client);
  render(
    <AuthProvider>
      <ChangePasswordDialog open onClose={onClose} />
    </AuthProvider>,
  );
  return { client, onClose };
}

function fillPasswords(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
    target: { value: confirm },
  });
}

const saveButton = () => screen.getByRole("button", { name: "Guardar" });

describe("ChangePasswordDialog (T29, L38)", () => {
  it("keeps Guardar disabled while both fields are empty", async () => {
    const { client } = renderDialog();

    await screen.findByLabelText("Nueva contraseña");
    expect(saveButton()).toHaveProperty("disabled", true);
    fireEvent.click(saveButton());
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("shows passwordTooShort below the Supabase minimum and stays disabled", async () => {
    renderDialog();

    await screen.findByLabelText("Nueva contraseña");
    fillPasswords("abc", "abc");

    expect(await screen.findByText("Mínimo 6 caracteres")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
  });

  it("shows passwordMismatch and never calls updateUser", async () => {
    const { client } = renderDialog();

    await screen.findByLabelText("Nueva contraseña");
    fillPasswords("secret123", "different1");

    expect(
      await screen.findByText("Las contraseñas no coinciden"),
    ).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
    fireEvent.click(saveButton());
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("submits updatePassword and closes on success", async () => {
    const { client, onClose } = renderDialog();

    await screen.findByLabelText("Nueva contraseña");
    fillPasswords("secret123", "secret123");
    await waitFor(() => {
      expect(saveButton()).toHaveProperty("disabled", false);
    });

    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(client.auth.updateUser).toHaveBeenCalledWith({
        password: "secret123",
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces account.error and stays open when the update fails", async () => {
    const onClose = vi.fn();
    renderDialog({
      onClose,
      clientOverrides: {
        updateUser: vi.fn(async () => ({
          data: {},
          error: new Error("weak password"),
        })),
      },
    });

    await screen.findByLabelText("Nueva contraseña");
    fillPasswords("secret123", "secret123");
    fireEvent.click(saveButton());

    expect(
      await screen.findByText(
        "No se pudo actualizar la contraseña. Intentá de nuevo.",
      ),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the fields each time the dialog opens", async () => {
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);
    const onClose = vi.fn();
    const { rerender } = render(
      <AuthProvider>
        <ChangePasswordDialog open onClose={onClose} />
      </AuthProvider>,
    );

    await screen.findByLabelText("Nueva contraseña");
    fillPasswords("secret123", "secret123");

    // Close and reopen: the dialog component stays mounted, so only the
    // open-transition reset can clear the fields.
    rerender(
      <AuthProvider>
        <ChangePasswordDialog open={false} onClose={onClose} />
      </AuthProvider>,
    );
    rerender(
      <AuthProvider>
        <ChangePasswordDialog open onClose={onClose} />
      </AuthProvider>,
    );

    await screen.findByLabelText("Nueva contraseña");
    expect(
      (screen.getByLabelText("Nueva contraseña") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Confirmar contraseña") as HTMLInputElement).value,
    ).toBe("");
  });
});
