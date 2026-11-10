import { Box } from "@mui/material";

/** Brand mark: violet gradient chip shared by topbar, sidebar and login. */
export function BrandMark() {
  return (
    <Box
      aria-hidden
      sx={{
        width: 34,
        height: 34,
        borderRadius: "12px",
        flex: "none",
        background:
          "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #9333ea 100%)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontSize: 12.5,
        letterSpacing: "0.02em",
        boxShadow: "0 8px 18px -8px rgb(111 45 244 / 0.6)",
      }}
    >
      TF
    </Box>
  );
}
