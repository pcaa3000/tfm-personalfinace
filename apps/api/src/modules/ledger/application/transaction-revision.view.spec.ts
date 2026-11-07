import { describe, expect, it } from "vitest";

import {
  TransactionRevision,
  type FieldChange,
  type RevisionKind,
} from "../domain/transaction-revision.js";
import { toTransactionRevisionView } from "./transaction-revision.view.js";

const changes: FieldChange[] = [
  { field: "concept", previous: "Grocery run", next: "Weekly groceries" },
  { field: "amount", previous: "20.00", next: "25.50" },
];

function revision(kind: RevisionKind, occurredAt: Date): TransactionRevision {
  return new TransactionRevision(
    "trx-1-rev-1",
    "trx-1",
    1,
    kind,
    changes,
    occurredAt,
    "subject-1",
  );
}

describe("toTransactionRevisionView", () => {
  it("maps every revision field to the flat view", () => {
    const view = toTransactionRevisionView(
      revision("revision", new Date("2026-10-28T12:34:56.789Z")),
    );

    expect(view).toEqual({
      id: "trx-1-rev-1",
      transactionId: "trx-1",
      revisionNumber: 1,
      kind: "revision",
      changes,
      occurredAt: "2026-10-28T12:34:56.789Z",
      actor: "subject-1",
    });
  });

  it("serializes occurredAt as a UTC ISO instant", () => {
    const view = toTransactionRevisionView(
      revision("revision", new Date("2026-10-28T14:00:00+02:00")),
    );

    expect(view.occurredAt).toBe("2026-10-28T12:00:00.000Z");
  });

  it("passes changes through by reference and keeps the void kind", () => {
    const view = toTransactionRevisionView(
      revision("void", new Date("2026-10-29T09:30:00Z")),
    );

    expect(view.kind).toBe("void");
    expect(view.changes).toBe(changes);
  });
});
