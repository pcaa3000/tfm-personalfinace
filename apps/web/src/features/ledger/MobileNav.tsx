import { ButtonBase, Fab, Paper, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  ChartIcon,
  HomeIcon,
  ListIcon,
  PlusIcon,
} from "./icons";

interface Props {
  onNavigateList: () => void;
  onNewMovement: () => void;
}

/**
 * Mobile chrome (S12-6): floating dark pill tabbar with the mint active
 * item + violet FAB that opens the movement dialog.
 */
export function MobileNav({ onNavigateList, onNewMovement }: Props) {
  const { t } = useTranslation();

  const item = (
    icon: React.ReactNode,
    label: string,
    current: boolean,
    onClick?: () => void,
  ) => (
    <ButtonBase
      key={label}
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.4,
        minHeight: 50,
        borderRadius: "22px",
        color: current ? "#3dd68c" : "rgb(255 255 255 / 0.55)",
        bgcolor: current ? "rgb(61 214 140 / 0.12)" : "transparent",
        fontSize: 10.5,
        fontWeight: 650,
      }}
    >
      {icon}
      <Typography component="span" sx={{ fontSize: 10.5, fontWeight: 650 }}>
        {label}
      </Typography>
    </ButtonBase>
  );

  return (
    <>
      <Paper
        component="nav"
        aria-label={t("nav.mainNav")}
        elevation={8}
        sx={{
          position: "fixed",
          left: 14,
          right: 14,
          bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          zIndex: 75,
          display: "flex",
          alignItems: "stretch",
          bgcolor: "#171221",
          border: "1px solid rgb(255 255 255 / 0.08)",
          borderRadius: "28px",
          p: 0.5,
        }}
      >
        {item(<HomeIcon sx={{ fontSize: 20 }} />, t("nav.panel"), true)}
        {item(
          <ListIcon sx={{ fontSize: 20 }} />,
          t("nav.movements"),
          false,
          onNavigateList,
        )}
        {item(
          <ChartIcon sx={{ fontSize: 20 }} />,
          t("nav.reports"),
          false,
          onNavigateList,
        )}
      </Paper>
      <Fab
        aria-label={t("topbar.newMovement")}
        onClick={onNewMovement}
        sx={{
          position: "fixed",
          right: 18,
          bottom: "calc(58px + env(safe-area-inset-bottom, 0px) + 30px)",
          zIndex: 80,
          width: 58,
          height: 58,
          background:
            "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #9333ea 100%)",
          color: "#fff",
          boxShadow: "0 14px 30px -8px rgb(111 45 244 / 0.6)",
          "&:hover": { filter: "brightness(1.07)" },
        }}
      >
        <PlusIcon />
      </Fab>
    </>
  );
}
