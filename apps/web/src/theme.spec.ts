import { describe, expect, it } from "vitest";

import { buildAppTheme } from "./theme";

type StyleRule = Record<string, unknown>;

/** Resolved MuiButtonBase root override for the given mode. */
function buttonBaseRoot(mode: "light" | "dark"): StyleRule {
  const theme = buildAppTheme(mode);
  const overrides = theme.components?.MuiButtonBase?.styleOverrides;
  const rootRaw = (overrides as Record<string, unknown> | undefined)?.["root"];
  return typeof rootRaw === "function"
    ? (rootRaw as (arg: { theme: unknown }) => StyleRule)({ theme })
    : ((rootRaw ?? {}) as StyleRule);
}

describe("app theme — accesibilidad (S12)", () => {
  it.each(["light", "dark"] as const)(
    "defines a visible keyboard focus ring on MuiButtonBase (%s mode)",
    (mode) => {
      const root = buttonBaseRoot(mode);
      const focusKey = Object.keys(root).find((key) =>
        /(:focus-visible|Mui-focusVisible)/.test(key),
      );
      expect(focusKey).toBeTruthy();

      const rule = root[focusKey!] as StyleRule;
      expect(String(rule.outline)).toMatch(/\d+px solid/);
      expect(rule.outlineOffset ?? rule["outline-offset"]).toBeTruthy();
    },
  );
});
