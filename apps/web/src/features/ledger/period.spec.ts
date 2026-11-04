import { describe, expect, it } from "vitest";

import { currentMonthRange } from "./period";

describe("currentMonthRange (S12-5: month in progress by default)", () => {
  it("returns the first and last day of the current month", () => {
    expect(currentMonthRange(new Date(2026, 10, 15))).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("handles month lengths and year boundaries", () => {
    expect(currentMonthRange(new Date(2026, 1, 10))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    // 2024 is a leap year
    expect(currentMonthRange(new Date(2024, 1, 10)).to).toBe("2024-02-29");
    expect(currentMonthRange(new Date(2026, 11, 31))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(currentMonthRange(new Date(2026, 0, 5))).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
});
