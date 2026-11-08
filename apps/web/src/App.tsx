import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Box, CssBaseline, ThemeProvider, Typography } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AuthProvider, useAuth } from "./features/auth/auth";
import { LoginPage } from "./features/auth/LoginPage";
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
      <AuthGate />
    </ThemeProvider>
  );
}

/**
 * T6-web gate: with Supabase configured the ledger requires a session
 * (login screen otherwise); without it the app keeps the dev passthrough.
 */
function AuthGate() {
  const { t } = useTranslation();
  const { configured, loading, session } = useAuth();

  if (!configured || session) {
    return <LedgerPage />;
  }
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Typography color="text.secondary">{t("login.loading")}</Typography>
      </Box>
    );
  }
  return <LoginPage />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <AuthProvider>
          <ThemedApp />
        </AuthProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  );
}
