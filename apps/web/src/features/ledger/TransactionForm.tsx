import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import type { CategoryView, CreateTransactionInput } from "./types";

const schema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z
    .string()
    .min(1, "Amount is required")
    .regex(/^\d+(\.\d+)?$/, "Amount must be a positive decimal"),
  currency: z.string().length(3),
  businessDate: z.string().min(10, "Date is required"),
  concept: z.string().trim().min(1, "Concept is required").max(500),
  categoryId: z.string().nullable(),
});

type FormValues = z.infer<typeof schema>;

const CURRENCIES = ["USD", "EUR", "ARS", "JPY", "BHD"];

interface Props {
  categories: CategoryView[];
  submitting: boolean;
  error: string | null;
  onSubmit: (input: CreateTransactionInput) => void;
}

export function TransactionForm({ categories, submitting, error, onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "expense",
      amount: "",
      currency: "USD",
      businessDate: new Date().toISOString().slice(0, 10),
      concept: "",
      categoryId: null,
    },
  });

  const submit = handleSubmit((values) => {
    onSubmit({
      ...values,
      categoryId: values.categoryId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      idempotencyKey: crypto.randomUUID(),
    });
    reset();
  });

  return (
    <form onSubmit={submit} aria-label="Register transaction">
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Type" fullWidth>
              <MenuItem value="income">Income</MenuItem>
              <MenuItem value="expense">Expense</MenuItem>
            </TextField>
          )}
        />
        <TextField
          {...register("amount")}
          label="Amount"
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
          error={Boolean(errors.amount)}
          helperText={errors.amount?.message}
          fullWidth
        />
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Currency" fullWidth>
              {CURRENCIES.map((code) => (
                <MenuItem key={code} value={code}>
                  {code}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
        <TextField
          {...register("businessDate")}
          label="Date"
          type="date"
          slotProps={{ inputLabel: { shrink: true } }}
          error={Boolean(errors.businessDate)}
          helperText={errors.businessDate?.message}
          fullWidth
        />
        <TextField
          {...register("concept")}
          label="Concept"
          error={Boolean(errors.concept)}
          helperText={errors.concept?.message}
          fullWidth
        />
        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              label="Category"
              value={field.value ?? ""}
              onChange={(event) =>
                field.onChange(event.target.value === "" ? null : event.target.value)
              }
              fullWidth
            >
              <MenuItem value="">Uncategorized</MenuItem>
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.label}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? "Saving…" : "Save transaction"}
        </Button>
      </Stack>
    </form>
  );
}
