import { ListItem, ListItemText, Stack } from "@mui/material";
import type { ReactNode } from "react";

interface Props {
  primary: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
}

/**
 * Management-list row (L26): on mobile the actions drop below the text
 * so long names never overlap buttons — `secondaryAction` only reserves
 * an icon's width and overflows with real buttons. From `sm` up it is a
 * single row with the actions pushed to the end.
 */
export function ManageListItem({ primary, secondary, actions }: Props) {
  return (
    <ListItem
      disableGutters
      data-testid="manage-row"
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "stretch", sm: "center" },
        gap: { xs: 0.5, sm: 1 },
      }}
    >
      <ListItemText
        primary={primary}
        secondary={secondary}
        sx={{ flex: 1, minWidth: 0, m: 0 }}
      />
      {actions ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexShrink: 0, justifyContent: { xs: "flex-start", sm: "flex-end" } }}
        >
          {actions}
        </Stack>
      ) : null}
    </ListItem>
  );
}
