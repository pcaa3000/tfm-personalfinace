import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * S3 (security-prelaunch): the CSP is served as a real header via
 * `public/_headers`; this plugin injects the same policy as a
 * `<meta http-equiv>` fallback into index.html — but ONLY on
 * `vite build` (`apply: "build"`). In dev the meta would block Vite's
 * inline react-refresh preamble (`script-src 'self'`), so the dev
 * transform intentionally emits no CSP. Keep the policy string in sync
 * with `public/_headers`.
 */
const CSP_CONTENT =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self' https://*.supabase.co " +
  "wss://*.supabase.co http://localhost:3000";

function cspMetaTag(): Plugin {
  return {
    name: "tfm-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: CSP_CONTENT,
          },
          injectTo: "head",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [
    cspMetaTag(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Personal Finance",
        short_name: "Finance",
        description: "Personal finance ledger — offline-first PWA",
        theme_color: "#1976d2",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
