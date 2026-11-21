// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
const signInDemo = vi.hoisted(() => vi.fn());
const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("../auth/auth", () => ({
  useAuth: () => ({ configured: true, loading: false, session: null, demoSession: false, signIn, signUp, signInDemo, signInWithOAuth, signOut: vi.fn() }),
}));

import i18n from "../../i18n";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  signIn.mockReset();
  signUp.mockReset();
  signInDemo.mockReset();
  signInWithOAuth.mockReset();
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

  // T30 (S13): social login buttons delegate to signInWithOAuth.
  it("continues with Google via OAuth", async () => {
    signInWithOAuth.mockResolvedValue(undefined);
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continuar con Google" }),
    );

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("google");
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("continues with Facebook via OAuth", async () => {
    signInWithOAuth.mockResolvedValue(undefined);
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continuar con Facebook" }),
    );

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("facebook");
    });
  });

  it("surfaces a localized error when OAuth sign-in fails", async () => {
    signInWithOAuth.mockRejectedValue(new Error("Provider is not enabled"));
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continuar con Google" }),
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "No se pudo iniciar sesión. Revisá los datos e intentá de nuevo.",
    );
  });

  // demo-maria-login T2 (S1): a visible demo entry next to the OAuth
  // buttons delegates to signInDemo, which re-seeds the demo workspace
  // server-side before opening the client-side demo session.
  it("offers a visible demo entry that signs in via signInDemo", async () => {
    signInDemo.mockResolvedValue(undefined);
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Probar con datos de María" }),
    );

    await waitFor(() => {
      expect(signInDemo).toHaveBeenCalledTimes(1);
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("warns that demo changes are discarded", () => {
    render(<LoginPage />);

    expect(screen.getByText(/se descartan/i)).toBeTruthy();
  });

  it("surfaces a localized error when the demo sign-in fails", async () => {
    signInDemo.mockRejectedValue(new Error("reset failed"));
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Probar con datos de María" }),
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "No se pudo iniciar la demo. Intentá de nuevo.",
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
