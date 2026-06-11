import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { EdgeKind, NodeKind } from "../types.js";

export const CONFIG_FILE_NAMES = [".codemri.yml", ".codemri.yaml", ".codemri.json"];

const EDGE_KINDS = new Set<EdgeKind>([
  "IMPORTS",
  "EXPORTS",
  "USES",
  "CALLS",
  "RENDERS",
  "EXPOSES",
  "DEPENDS_ON",
  "REFERENCES",
  "REGISTERED_IN",
  "TYPES",
  "PROVIDES",
  "CONSUMES",
]);

const NODE_KINDS = new Set<NodeKind>([
  "File",
  "Directory",
  "Function",
  "Class",
  "Type",
  "Context",
  "Component",
  "Hook",
  "Page",
  "Service",
  "Model",
  "Field",
  "Serializer",
  "View",
  "ViewSet",
  "Route",
  "APIEndpoint",
  "DatabaseTable",
  "DockerService",
  "EnvVariable",
  "CeleryTask",
  "Manager",
  "Signal",
]);

export interface BoundaryGroupConfig {
  id: string;
  paths: string[];
  description?: string;
}

export interface BoundaryRuleConfig {
  from: string[];
  to: string[];
  allow: boolean;
  edgeKinds?: EdgeKind[];
  message?: string;
}

export interface BoundaryConfig {
  groups: BoundaryGroupConfig[];
  rules: BoundaryRuleConfig[];
}

export interface PublicApiExportConfig {
  ids?: string[];
  paths?: string[];
  names?: string[];
  kinds?: NodeKind[];
}

export interface PublicApiConfig {
  exports: PublicApiExportConfig[];
}

export interface CiGateConfig {
  minHealth?: number;
  maxNewIssues?: number;
  forbidBreakingChanges?: boolean;
  forbidBoundaryViolations?: boolean;
  minCoveragePct?: number;
}

export interface CiConfig {
  gates: CiGateConfig;
}

export interface RiskConfig {
  ignorePaths: string[];
}

export interface CodeMriConfig {
  sourcePath?: string;
  boundaries: BoundaryConfig;
  publicApi: PublicApiConfig;
  ci: CiConfig;
  risk: RiskConfig;
}

export interface LoadCodeMriConfigOptions {
  root?: string;
  roots?: string[];
  configPath?: string;
}

export const EMPTY_CODE_MRI_CONFIG: CodeMriConfig = {
  boundaries: { groups: [], rules: [] },
  publicApi: { exports: [] },
  ci: { gates: {} },
  risk: { ignorePaths: [] },
};

function emptyConfig(sourcePath?: string): CodeMriConfig {
  const config: CodeMriConfig = {
    boundaries: { groups: [], rules: [] },
    publicApi: { exports: [] },
    ci: { gates: {} },
    risk: { ignorePaths: [] },
  };
  if (sourcePath) config.sourcePath = sourcePath;
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error(`Invalid .codemri.yml: ${field} must be a string or string array`);
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  return stringArray(value, field);
}

function edgeKindArray(value: unknown, field: string): EdgeKind[] | undefined {
  const raw = optionalStringArray(value, field);
  if (!raw) return undefined;
  for (const kind of raw) {
    if (!EDGE_KINDS.has(kind as EdgeKind)) {
      throw new Error(`Invalid .codemri.yml: ${field} contains unknown edge kind "${kind}"`);
    }
  }
  return raw as EdgeKind[];
}

function nodeKindArray(value: unknown, field: string): NodeKind[] | undefined {
  const raw = optionalStringArray(value, field);
  if (!raw) return undefined;
  for (const kind of raw) {
    if (!NODE_KINDS.has(kind as NodeKind)) {
      throw new Error(`Invalid .codemri.yml: ${field} contains unknown node kind "${kind}"`);
    }
  }
  return raw as NodeKind[];
}

function normalizeBoundaryGroups(value: unknown): BoundaryGroupConfig[] {
  if (value === undefined) return [];

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (!isRecord(item) || typeof item.id !== "string") {
        throw new Error(`Invalid .codemri.yml: boundaries.groups[${index}].id is required`);
      }
      const group: BoundaryGroupConfig = {
        id: item.id,
        paths: stringArray(item.paths ?? item.path, `boundaries.groups[${index}].paths`),
      };
      if (typeof item.description === "string") group.description = item.description;
      return group;
    });
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([id, item]) => {
      if (typeof item === "string" || Array.isArray(item)) {
        return { id, paths: stringArray(item, `boundaries.groups.${id}`) };
      }
      if (isRecord(item)) {
        const group: BoundaryGroupConfig = {
          id,
          paths: stringArray(item.paths ?? item.path, `boundaries.groups.${id}.paths`),
        };
        if (typeof item.description === "string") group.description = item.description;
        return group;
      }
      throw new Error(`Invalid .codemri.yml: boundaries.groups.${id} is invalid`);
    });
  }

  throw new Error("Invalid .codemri.yml: boundaries.groups must be an array or object");
}

function normalizeBoundaryRules(value: unknown): BoundaryRuleConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("Invalid .codemri.yml: boundaries.rules must be an array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid .codemri.yml: boundaries.rules[${index}] must be an object`);
    }
    const type = typeof item.type === "string" ? item.type : undefined;
    const allow =
      typeof item.allow === "boolean" ? item.allow : type === "allow" || type === "permit";
    const rule: BoundaryRuleConfig = {
      from: stringArray(item.from, `boundaries.rules[${index}].from`),
      to: stringArray(item.to, `boundaries.rules[${index}].to`),
      allow,
    };
    const edgeKinds = edgeKindArray(item.edgeKinds ?? item.edges, `boundaries.rules[${index}].edgeKinds`);
    if (edgeKinds) rule.edgeKinds = edgeKinds;
    if (typeof item.message === "string") rule.message = item.message;
    return rule;
  });
}

function splitPublicApiString(value: string): PublicApiExportConfig {
  const hash = value.lastIndexOf("#");
  if (hash > 0) {
    return { paths: [value.slice(0, hash)], names: [value.slice(hash + 1)] };
  }

  const prefix = value.slice(0, value.indexOf(":"));
  if (NODE_KINDS.has(prefix as NodeKind)) return { ids: [value] };

  return { paths: [value] };
}

function normalizePublicApiEntry(item: unknown, field: string): PublicApiExportConfig {
  if (typeof item === "string") return splitPublicApiString(item);
  if (!isRecord(item)) {
    throw new Error(`Invalid .codemri.yml: ${field} must be a string or object`);
  }

  const entry: PublicApiExportConfig = {};
  const ids = optionalStringArray(item.ids ?? item.id, `${field}.ids`);
  const paths = optionalStringArray(item.paths ?? item.path, `${field}.paths`);
  const names = optionalStringArray(item.names ?? item.name, `${field}.names`);
  const kinds = nodeKindArray(item.kinds ?? item.kind, `${field}.kinds`);
  if (ids) entry.ids = ids;
  if (paths) entry.paths = paths;
  if (names) entry.names = names;
  if (kinds) entry.kinds = kinds;
  if (!entry.ids && !entry.paths) {
    throw new Error(`Invalid .codemri.yml: ${field} requires ids or paths`);
  }
  return entry;
}

function normalizePublicApi(value: unknown): PublicApiConfig {
  if (value === undefined) return { exports: [] };
  if (Array.isArray(value)) {
    return { exports: value.map((item, index) => normalizePublicApiEntry(item, `publicApi[${index}]`)) };
  }
  if (!isRecord(value)) {
    throw new Error("Invalid .codemri.yml: publicApi must be an array or object");
  }

  const exportsValue = value.exports ?? value.exported;
  if (exportsValue === undefined) return { exports: [] };
  if (!Array.isArray(exportsValue)) {
    throw new Error("Invalid .codemri.yml: publicApi.exports must be an array");
  }
  return {
    exports: exportsValue.map((item, index) =>
      normalizePublicApiEntry(item, `publicApi.exports[${index}]`),
    ),
  };
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`Invalid .codemri.yml: ${field} must be a finite number`);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new Error(`Invalid .codemri.yml: ${field} must be a boolean`);
}

function normalizeCi(value: unknown): CiConfig {
  if (value === undefined) return { gates: {} };
  if (!isRecord(value)) {
    throw new Error("Invalid .codemri.yml: ci must be an object");
  }

  const gatesRaw = value.gates ?? value;
  if (!isRecord(gatesRaw)) {
    throw new Error("Invalid .codemri.yml: ci.gates must be an object");
  }

  const gates: CiGateConfig = {};
  const minHealth = optionalNumber(gatesRaw.minHealth, "ci.gates.minHealth");
  const maxNewIssues = optionalNumber(gatesRaw.maxNewIssues, "ci.gates.maxNewIssues");
  const minCoveragePct = optionalNumber(gatesRaw.minCoveragePct, "ci.gates.minCoveragePct");
  const forbidBreakingChanges = optionalBoolean(
    gatesRaw.forbidBreakingChanges,
    "ci.gates.forbidBreakingChanges",
  );
  const forbidBoundaryViolations = optionalBoolean(
    gatesRaw.forbidBoundaryViolations,
    "ci.gates.forbidBoundaryViolations",
  );

  if (minHealth !== undefined) gates.minHealth = minHealth;
  if (maxNewIssues !== undefined) gates.maxNewIssues = maxNewIssues;
  if (minCoveragePct !== undefined) gates.minCoveragePct = minCoveragePct;
  if (forbidBreakingChanges !== undefined) gates.forbidBreakingChanges = forbidBreakingChanges;
  if (forbidBoundaryViolations !== undefined) {
    gates.forbidBoundaryViolations = forbidBoundaryViolations;
  }

  return { gates };
}

function normalizeRisk(value: unknown): RiskConfig {
  if (value === undefined) return { ignorePaths: [] };
  if (!isRecord(value)) {
    throw new Error("Invalid .codemri.yml: risk must be an object");
  }

  return {
    ignorePaths: optionalStringArray(value.ignorePaths ?? value.ignore, "risk.ignorePaths") ?? [],
  };
}

export function parseCodeMriConfig(raw: unknown, sourcePath?: string): CodeMriConfig {
  if (raw === undefined || raw === null) return emptyConfig(sourcePath);
  if (!isRecord(raw)) throw new Error("Invalid .codemri.yml: top-level value must be an object");

  const boundariesRaw = raw.boundaries;
  const boundaries = isRecord(boundariesRaw)
    ? {
        groups: normalizeBoundaryGroups(boundariesRaw.groups),
        rules: normalizeBoundaryRules(boundariesRaw.rules),
      }
    : { groups: [], rules: [] };

  if (boundariesRaw !== undefined && !isRecord(boundariesRaw)) {
    throw new Error("Invalid .codemri.yml: boundaries must be an object");
  }

  const config: CodeMriConfig = {
    boundaries,
    publicApi: normalizePublicApi(raw.publicApi),
    ci: normalizeCi(raw.ci ?? raw.gates),
    risk: normalizeRisk(raw.risk),
  };
  if (sourcePath) config.sourcePath = sourcePath;
  return config;
}

function parseConfigFile(file: string): CodeMriConfig {
  const text = readFileSync(file, "utf8");
  const raw = file.endsWith(".json") ? JSON.parse(text) : yaml.load(text);
  return parseCodeMriConfig(raw, file);
}

function parentDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

function discoverConfig(start: string): string | null {
  for (const dir of parentDirs(start)) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function commonAncestor(paths: string[]): string {
  const [first, ...rest] = paths.map((item) => path.resolve(item).split(path.sep).filter(Boolean));
  if (!first) return process.cwd();

  const shared = [...first];
  for (const parts of rest) {
    let i = 0;
    while (i < shared.length && shared[i] === parts[i]) i += 1;
    shared.length = i;
  }

  const prefix = path.isAbsolute(paths[0] ?? "") ? path.sep : "";
  return prefix + shared.join(path.sep);
}

export function loadCodeMriConfig(options: LoadCodeMriConfigOptions = {}): CodeMriConfig {
  if (options.configPath) {
    const explicit = path.resolve(options.configPath);
    if (!existsSync(explicit)) throw new Error(`Code MRI config not found: ${explicit}`);
    return parseConfigFile(explicit);
  }

  const roots = options.roots?.length ? options.roots : [options.root ?? process.cwd()];
  const starts = [...new Set([commonAncestor(roots), ...roots].map((item) => path.resolve(item)))];
  for (const start of starts) {
    const discovered = discoverConfig(start);
    if (discovered) return parseConfigFile(discovered);
  }

  return emptyConfig();
}
