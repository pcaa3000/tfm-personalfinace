// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
vi.mock("../auth/auth", () => ({
  useAuth: () => ({ configured: true, loading: false, session: null, signIn, signUp, signOut: vi.fn() }),
}));

import i18n from "../../i18n";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  signIn.mockReset();
  signUp.mockReset();
});

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

function fillCredentials(email = "ana@example.com", password = "secreto123") {
  // MUI required labels carry an asterisk, so select by input id.
  const emailInput = document.getElementById("login-email") as HTMLInputElement;
  const passwordInput = document.getElementById("login-password") as HTMLInputElement;
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.change(passwordInput, { target: { value: password } });
}

describe("LoginPage", () => {
  it("signs in with email and password", async () => {
    signIn.mockResolvedValue(undefined);
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("ana@example.com", "secreto123");
    });
  });

  it("surfaces a localized error when sign-in fails", async () => {
    signIn.mockRejectedValue(new Error("Invalid login credentials"));
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "No se pudo iniciar sesión. Revisá los datos e intentá de nuevo.",
    );
  });

  it("toggles to sign-up mode and calls signUp", async () => {
    signUp.mockResolvedValue(undefined);
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "¿No tenés cuenta? Crear cuenta" }),
    );
    fillCredentials("nuevo@example.com", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith("nuevo@example.com", "pw-123456");
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("toggles back to sign-in mode", async () => {
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "¿No tenés cuenta? Crear cuenta" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "¿Ya tenés cuenta? Iniciar sesión" }),
    );

    expect(
      screen.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeTruthy();
  });
});
