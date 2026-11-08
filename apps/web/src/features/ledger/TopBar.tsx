import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandMark } from "./BrandMark";
import { useAuth } from "../auth/auth";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import { useThemeMode } from "../../theme-mode";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  CoinIcon,
  GearIcon,
  LogoutIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  TagIcon,
  WalletIcon,
} from "./icons";

export type ManagementSection =
  | "accounts"
  | "categories"
  | "currencies"
  | "preferences";

export const TOPBAR_HEIGHT = 56;

interface Props {
  pendingCount: number;
  desktop: boolean;
  onNewMovement: () => void;
  onOpenManagement: (section: ManagementSection) => void;
}

/**
 * Sticky top bar (S12-6): brand/crumb, "+ Nuevo movimiento" CTA, the
 * Gestión menu (Cuentas/Categorías/Monedas/Preferencias), the theme
 * toggle persisted as tfm-theme-mode (S12-7) and the ES/EN switcher.
 */
export function TopBar({
  pendingCount,
  desktop,
  onNewMovement,
  onOpenManagement,
}: Props) {
  const { t } = useTranslation();
  const { configured, signOut } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const openManagement = (section: ManagementSection) => () => {
    setMenuAnchor(null);
    onOpenManagement(section);
  };

  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 70,
        height: TOPBAR_HEIGHT,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: { xs: 1.75, md: 2.75 },
        bgcolor: "background.paper",
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      {desktop ? (
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: 16, fontWeight: 700 }}>
            {t("app.brand")}{" "}
            <Box
              component="span"
              sx={{ fontWeight: 500, color: "text.secondary", fontSize: 13 }}
            >
              · {t("nav.panel")}
            </Box>
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: "block" }}
          >
            {t("app.tagline")}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <BrandMark />
          <Typography
            sx={{
              fontWeight: 750,
              fontSize: 15,
              whiteSpace: "nowrap",
              display: { xs: "none", sm: "block" },
            }}
          >
            {t("app.brand")}
          </Typography>
        </Box>
      )}

      <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
        {pendingCount > 0 ? (
          <Chip
            size="small"
            color="warning"
            label={t("pending.badge", { count: pendingCount })}
          />
        ) : null}
        <Button
          variant="contained"
          onClick={onNewMovement}
          startIcon={<PlusIcon sx={{ fontSize: 15 }} />}
          sx={{
            background:
              "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #9333ea 100%)",
            color: "#fff",
            boxShadow: "0 10px 22px -10px rgb(111 45 244 / 0.55)",
            "& .btn-txt": { display: { xs: "none", md: "inline" } },
          }}
          aria-label={t("topbar.newMovement")}
        >
          <Box component="span" className="btn-txt">
            {t("topbar.newMovement")}
          </Box>
        </Button>
        <Button
          variant="outlined"
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          endIcon={<ChevronDownIcon sx={{ fontSize: 12 }} />}
          aria-haspopup="menu"
          aria-expanded={menuAnchor !== null}
        >
          {t("topbar.management")}
        </Button>
        <Menu
          anchorEl={menuAnchor}
          open={menuAnchor !== null}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ list: { "aria-label": t("management.menu") } }}
        >
          <MenuItem onClick={openManagement("accounts")}>
            <WalletIcon fontSize="small" sx={{ mr: 1.25 }} />
            {t("management.accounts")}
          </MenuItem>
          <MenuItem onClick={openManagement("categories")}>
            <TagIcon fontSize="small" sx={{ mr: 1.25 }} />
            {t("management.categories")}
          </MenuItem>
          <MenuItem onClick={openManagement("currencies")}>
            <CoinIcon fontSize="small" sx={{ mr: 1.25 }} />
            {t("management.currencies")}
          </MenuItem>
          <Divider />
          <MenuItem onClick={openManagement("preferences")}>
            <GearIcon fontSize="small" sx={{ mr: 1.25 }} />
            {t("management.preferences")}
          </MenuItem>
          {configured ? (
            <>
              <Divider />
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  void signOut();
                }}
              >
                <LogoutIcon fontSize="small" sx={{ mr: 1.25 }} />
                {t("topbar.logout")}
              </MenuItem>
            </>
          ) : null}
        </Menu>
        <IconButton
          onClick={toggleMode}
          aria-pressed={mode === "dark"}
          aria-label={
            mode === "dark" ? t("topbar.themeToLight") : t("topbar.themeToDark")
          }
          sx={{ border: "1px solid", borderColor: "divider" }}
        >
          {mode === "dark" ? (
            <MoonIcon sx={{ fontSize: 19 }} />
          ) : (
            <SunIcon sx={{ fontSize: 19 }} />
          )}
        </IconButton>
        <LanguageSwitcher />
      </Box>
    </Box>
  );
}

/** Sidebar collapse affordance (desktop rail, tfm-rail-collapsed). */
export function RailToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <IconButton
      size="small"
      onClick={onToggle}
      aria-pressed={collapsed}
      aria-label={
        collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")
      }
      sx={{
        border: "1px solid",
        borderColor: "divider",
        transform: collapsed ? "rotate(180deg)" : "none",
      }}
    >
      <ChevronLeftIcon sx={{ fontSize: 15 }} />
    </IconButton>
  );
}
