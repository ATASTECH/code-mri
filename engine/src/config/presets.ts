import yaml from "js-yaml";
import type { CodeMriConfig } from "./codemri.js";

export const CODE_MRI_PRESET_NAMES = [
  "next",
  "next-django",
  "vite-react",
  "node-api",
  "python-api",
  "library",
] as const;

export type CodeMriPresetName = (typeof CODE_MRI_PRESET_NAMES)[number];

const COMMON_RISK_IGNORES = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "examples/**",
  "fixtures/**",
  "dist/**",
  "build/**",
  ".next/**",
  "coverage/**",
];

function baseConfig(): CodeMriConfig {
  return {
    boundaries: { groups: [], rules: [] },
    publicApi: { exports: [] },
    ci: {
      gates: {
        minHealth: 80,
        maxNewIssues: 0,
        forbidBreakingChanges: true,
        forbidBoundaryViolations: true,
      },
    },
    risk: { ignorePaths: COMMON_RISK_IGNORES },
  };
}

export function createCodeMriPresetConfig(name: CodeMriPresetName): CodeMriConfig {
  const config = baseConfig();

  if (name === "next") {
    config.boundaries.groups = [
      { id: "app", paths: ["app/**", "pages/**", "src/app/**", "src/pages/**"] },
      { id: "components", paths: ["components/**", "src/components/**"] },
      { id: "server", paths: ["server/**", "src/server/**", "lib/server/**", "src/lib/server/**"] },
    ];
    config.boundaries.rules = [
      { from: ["components"], to: ["server"], allow: false, edgeKinds: ["IMPORTS"] },
    ];
    config.publicApi.exports = [
      { paths: ["components/ui/**", "src/components/ui/**"], kinds: ["Component"] },
    ];
  } else if (name === "next-django") {
    config.boundaries.groups = [
      { id: "frontend", paths: ["frontend/**", "apps/web/**", "app/**", "pages/**", "src/**"] },
      { id: "backend", paths: ["backend/**", "apps/api/**", "source/**"] },
    ];
    config.boundaries.rules = [
      { from: ["frontend"], to: ["backend"], allow: false, edgeKinds: ["IMPORTS"] },
    ];
    config.publicApi.exports = [
      { paths: ["frontend/components/ui/**", "apps/web/components/ui/**"], kinds: ["Component"] },
      { paths: ["backend/**/urls.py", "backend/**/views.py"] },
    ];
  } else if (name === "vite-react") {
    config.boundaries.groups = [
      { id: "routes", paths: ["src/routes/**", "src/pages/**"] },
      { id: "components", paths: ["src/components/**"] },
      { id: "data", paths: ["src/api/**", "src/services/**", "src/lib/**"] },
    ];
    config.publicApi.exports = [
      { paths: ["src/components/ui/**"], kinds: ["Component"] },
    ];
  } else if (name === "node-api") {
    config.boundaries.groups = [
      { id: "routes", paths: ["src/routes/**", "routes/**"] },
      { id: "services", paths: ["src/services/**", "services/**"] },
      { id: "data", paths: ["src/db/**", "src/repositories/**", "db/**"] },
    ];
    config.boundaries.rules = [
      { from: ["routes"], to: ["data"], allow: false, edgeKinds: ["IMPORTS", "CALLS"] },
    ];
  } else if (name === "python-api") {
    config.boundaries.groups = [
      { id: "api", paths: ["**/views.py", "**/urls.py", "**/routers.py", "**/main.py"] },
      { id: "models", paths: ["**/models.py", "**/schemas.py"] },
      { id: "services", paths: ["**/services/**", "**/tasks.py"] },
    ];
  } else if (name === "library") {
    config.publicApi.exports = [
      { paths: ["src/index.ts", "src/index.tsx", "index.ts"], kinds: ["Function", "Type", "Component", "Hook"] },
    ];
    config.risk.ignorePaths = [...COMMON_RISK_IGNORES, "demo/**", "playground/**"];
  }

  return config;
}

export function formatCodeMriConfig(config: CodeMriConfig): string {
  return yaml.dump(
    {
      boundaries: config.boundaries,
      publicApi: config.publicApi,
      ci: config.ci,
      risk: config.risk,
    },
    { lineWidth: 100 },
  );
}
