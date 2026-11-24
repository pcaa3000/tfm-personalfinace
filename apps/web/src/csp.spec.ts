import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Receipt previews use `URL.createObjectURL(file)` (ReceiptFlow) and
 * the authenticated viewer does the same (ReceiptImageViewer). The
 * production CSP must allow `blob:` in img-src or every preview shows
 * the "image unavailable" icon — prod-only, because dev serves no CSP.
 *
 * The policy lives in two places that MUST stay in sync:
 *  - `public/_headers` (Netlify real header)
 *  - `vite.config.ts` `CSP_CONTENT` (injected <meta> on build)
 */

const repoRoot = join(__dirname, "..");

const headerPolicy = readFileSync(
  join(repoRoot, "public/_headers"),
  "utf8",
);
const viteConfig = readFileSync(join(repoRoot, "vite.config.ts"), "utf8");

const imgSrcDirective = (text: string): string | null => {
  const match = text.match(/img-src[^;]*/);
  return match ? match[0] : null;
};

describe("production CSP img-src", () => {
  it("public/_headers allows blob: previews", () => {
    const directive = imgSrcDirective(headerPolicy);
    expect(directive).not.toBeNull();
    expect(directive).toContain("blob:");
  });

  it("vite.config.ts CSP_CONTENT allows blob: previews", () => {
    const directive = imgSrcDirective(viteConfig);
    expect(directive).not.toBeNull();
    expect(directive).toContain("blob:");
  });

  it("both policies declare the same img-src directive", () => {
    expect(imgSrcDirective(headerPolicy)?.replace(/\s+/g, " ").trim()).toBe(
      imgSrcDirective(viteConfig)?.replace(/\s+/g, " ").trim(),
    );
  });
});
