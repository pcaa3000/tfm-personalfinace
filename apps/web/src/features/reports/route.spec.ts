// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  currentAppRoute,
  navigateToPanel,
  navigateToReports,
  useAppRoute,
} from "./route";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("hash route (reports-monthly T7, S7)", () => {
  it("resolves 'panel' for the empty and '#/' hashes", () => {
    window.location.hash = "";
    expect(currentAppRoute()).toBe("panel");
    window.location.hash = "#/";
    expect(currentAppRoute()).toBe("panel");
  });

  it("resolves 'reports' for '#/reports' and navigates both ways", () => {
    navigateToReports();
    expect(window.location.hash).toBe("#/reports");
    expect(currentAppRoute()).toBe("reports");

    navigateToPanel();
    expect(currentAppRoute()).toBe("panel");
  });

  it("useAppRoute re-renders on hashchange", async () => {
    const { result } = renderHook(() => useAppRoute());
    expect(result.current).toBe("panel");

    await act(async () => {
      navigateToReports();
      // jsdom fires hashchange asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBe("reports");
  });
});
