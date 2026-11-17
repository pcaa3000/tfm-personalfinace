import {
  alpha,
  createTheme,
  type PaletteColor,
  type PaletteColorOptions,
  type Theme,
} from "@mui/material";

import type { ThemeMode } from "./theme-mode";

declare module "@mui/material/styles" {
  interface Palette {
    /** Transfer identity — the artboard's violet-grey `--transfer` (S9). */
    transfer: PaletteColor;
  }
  interface PaletteOptions {
    transfer?: PaletteColorOptions;
  }
}

declare module "@mui/material/Chip" {
  interface ChipPropsColorOverrides {
    transfer: true;
  }
}

/**
 * Financial design system (S12-7, artboard design/ledger-home/04-hybrid):
 * vivid violet + mint accent duo. Light keeps a clean fintech surface;
 * dark keeps the same accents on deep violet-ink surfaces.
 */
export function buildAppTheme(mode: ThemeMode): Theme {
  const light = mode === "light";
  return createTheme({
    palette: {
      mode,
      primary: {
        main: light ? "#7c3aed" : "#a78bfa",
        dark: light ? "#6d28d9" : "#c4b5fd",
        contrastText: light ? "#ffffff" : "#1b1035",
      },
      secondary: {
        main: "#3dd68c",
        dark: "#0f9c72",
        contrastText: "#053220",
      },
      success: { main: light ? "#0d7a4c" : "#4cc38a" },
      error: { main: light ? "#b3261e" : "#ff8a80" },
      // S9: one token for transfers across table and day-cards,
      // matching the artboard's --transfer violet-grey.
      transfer: {
        main: light ? "#7c6bad" : "#b4a7d6",
        contrastText: light ? "#ffffff" : "#1b1035",
      },
      background: {
        default: light ? "#f2f4f6" : "#120e1f",
        paper: light ? "#ffffff" : "#1c1730",
      },
      text: {
        primary: light ? "#1b1533" : "#efeaf9",
        secondary: light ? "#5d6472" : "#a79dbf",
      },
      divider: light ? "#e2e6ec" : "#372e52",
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { textTransform: "none", fontWeight: 600 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: "none",
            "&.Mui-selected": {
              backgroundColor: alpha(theme.palette.primary.main, 0.16),
              color: theme.palette.primary.main,
            },
          }),
        },
      },
    },
  });
}
