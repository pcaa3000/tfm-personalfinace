import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "./en";
import { es } from "./es";

const LOCALE_STORAGE_KEY = "tfm-locale";
export type AppLocale = "es" | "en";

function storedLocale(): AppLocale | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const value = localStorage.getItem(LOCALE_STORAGE_KEY);
  return value === "es" || value === "en" ? value : null;
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: storedLocale() ?? "es", // Spanish-first product
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLocale(locale: AppLocale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
