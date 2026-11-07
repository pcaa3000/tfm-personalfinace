import { alpha, Box, Chip, IconButton, Typography } from "@mui/material";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AmountText } from "./AmountText";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { minorToDecimalString } from "./format";
import type { CurrencySummary } from "./summarize";
import type { AccountView } from "./types";

interface Props {
  summaries: CurrencySummary[];
  accounts: AccountView[];
  defaultCurrency: string;
  exponentOf?: (code: string) => number;
}

/**
 * Sticky-top "Balance general por moneda" (S12-5): one brand-tinted card
 * per currency — the workspace default currency takes the violet
 * gradient, the next accent takes mint — with saldo actual, ingresos and
 * gastos. On mobile it becomes a snap carousel with dots (S12-6).
 */
export function BalanceStrip({
  summaries,
  accounts,
  defaultCurrency,
  exponentOf = () => 2,
}: Props) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const accountNames = (currency: string) =>
    accounts
      .filter((a) => a.currency === currency)
      .map((a) => a.name)
      .join(" · ");

  const cardStep = () => {
    const card = scrollerRef.current?.querySelector<HTMLElement>(
      "[data-currency]",
    );
    // gap 1.5 * 8px (theme.spacing) = 12px between cards.
    return card ? card.offsetWidth + 24 : 0;
  };

  const scrollToCard = (index: number) => {
    scrollerRef.current?.scrollTo({
      left: index * cardStep(),
      behavior: "smooth",
    });
  };

  const scrollByCard = (direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({
      left: direction * cardStep(),
      behavior: "smooth",
    });
  };

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    const step = cardStep();
    if (scroller && step > 0) {
      setActiveIndex(Math.round(scroller.scrollLeft / step));
    }
  };

  const variantOf = (currency: string, index: number): string =>
    currency === defaultCurrency ? "primary" : index === 1 ? "accent" : "neutral";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      {summaries.length > 1 ? (
        <IconButton
          aria-label={t("balance.previous")}
          onClick={() => scrollByCard(-1)}
          sx={{ display: { xs: "none", sm: "inline-flex" }, flex: "none" }}
        >
          <ChevronLeftIcon />
        </IconButton>
      ) : null}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          ref={scrollerRef}
          onScroll={handleScroll}
          role="group"
          aria-label={t("balance.title")}
          sx={{
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          justifyContent: { xs: "flex-start", md: "safe center" },
          pb: 0.5,
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {summaries.map((summary, index) => {
          const variant = variantOf(summary.currency, index);
          const branded = variant !== "neutral";
          return (
            <Box
              key={summary.currency}
              component="article"
              data-currency={summary.currency}
              data-variant={variant}
              aria-label={t("balance.cardLabel", { currency: summary.currency })}
              sx={(theme) => ({
                minWidth: { xs: 194, md: 340 },
                flex: { xs: "none", md: "0 1 430px" },
                scrollSnapAlign: "start",
                borderRadius: "20px",
                border: "1px solid",
                borderColor: branded ? "transparent" : "divider",
                p: { xs: 1.25, md: 2 },
                boxShadow: "0 14px 34px -20px rgb(30 20 60 / 0.22)",
                ...(variant === "primary" && {
                  background:
                    "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #9333ea 100%)",
                  color: "#ffffff",
                }),
                ...(variant === "accent" && {
                  background:
                    "linear-gradient(135deg, #0f9c72 0%, #2cc795 55%, #3dd68c 100%)",
                  color: "#053220",
                }),
                ...(variant === "neutral" && {
                  bgcolor: "background.paper",
                }),
                "& .muted": {
                  color: branded ? "currentColor" : theme.palette.text.secondary,
                  opacity: branded ? 0.75 : 1,
                },
              })}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  mb: 0.5,
                }}
              >
                <Chip
                  size="small"
                  label={summary.currency}
                  sx={(theme) => ({
                    fontWeight: 800,
                    letterSpacing: "0.07em",
                    bgcolor: branded
                      ? "rgb(255 255 255 / 0.22)"
                      : alpha(theme.palette.primary.main, 0.1),
                    color: "inherit",
                  })}
                />
                <Typography className="muted" variant="caption" noWrap>
                  {accountNames(summary.currency)}
                </Typography>
              </Box>
              <Typography
                className="muted"
                variant="caption"
                sx={{ display: "block", textTransform: "uppercase", fontWeight: 700 }}
              >
                {t("balance.current")}
              </Typography>
              <Typography
                component="div"
                sx={{ fontSize: { xs: 16, md: 20 }, fontWeight: 800 }}
              >
                <AmountText
                  amount={minorToDecimalString(
                    summary.balanceMinor,
                    exponentOf(summary.currency),
                  )}
                  currency={summary.currency}
                  exponent={exponentOf(summary.currency)}
                />
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  gap: 2,
                  mt: 0.75,
                  pt: 0.75,
                  borderTop: "1px dashed",
                  borderColor: branded ? "rgb(255 255 255 / 0.35)" : "divider",
                }}
              >
                <Box>
                  <Typography
                    className="muted"
                    variant="caption"
                    sx={{ display: "block" }}
                  >
                    {t("balance.income")}
                  </Typography>
                  <Typography
                    component="div"
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color: branded ? "inherit" : "success.main",
                    }}
                  >
                    <AmountText
                      amount={minorToDecimalString(
                        summary.incomeMinor,
                        exponentOf(summary.currency),
                      )}
                      currency={summary.currency}
                      exponent={exponentOf(summary.currency)}
                    />
                  </Typography>
                </Box>
                <Box>
                  <Typography
                    className="muted"
                    variant="caption"
                    sx={{ display: "block" }}
                  >
                    {t("balance.expenses")}
                  </Typography>
                  <Typography
                    component="div"
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color: branded ? "inherit" : "error.main",
                    }}
                  >
                    <AmountText
                      amount={minorToDecimalString(
                        summary.expenseMinor,
                        exponentOf(summary.currency),
                      )}
                      currency={summary.currency}
                      exponent={exponentOf(summary.currency)}
                    />
                  </Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
        {summaries.length > 0 ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              gap: 0.75,
              mt: 0.75,
            }}
          >
            {summaries.map((summary, index) => (
              <Box
                key={summary.currency}
                component="button"
                type="button"
                aria-label={t("balance.dotLabel", { currency: summary.currency })}
                data-part="carousel-dot"
                data-active={index === activeIndex ? "true" : "false"}
                onClick={() => scrollToCard(index)}
                sx={(theme) => ({
                  width: 18,
                  height: 6,
                  p: 0,
                  border: 0,
                  cursor: "pointer",
                  borderRadius: "999px",
                  bgcolor:
                    index === activeIndex
                      ? theme.palette.primary.main
                      : theme.palette.divider,
                })}
              />
            ))}
          </Box>
        ) : null}
      </Box>
      {summaries.length > 1 ? (
        <IconButton
          aria-label={t("balance.next")}
          onClick={() => scrollByCard(1)}
          sx={{ display: { xs: "none", sm: "inline-flex" }, flex: "none" }}
        >
          <ChevronRightIcon />
        </IconButton>
      ) : null}
    </Box>
  );
}
