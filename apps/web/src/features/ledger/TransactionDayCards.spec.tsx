// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { TransactionDayCards } from "./TransactionDayCards";

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(cleanup);

describe("TransactionDayCards empty state (S1)", () => {
  it("offers a CTA that invokes onNewMovement", () => {
    const onNewMovement = vi.fn();
    render(
      <TransactionDayCards
        transactions={[]}
        categories={[]}
        accounts={[]}
        onEdit={vi.fn()}
        onVoid={vi.fn()}
        onHistory={vi.fn()}
        onNewMovement={onNewMovement}
      />,
    );
    expect(screen.getByText("Todavía no hay movimientos.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrá tu primer movimiento" }),
    );
    expect(onNewMovement).toHaveBeenCalledTimes(1);
  });
});
