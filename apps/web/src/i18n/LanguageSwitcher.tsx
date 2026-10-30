import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useTranslation } from "react-i18next";

import { setLocale, type AppLocale } from "./index";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current: AppLocale = i18n.language.startsWith("en") ? "en" : "es";

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={current}
      onChange={(_event, value: AppLocale | null) => {
        if (value) {
          setLocale(value);
        }
      }}
      aria-label="Language / Idioma"
    >
      <ToggleButton value="es">ES</ToggleButton>
      <ToggleButton value="en">EN</ToggleButton>
    </ToggleButtonGroup>
  );
}
