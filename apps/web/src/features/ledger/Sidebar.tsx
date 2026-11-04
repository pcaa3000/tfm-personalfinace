import {
  Box,
  ButtonBase,
  List,
  ListItem,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  BrandMark,
  RailToggle,
  type ManagementSection,
} from "./TopBar";
import {
  ChartIcon,
  CoinIcon,
  GearIcon,
  HomeIcon,
  ListIcon,
  TagIcon,
  WalletIcon,
} from "./icons";

const RAIL_STORAGE_KEY = "tfm-rail-collapsed";

export function storedRailCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // non-fatal
  }
}

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenManagement: (section: ManagementSection) => void;
  onNavigateList: () => void;
}

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  current?: boolean;
  onClick?: () => void;
}

/**
 * Desktop sidebar (S12-6): brand, ledger nav and the Gestión group that
 * opens the same management dialogs as the topbar menu. Collapsible to
 * an icon rail, persisted as tfm-rail-collapsed (artboard behaviour).
 */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onOpenManagement,
  onNavigateList,
}: Props) {
  const { t } = useTranslation();

  const ledgerItems: NavItem[] = [
    {
      key: "panel",
      icon: <HomeIcon fontSize="small" />,
      label: t("nav.panel"),
      current: true,
    },
    {
      key: "movements",
      icon: <ListIcon fontSize="small" />,
      label: t("nav.movements"),
      onClick: onNavigateList,
    },
    {
      key: "reports",
      icon: <ChartIcon fontSize="small" />,
      label: t("nav.reports"),
      onClick: onNavigateList,
    },
  ];

  const managementItems: NavItem[] = [
    {
      key: "accounts",
      icon: <WalletIcon fontSize="small" />,
      label: t("management.accounts"),
      onClick: () => onOpenManagement("accounts"),
    },
    {
      key: "categories",
      icon: <TagIcon fontSize="small" />,
      label: t("management.categories"),
      onClick: () => onOpenManagement("categories"),
    },
    {
      key: "currencies",
      icon: <CoinIcon fontSize="small" />,
      label: t("management.currencies"),
      onClick: () => onOpenManagement("currencies"),
    },
    {
      key: "preferences",
      icon: <GearIcon fontSize="small" />,
      label: t("management.preferences"),
      onClick: () => onOpenManagement("preferences"),
    },
  ];

  const renderItem = (item: NavItem) => (
    <ListItem key={item.key} disableGutters sx={{ mb: 0.25 }}>
      <ButtonBase
        onClick={item.onClick}
        aria-current={item.current ? "page" : undefined}
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 1.25,
          width: "100%",
          px: collapsed ? 0 : 1.25,
          py: 1.1,
          borderRadius: "10px",
          fontWeight: item.current ? 700 : 500,
          fontSize: 14,
          color: item.current ? "#fff" : "text.primary",
          background: item.current
            ? "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #9333ea 100%)"
            : "transparent",
          boxShadow: item.current
            ? "0 8px 18px -10px rgb(111 45 244 / 0.55)"
            : "none",
          "&:hover": item.current
            ? undefined
            : { bgcolor: theme.palette.action.hover },
        })}
      >
        {item.icon}
        {collapsed ? null : <Box component="span">{item.label}</Box>}
      </ButtonBase>
    </ListItem>
  );

  return (
    <Box
      component="aside"
      aria-label={t("nav.mainNav")}
      sx={{
        width: collapsed ? 68 : 236,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        px: collapsed ? 1 : 1.75,
        py: 2.25,
        bgcolor: "background.paper",
        borderRight: "1px solid",
        borderColor: "divider",
        transition: "width 0.2s ease",
        overflowY: "auto",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexDirection: collapsed ? "column" : "row",
          gap: 1.25,
          pb: 2.25,
        }}
      >
        <BrandMark />
        {collapsed ? null : (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
              {t("app.brand")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("app.tagline")}
            </Typography>
          </Box>
        )}
        <Box sx={{ ml: collapsed ? 0 : "auto" }}>
          <RailToggle collapsed={collapsed} onToggle={onToggleCollapsed} />
        </Box>
      </Box>

      {collapsed ? null : (
        <Typography
          variant="caption"
          sx={{
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "text.secondary",
            fontWeight: 700,
            mx: 1,
            mt: 1.5,
            mb: 0.5,
          }}
        >
          {t("nav.ledger")}
        </Typography>
      )}
      <nav aria-label={t("nav.mainNav")}>
        <List disablePadding>{ledgerItems.map(renderItem)}</List>
        {collapsed ? null : (
          <Typography
            variant="caption"
            sx={{
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "text.secondary",
              fontWeight: 700,
              mx: 1,
              mt: 1.5,
              mb: 0.5,
              display: "block",
            }}
          >
            {t("nav.management")}
          </Typography>
        )}
        <List disablePadding aria-label={t("nav.management")}>
          {managementItems.map(renderItem)}
        </List>
      </nav>
    </Box>
  );
}
