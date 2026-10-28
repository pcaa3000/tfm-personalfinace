import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

import { LedgerPage } from "./features/ledger/LedgerPage";

const queryClient = new QueryClient();
const theme = createTheme();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LedgerPage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
