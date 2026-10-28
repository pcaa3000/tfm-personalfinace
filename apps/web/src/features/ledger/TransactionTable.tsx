import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import type { TransactionView } from "./types";

interface Props {
  transactions: TransactionView[];
  categoryLabels: Map<string, string>;
}

export function TransactionTable({ transactions, categoryLabels }: Props) {
  if (transactions.length === 0) {
    return <Typography color="text.secondary">No transactions yet.</Typography>;
  }

  return (
    <Table size="small" aria-label="Transactions">
      <TableHead>
        <TableRow>
          <TableCell>Date</TableCell>
          <TableCell>Type</TableCell>
          <TableCell>Concept</TableCell>
          <TableCell>Category</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Amount</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {transactions.map((trx) => (
          <TableRow key={trx.id}>
            <TableCell>{trx.businessDate}</TableCell>
            <TableCell>{trx.type}</TableCell>
            <TableCell>{trx.concept}</TableCell>
            <TableCell>
              {trx.categoryId
                ? (categoryLabels.get(trx.categoryId) ?? trx.categoryId)
                : "Uncategorized"}
            </TableCell>
            <TableCell>{trx.status}</TableCell>
            <TableCell align="right">
              {trx.amount} {trx.currency}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
