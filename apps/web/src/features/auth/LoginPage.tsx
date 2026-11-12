import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandMark } from "../ledger/BrandMark";
import { useAuth } from "./auth";

type Mode = "signin" | "signup";

/**
 * Login screen (T6-web): email+password against the user's Supabase
 * project. Sign-up mode is a toggle so the user can create their
 * account when none exists yet.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { signIn, signInWithOAuth, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const signup = mode === "signup";

  const toggleMode = () => {
    setMode((current) => (current === "signin" ? "signup" : "signin"));
    setError(false);
  };

  // T30 (S13): social login delegates to the OAuth PKCE redirect; the
  // browser navigates away on success, so a rejection is the only path
  // that needs the local error Alert.
  const continueWithOAuth = async (provider: "google" | "facebook") => {
    setError(false);
    try {
      await signInWithOAuth(provider);
    } catch {
      setError(true);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      if (signup) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 1.75,
        py: 4,
        bgcolor: "background.default",
      }}
    >
      <Card
        component="main"
        sx={{
          width: "100%",
          maxWidth: 400,
          borderRadius: "20px",
          boxShadow: "0 24px 60px -24px rgb(76 29 149 / 0.35)",
        }}
      >
        <CardContent>
          <Stack spacing={2.5} sx={{ pt: 1, alignItems: "center" }}>
            <BrandMark />
            <Box sx={{ textAlign: "center" }}>
              <Typography component="h1" sx={{ fontSize: 20, fontWeight: 750 }}>
                {signup ? t("login.signUpTitle") : t("login.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("login.subtitle")}
              </Typography>
            </Box>

            {error ? (
              <Alert severity="error" sx={{ width: "100%" }}>
                {t(signup ? "login.signUpError" : "login.error")}
              </Alert>
            ) : null}

            <Stack spacing={1.25} sx={{ width: "100%" }}>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => void continueWithOAuth("google")}
                sx={{ textTransform: "none" }}
              >
                {t("login.continueWithGoogle")}
              </Button>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => void continueWithOAuth("facebook")}
                sx={{ textTransform: "none" }}
              >
                {t("login.continueWithFacebook")}
              </Button>
            </Stack>

            <Divider sx={{ width: "100%" }}>{t("login.or")}</Divider>

            <Box
              component="form"
              onSubmit={submit}
              sx={{ width: "100%" }}
              noValidate
            >
              <Stack spacing={2}>
                <TextField
                  id="login-email"
                  label={t("login.email")}
                  type="email"
                  autoComplete="email"
                  required
                  fullWidth
                  size="small"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <TextField
                  id="login-password"
                  label={t("login.password")}
                  type="password"
                  autoComplete={
                    signup ? "new-password" : "current-password"
                  }
                  required
                  fullWidth
                  size="small"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={submitting}
                  sx={{
                    background:
                      "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #9333ea 100%)",
                    color: "#fff",
                  }}
                >
                  {submitting
                    ? t(signup ? "login.signUpSubmitting" : "login.submitting")
                    : signup
                      ? t("login.signUpSubmit")
                      : t("login.submit")}
                </Button>
              </Stack>
            </Box>

            <Button
              variant="text"
              size="small"
              onClick={toggleMode}
              sx={{ textTransform: "none" }}
            >
              {signup ? t("login.hasAccount") : t("login.createAccount")}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
