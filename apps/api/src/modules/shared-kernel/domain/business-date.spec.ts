import { describe, expect, it } from "vitest";

import { BusinessDate } from "./business-date.js";

describe("BusinessDate", () => {
  it("accepts an ISO day and an IANA timezone", () => {
    const result = BusinessDate.create("2026-10-27", "America/Argentina/Buenos_Aires");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isoDate).toBe("2026-10-27");
      expect(result.value.timezone).toBe("America/Argentina/Buenos_Aires");
      expect(result.value.toString()).toBe("2026-10-27@America/Argentina/Buenos_Aires");
    }
  });

  it.each(["27/10/2026", "2026-13-01", "2026-02-30", "2026-1-1", "yesterday", ""])(
    "rejects malformed day %j",
    (raw) => {
      const result = BusinessDate.create(raw, "UTC");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("BUSINESS_DATE_INVALID");
      }
    },
  );

  it.each(["Mars/Olympus", "GMT+25", "not a zone", ""])(
    "rejects invalid timezone %j",
    (tz) => {
      const result = BusinessDate.create("2026-10-27", tz);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TIMEZONE_INVALID");
      }
    },
  );

  it("compares equality on day and timezone", () => {
    const a = BusinessDate.create("2026-10-27", "UTC");
    const same = BusinessDate.create("2026-10-27", "UTC");
    const otherDay = BusinessDate.create("2026-10-28", "UTC");
    const otherTz = BusinessDate.create("2026-10-27", "Europe/Madrid");

    if (!a.ok || !same.ok || !otherDay.ok || !otherTz.ok) throw new Error("setup failed");

    expect(a.value.equals(same.value)).toBe(true);
    expect(a.value.equals(otherDay.value)).toBe(false);
    expect(a.value.equals(otherTz.value)).toBe(false);
  });
});
