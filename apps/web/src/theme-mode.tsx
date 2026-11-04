import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const THEME_MODE_STORAGE_KEY = "tfm-theme-mode";
export type ThemeMode = "light" | "dark";

/** Stored preference, or null when absent/invalid. */
export function storedThemeMode(): ThemeMode | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function osPreference(): ThemeMode {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/** Stored preference wins; otherwise follow the OS (anti-FOUC parity). */
export function resolveThemeMode(): ThemeMode {
  return storedThemeMode() ?? osPreference();
}

export function persistThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // private mode / quota — the toggle still works for the session
  }
}

interface ThemeModeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(resolveThemeMode);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      persistThemeMode(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);
  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeModeProvider");
  }
  return context;
}
