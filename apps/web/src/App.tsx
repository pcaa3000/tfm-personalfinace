import { QueryClientProvider } from "@tanstack/react-query";
import { Box, CssBaseline, ThemeProvider, Typography } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AuthProvider, useAuth } from "./features/auth/auth";
import { LoginPage } from "./features/auth/LoginPage";
import { LedgerPage } from "./features/ledger/LedgerPage";
import { ReportsPage } from "./features/reports/ReportsPage";
import { useAppRoute } from "./features/reports/route";
import { buildAppTheme } from "./theme";
import { queryClient } from "./query-client";
import { ThemeModeProvider, useThemeMode } from "./theme-mode";

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
 * reports-monthly T7 (S7): two top-level views behind a hash route —
 * '#/reports' renders the reports page, anything else the ledger.
 * The app has no router dependency; the hash keeps deep-linking free.
 */
function RoutedPage() {
  return useAppRoute() === "reports" ? <ReportsPage /> : <LedgerPage />;
}

/**
 * T6-web gate + T26 (L35): bypassed or missing credentials never reach
 * the login screen silently — bypassed passes through to the ledger,
 * misconfigured fails closed with a configuration error screen.
 */
function AuthGate() {
  const { t } = useTranslation();
  const { configured, misconfigured, loading, session, demoPending } =
    useAuth();

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
  // demo-maria-session T8: a demo sign-in is a real Supabase
  // session (the per-tab sid only rides in request headers), so the
  // gate needs no demo-specific branch.
  if (!configured) {
    return <RoutedPage />;
  }
  // demo-maria-session T9 (S10): while the sid mints and the async
  // seed runs, hold a preparing state — landing on an empty ledger
  // mid-seed reads as "no data" and defeats the demo's purpose.
  if (session && demoPending) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Typography color="text.secondary">
          {t("login.demoSubmitting")}
        </Typography>
      </Box>
    );
  }
  if (session) {
    return <RoutedPage />;
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
