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
 * T6-web gate + T26 (L35): bypassed or missing credentials never reach
 * the login screen silently — bypassed passes through to the ledger,
 * misconfigured fails closed with a configuration error screen.
 */
function AuthGate() {
  const { t } = useTranslation();
  const { configured, misconfigured, loading, session } = useAuth();

  if (misconfigured) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          px: 3,
        }}
      >
        <Box sx={{ maxWidth: 520, textAlign: "center" }}>
          <Typography component="h1" variant="h6" gutterBottom>
            {t("login.misconfigTitle")}
          </Typography>
          <Typography color="text.secondary">
            {t("login.misconfigBody")}
          </Typography>
        </Box>
      </Box>
    );
  }
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
