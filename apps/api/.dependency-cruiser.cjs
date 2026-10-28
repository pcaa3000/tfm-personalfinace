/** Clean Architecture guardrails: domain/application stay framework-free. */
module.exports = {
  forbidden: [
    {
      name: "no-external-deps-in-core",
      comment:
        "domain/ and application/ must not depend on npm packages (NestJS, Prisma, express, node builtins).",
      severity: "error",
      from: { path: "src/modules/[^/]+/(domain|application)/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "core"],
      },
    },
    {
      name: "no-cross-module-internals",
      comment:
        "A module may only consume another module through its public index.ts barrel.",
      severity: "error",
      from: { path: "src/modules/([^/]+)/" },
      to: { path: "src/modules/(?!$1)[^/]+/(?!index\\.ts$)" },
    },
    {
      name: "no-infra-imports-from-domain",
      comment: "domain/ must not import application/ or infrastructure/.",
      severity: "error",
      from: { path: "src/modules/[^/]+/domain/" },
      to: { path: "src/modules/[^/]+/(application|infrastructure|composition)/" },
    },
    {
      name: "no-infra-imports-from-application",
      comment:
        "application/ must not import infrastructure/ or composition/ (ports are injected).",
      severity: "error",
      from: { path: "src/modules/[^/]+/application/" },
      to: { path: "src/modules/[^/]+/(infrastructure|composition)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
