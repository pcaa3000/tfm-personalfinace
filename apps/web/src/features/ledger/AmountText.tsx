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
}

/**
 * Money amount with thousands grouping and dimmed decimals — the
 * financial design system keeps cents visually quieter (S12-7).
 */
export function AmountText({ amount, currency, exponent = 2, sign = "" }: Props) {
  const negative = amount.startsWith("-");
  const [rawInt = "0", rawFrac = ""] = amount.replace("-", "").split(".");
  const grouped = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = rawFrac.padEnd(exponent, "0").slice(0, exponent);

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
