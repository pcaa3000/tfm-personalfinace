import { DomainError } from "./domain-error.js";
import { err, ok, type Result } from "./result.js";

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The local day a transaction belongs to, interpreted in an IANA timezone.
 * Technical instants (UTC) are a separate concept and never reinterpret it.
 */
export class BusinessDate {
  private constructor(
    readonly isoDate: string,
    readonly timezone: string,
  ) {}

  static create(isoDate: string, timezone: string): Result<BusinessDate, DomainError> {
    const tzError = BusinessDate.validateTimezone(timezone);
    if (tzError) {
      return err(tzError);
    }

    const match = ISO_DAY_PATTERN.exec(isoDate);
    if (!match) {
      return err(
        new DomainError(
          "BUSINESS_DATE_INVALID",
          `Business day must be YYYY-MM-DD, got: ${JSON.stringify(isoDate)}`,
        ),
      );
    }

    const [, year, month, day] = match;
    const candidate = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    const isRealDay =
      candidate.getUTCFullYear() === Number(year) &&
      candidate.getUTCMonth() === Number(month) - 1 &&
      candidate.getUTCDate() === Number(day);
    if (!isRealDay) {
      return err(
        new DomainError(
          "BUSINESS_DATE_INVALID",
          `Business day is not a real calendar day: ${isoDate}`,
        ),
      );
    }

    return ok(new BusinessDate(isoDate, timezone));
  }

  private static validateTimezone(timezone: string): DomainError | null {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return null;
    } catch {
      return new DomainError(
        "TIMEZONE_INVALID",
        `Not a valid IANA timezone: ${JSON.stringify(timezone)}`,
      );
    }
  }

  equals(other: BusinessDate): boolean {
    return this.isoDate === other.isoDate && this.timezone === other.timezone;
  }

  toString(): string {
    return `${this.isoDate}@${this.timezone}`;
  }
}
