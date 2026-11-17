import { Box } from "@mui/material";

import { currencySymbol } from "./format";

interface Props {
  /** Canonical decimal string, e.g. "9134.25" or "-565.75". */
  amount: string;
  currency: string;
  /** Minor-unit exponent of the currency (workspace catalog). */
  exponent?: number;
  /** Explicit display sign; the amount's own "-" is also honoured. */
  sign?: "+" | "−" | "";
  /**
   * Privacy mask (S4): replaces the amount's digit runs with •••, like
   * the artboard's `.amt-masked` (digit sequence → "•••").
   */
  masked?: boolean;
}

/**
 * Money amount with thousands grouping and dimmed decimals — the
 * financial design system keeps cents visually quieter (S12-7).
 */
export function AmountText({
  amount,
  currency,
  exponent = 2,
  sign = "",
  masked = false,
}: Props) {
  const negative = amount.startsWith("-");
  const [rawInt = "0", rawFrac = ""] = amount.replace("-", "").split(".");
  const grouped = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = rawFrac.padEnd(exponent, "0").slice(0, exponent);

  if (masked) {
    return (
      <Box
        component="span"
        className="amt-masked"
        sx={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.06em" }}
      >
        {sign}
        {negative ? "−" : ""}
        {currencySymbol(currency)} •••
      </Box>
    );
  }

  return (
    <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
      {sign}
      {negative ? "−" : ""}
      {currencySymbol(currency)} {grouped}
      {exponent > 0 ? (
        <Box
          component="span"
          data-part="decimals"
          sx={{ fontWeight: 500, opacity: 0.55, fontSize: "0.88em" }}
        >
          .{frac}
        </Box>
      ) : null}
    </Box>
  );
}
