import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { useMemo } from "react";

import { LedgerPage } from "./features/ledger/LedgerPage";
import { buildAppTheme } from "./theme";
import { ThemeModeProvider, useThemeMode } from "./theme-mode";

const queryClient = new QueryClient();

function ThemedApp() {
  const { mode } = useThemeMode();
  const theme = useMemo(() => buildAppTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LedgerPage />
    </ThemeProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <ThemedApp />
      </ThemeModeProvider>
    </QueryClientProvider>
  );
}
