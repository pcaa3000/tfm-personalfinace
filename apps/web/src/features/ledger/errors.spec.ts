import { beforeAll, describe, expect, it } from "vitest";

import i18n from "../../i18n";
import { ApiError } from "./api";
import { errorMessage } from "./errors";

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

describe("errorMessage", () => {
  it("maps a known api error code to the spanish message", () => {
    const error = new ApiError("TRANSACTION_ALREADY_VOIDED", "voided", 400);
    expect(errorMessage(error, i18n.t)).toBe("El movimiento ya está anulado.");
  });

  it("maps an unknown api code to the generic message", () => {
    const error = new ApiError("SOME_FUTURE_CODE", "raw english", 400);
    expect(errorMessage(error, i18n.t)).toBe(
      "No se pudo completar la operación. Intentá de nuevo.",
    );
  });

  it("maps non-api errors to the generic message", () => {
    expect(errorMessage(new TypeError("fetch failed"), i18n.t)).toBe(
      "No se pudo completar la operación. Intentá de nuevo.",
    );
  });

  it("renders the english message when the locale is en", async () => {
    await i18n.changeLanguage("en");
    const error = new ApiError("CATEGORY_NOT_FOUND", "missing", 404);
    expect(errorMessage(error, i18n.t)).toBe("The category does not exist.");
    await i18n.changeLanguage("es");
  });
});
