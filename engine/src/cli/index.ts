#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { ProjectRepoRole, Report } from "../types.js";
import { askGraph, createAgentQueryContext, reviewDiff } from "../agent/index.js";
import { evaluateCiGates, formatCiMarkdown, formatSarif } from "../ci/index.js";
import { loadCodeMriConfig } from "../config/codemri.js";
import {
  CODE_MRI_PRESET_NAMES,
  createCodeMriPresetConfig,
  formatCodeMriConfig,
  type CodeMriPresetName,
} from "../config/presets.js";
import { formatBoundarySuggestion } from "../config/suggest.js";
import { diffReports } from "../diff/reportDiff.js";
import { startMcpServer } from "../mcp/server.js";
import { analyzeProject } from "../pipeline/analyze.js";
import { analyzeProjectRepos, type ProjectRepoInput } from "../pipeline/analyzeRepos.js";
import { progressEvent, type ScanProgressEvent } from "../progress.js";
import { formatCiSummary, formatDiffSummary, formatSummary } from "./format.js";

const program = new Command();
const REPO_ROLES = new Set<ProjectRepoRole>([
  "frontend",
  "backend",
  "fullstack",
  "worker",
  "other",
]);

function collectRepo(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseNameSpec(spec: string): [string, string] {
  const eq = spec.indexOf("=");
  if (eq === -1) {
    throw new Error(`Invalid --repo-name "${spec}". Use id=name.`);
  }

  const id = spec.slice(0, eq).trim();
  const name = spec.slice(eq + 1).trim();
  if (!id || !name) {
    throw new Error(`Invalid --repo-name "${spec}". Use id=name.`);
  }

  return [id, name];
}

function parseRepoSpec(spec: string): ProjectRepoInput {
  const eq = spec.indexOf("=");
  if (eq === -1) {
    throw new Error(`Invalid --repo "${spec}". Use id=/absolute/path[:role].`);
  }

  const id = spec.slice(0, eq).trim();
  let root = spec.slice(eq + 1).trim();
  let role: ProjectRepoRole = "other";
  const roleSep = root.lastIndexOf(":");
  if (roleSep > 0) {
    const maybeRole = root.slice(roleSep + 1) as ProjectRepoRole;
    if (REPO_ROLES.has(maybeRole)) {
      role = maybeRole;
      root = root.slice(0, roleSep);
    }
  }

  if (!id || !root) {
    throw new Error(`Invalid --repo "${spec}". Use id=/absolute/path[:role].`);
  }

  return {
    id,
    name: id,
    root: path.resolve(root),
    role,
  };
}

function writeProgress(event: ScanProgressEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function writeCiProgress(event: ScanProgressEvent): void {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

function readReport(file: string): Report {
  return JSON.parse(readFileSync(path.resolve(file), "utf8")) as Report;
}

function writeJson(file: string, value: unknown): void {
  const out = path.resolve(file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(value, null, 2));
}

function writeText(file: string, value: string): void {
  const out = path.resolve(file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, value);
}

function defaultBaselinePath(cacheDir?: string): string | null {
  return cacheDir ? path.join(path.resolve(cacheDir), "baseline-report.json") : null;
}

function baselineInputPath(opts: { baseline?: string; cacheDir?: string }): string | null {
  return opts.baseline ? path.resolve(opts.baseline) : defaultBaselinePath(opts.cacheDir);
}

function baselineOutputPath(opts: {
  baseline?: string;
  cacheDir?: string;
  updateBaseline?: string | boolean;
}): string | null {
  if (opts.updateBaseline === undefined) return null;
  if (typeof opts.updateBaseline === "string") return path.resolve(opts.updateBaseline);
  return baselineInputPath(opts) ?? path.resolve("code-mri-baseline.json");
}

program
  .name("code-mri")
  .description("Local-first codebase intelligence with UI, CI, and MCP tools");

program
  .command("scan")
  .argument("<path>", "path to the repository to scan")
  .option("--json <file>", "write the full report JSON to this file")
  .option("--openapi <file>", "OpenAPI JSON/YAML file to link frontend calls against")
  .option("--python <bin>", "python executable for the Django sidecar")
  .option("--coverage <file>", "lcov.info or Istanbul coverage JSON file")
  .option("--config <file>", ".codemri.yml governance config")
  .option("--no-git", "skip git churn collection")
  .option("--max-git-commits <n>", "maximum git commits to inspect for churn", "500")
  .option("--cache-dir <dir>", "persistent incremental cache directory")
  .option("--no-cache", "bypass any persistent incremental cache")
  .action(async (target: string, opts: { json?: string; openapi?: string; python?: string; coverage?: string; config?: string; git?: boolean; maxGitCommits?: string; cacheDir?: string; cache?: boolean }) => {
    const root = path.resolve(target);
    const { report } = await analyzeProject(root, {
      ...(opts.python ? { python: opts.python } : {}),
      ...(opts.openapi ? { openapi: path.resolve(opts.openapi) } : {}),
      ...(opts.coverage ? { coverage: path.resolve(opts.coverage) } : {}),
      ...(opts.config ? { configPath: path.resolve(opts.config) } : {}),
      git: opts.git,
      maxGitCommits: Number(opts.maxGitCommits),
      ...(opts.cache !== false && opts.cacheDir ? { incrementalDir: path.resolve(opts.cacheDir) } : {}),
    });

    process.stdout.write(`${formatSummary(report)}\n`);

    if (opts.json) {
      writeFileSync(opts.json, JSON.stringify(report, null, 2));
      process.stdout.write(`\nReport written to ${opts.json}\n`);
    }
  });

program
  .command("scan-project")
  .description("scan a logical project made of multiple local repositories")
  .requiredOption("--repo <spec>", "repo binding as id=/path[:role]", collectRepo, [])
  .option("--repo-name <spec>", "repo display name as id=name", collectRepo, [])
  .option("--name <name>", "logical project name", "Code MRI Project")
  .option("--json <file>", "write the full report JSON to this file")
  .option("--openapi <file>", "OpenAPI JSON/YAML file to link frontend calls against")
  .option("--python <bin>", "python executable for the Django sidecar")
  .option("--coverage <file>", "lcov.info or Istanbul coverage JSON file")
  .option("--config <file>", ".codemri.yml governance config")
  .option("--no-git", "skip git churn collection")
  .option("--max-git-commits <n>", "maximum git commits to inspect for churn", "500")
  .option("--cache-dir <dir>", "persistent incremental cache directory (per-repo)")
  .option("--no-cache", "bypass any persistent incremental cache")
  .option("--progress", "write JSONL progress events to stdout")
  .action(
    async (opts: {
      name: string;
      repo: string[];
      repoName: string[];
      json?: string;
      openapi?: string;
      python?: string;
      coverage?: string;
      config?: string;
      git?: boolean;
      maxGitCommits?: string;
      cacheDir?: string;
      cache?: boolean;
      progress?: boolean;
    }) => {
      const names = new Map(opts.repoName.map(parseNameSpec));
      const repos = opts.repo.map(parseRepoSpec);
      for (const repo of repos) {
        repo.name = names.get(repo.id) ?? repo.name;
      }
      const { report } = await analyzeProjectRepos(
        { projectName: opts.name, repos },
        {
          ...(opts.python ? { python: opts.python } : {}),
          ...(opts.openapi ? { openapi: path.resolve(opts.openapi) } : {}),
          ...(opts.coverage ? { coverage: path.resolve(opts.coverage) } : {}),
          ...(opts.config ? { configPath: path.resolve(opts.config) } : {}),
          git: opts.git,
          maxGitCommits: Number(opts.maxGitCommits),
          ...(opts.cache !== false && opts.cacheDir ? { incrementalDir: path.resolve(opts.cacheDir) } : {}),
          ...(opts.progress ? { progress: writeProgress } : {}),
        },
      );

      process.stdout.write(`${formatSummary(report)}\n`);

      if (opts.json) {
        writeFileSync(opts.json, JSON.stringify(report, null, 2));
        process.stdout.write(`\nReport written to ${opts.json}\n`);
      }
    },
  );

program
  .command("diff")
  .description("compare two Code MRI report JSON files")
  .argument("<before>", "older report JSON")
  .argument("<after>", "newer report JSON")
  .option("--json <file>", "write the full diff JSON to this file")
  .action((beforePath: string, afterPath: string, opts: { json?: string }) => {
    const before = JSON.parse(readFileSync(path.resolve(beforePath), "utf8")) as Report;
    const after = JSON.parse(readFileSync(path.resolve(afterPath), "utf8")) as Report;
    const diff = diffReports(before, after);

    process.stdout.write(`${formatDiffSummary(diff)}\n`);

    if (opts.json) {
      writeFileSync(opts.json, JSON.stringify(diff, null, 2));
      process.stdout.write(`\nDiff written to ${opts.json}\n`);
    }
  });

program
  .command("ci")
  .description("run a headless scan, compare against a baseline, and evaluate CI gates")
  .argument("[path]", "path to the repository to scan", ".")
  .option("--repo <spec>", "repo binding as id=/path[:role] for multi-repo projects", collectRepo, [])
  .option("--repo-name <spec>", "repo display name as id=name", collectRepo, [])
  .option("--name <name>", "logical project name", "Code MRI Project")
  .option("--baseline <file>", "previous report snapshot JSON")
  .option("--update-baseline [file]", "write the current report snapshot after evaluation")
  .option("--json <file>", "write the current report JSON")
  .option("--diff-json <file>", "write the report diff JSON when a baseline exists")
  .option("--markdown <file>", "write a PR-ready Markdown report")
  .option("--sarif <file>", "write SARIF v2.1.0 output for GitHub code scanning")
  .option("--openapi <file>", "OpenAPI JSON/YAML file to link frontend calls against")
  .option("--python <bin>", "python executable for the Django sidecar")
  .option("--coverage <file>", "lcov.info or Istanbul coverage JSON file")
  .option("--config <file>", ".codemri.yml governance config")
  .option("--no-git", "skip git churn collection")
  .option("--max-git-commits <n>", "maximum git commits to inspect for churn", "500")
  .option("--cache-dir <dir>", "persistent incremental cache directory")
  .option("--no-cache", "bypass any persistent incremental cache")
  .option("--progress", "write deterministic JSONL progress events to stderr")
  .action(
    async (
      target: string,
      opts: {
        repo: string[];
        repoName: string[];
        name: string;
        baseline?: string;
        updateBaseline?: string | boolean;
        json?: string;
        diffJson?: string;
        markdown?: string;
        sarif?: string;
        openapi?: string;
        python?: string;
        coverage?: string;
        config?: string;
        git?: boolean;
        maxGitCommits?: string;
        cacheDir?: string;
        cache?: boolean;
        progress?: boolean;
      },
    ) => {
      const configPath = opts.config ? path.resolve(opts.config) : undefined;
      const cacheDir = opts.cacheDir ? path.resolve(opts.cacheDir) : undefined;
      const parsedRepos = opts.repo.map(parseRepoSpec);
      const baselinePath = baselineInputPath({ baseline: opts.baseline, cacheDir });
      const progress = opts.progress ? writeCiProgress : undefined;
      progress?.(progressEvent({ phase: "ci", percent: 0, message: "Starting CI scan" }));

      const report =
        parsedRepos.length > 0
          ? await (async () => {
              const names = new Map(opts.repoName.map(parseNameSpec));
              for (const repo of parsedRepos) repo.name = names.get(repo.id) ?? repo.name;
              const { report } = await analyzeProjectRepos(
                { projectName: opts.name, repos: parsedRepos },
                {
                  ...(opts.python ? { python: opts.python } : {}),
                  ...(opts.openapi ? { openapi: path.resolve(opts.openapi) } : {}),
                  ...(opts.coverage ? { coverage: path.resolve(opts.coverage) } : {}),
                  ...(configPath ? { configPath } : {}),
                  git: opts.git,
                  maxGitCommits: Number(opts.maxGitCommits),
                  ...(opts.cache !== false && cacheDir ? { incrementalDir: cacheDir } : {}),
                  ...(progress ? { progress } : {}),
                },
              );
              return report;
            })()
          : await (async () => {
              const root = path.resolve(target);
              progress?.(
                progressEvent({ phase: "scan", percent: 10, message: "Scanning repository" }),
              );
              const { report } = await analyzeProject(root, {
                ...(opts.python ? { python: opts.python } : {}),
                ...(opts.openapi ? { openapi: path.resolve(opts.openapi) } : {}),
                ...(opts.coverage ? { coverage: path.resolve(opts.coverage) } : {}),
                ...(configPath ? { configPath } : {}),
                git: opts.git,
                maxGitCommits: Number(opts.maxGitCommits),
                ...(opts.cache !== false && cacheDir ? { incrementalDir: cacheDir } : {}),
              });
              return report;
            })();

      progress?.(progressEvent({ phase: "diff", percent: 82, message: "Loading baseline" }));
      const baseline = baselinePath && existsSync(baselinePath) ? readReport(baselinePath) : null;
      const diff = baseline ? diffReports(baseline, report) : null;
      const config = loadCodeMriConfig({
        ...(parsedRepos.length > 0
          ? { roots: parsedRepos.map((repo) => repo.root) }
          : { root: path.resolve(target) }),
        ...(configPath ? { configPath } : {}),
      });
      const gate = evaluateCiGates(report, { diff, gates: config.ci.gates });
      progress?.(progressEvent({ phase: "gate", percent: 94, message: "Evaluated CI gates" }));

      if (opts.json) writeJson(opts.json, report);
      if (opts.diffJson && diff) writeJson(opts.diffJson, diff);
      if (opts.markdown) {
        writeText(opts.markdown, formatCiMarkdown({ report, gate, diff, baselinePath }));
      }
      if (opts.sarif) {
        writeText(opts.sarif, formatSarif({ report, gate, breakingChanges: diff?.breakingChanges }));
      }
      const baselineOut = baselineOutputPath({
        baseline: opts.baseline,
        cacheDir,
        updateBaseline: opts.updateBaseline,
      });
      if (baselineOut) writeJson(baselineOut, report);

      progress?.(progressEvent({ phase: "done", percent: 100, message: "CI complete" }));
      process.stdout.write(`${formatCiSummary({ report, gate, diff, baselinePath })}\n`);
      process.exitCode = gate.passed ? 0 : 1;
    },
  );

program
  .command("ask-graph")
  .description("route a natural-language question to a deterministic graph query")
  .requiredOption("--report <file>", "Code MRI report JSON; no scan is performed")
  .option("--baseline <file>", "optional baseline report JSON for breaking-change questions")
  .option("--json", "write the structured result as JSON")
  .argument("<question...>", "question to ask the graph")
  .action((questionParts: string[], opts: { report: string; baseline?: string; json?: boolean }) => {
    const report = readReport(opts.report);
    const baseline = opts.baseline ? readReport(opts.baseline) : undefined;
    const result = askGraph(createAgentQueryContext(report, baseline), {
      question: questionParts.join(" "),
    });

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`Code MRI ask-graph — ${report.project.name}\n`);
    process.stdout.write(`Route: ${result.result?.tool ?? "unknown"}\n`);
    process.stdout.write(`Confidence: ${result.confidence}\n`);
    process.stdout.write(`Location: ${result.loc ? result.loc.file : "(none)"}\n`);
    process.stdout.write(`${result.message ?? ""}\n`);
  });

program
  .command("review-diff")
  .description("review changed files or diff text against a Code MRI report")
  .requiredOption("--report <file>", "Code MRI report JSON; no scan is performed")
  .option("--baseline <file>", "optional baseline report JSON")
  .option("--file <file>", "changed file to review; repeatable", collectRepo, [])
  .option("--diff <file>", "unified diff text file; omit to inspect git diff from the report root")
  .option("--json", "write the structured result as JSON")
  .action((opts: { report: string; baseline?: string; file: string[]; diff?: string; json?: boolean }) => {
    const report = readReport(opts.report);
    const baseline = opts.baseline ? readReport(opts.baseline) : undefined;
    const result = reviewDiff(createAgentQueryContext(report, baseline), {
      files: opts.file,
      ...(opts.diff ? { diffText: readFileSync(path.resolve(opts.diff), "utf8") } : {}),
    });

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`Code MRI review-diff — ${report.project.name}\n`);
    process.stdout.write(`Safe to proceed: ${result.safeToProceed ? "yes" : "no"}\n`);
    process.stdout.write(`${result.message ?? ""}\n`);
    for (const command of result.verificationCommands ?? []) {
      process.stdout.write(`- ${command.command} — ${command.reason}\n`);
    }
  });

program
  .command("mcp")
  .description("start an MCP stdio server for agent graph tools")
  .option("--report <file>", "optional Code MRI report JSON to load as the active context")
  .option("--baseline <file>", "optional baseline report JSON for breaking-change tools")
  .option("--allow-scan", "expose scan_project/load_report tools inside MCP")
  .option("--state-dir <dir>", "default MCP state directory for current report, baseline, and cache", ".code-mri")
  .option("--report-out <file>", "default report JSON written by scan_project")
  .option("--cache-dir <dir>", "default persistent incremental cache directory for scan_project")
  .option("--config <file>", "default .codemri.yml governance config for scan_project")
  .option("--openapi <file>", "default OpenAPI JSON/YAML file for scan_project")
  .option("--python <bin>", "default python executable for scan_project")
  .option("--coverage <file>", "default lcov.info or Istanbul coverage JSON for scan_project")
  .option("--no-git", "skip git churn collection by default for scan_project")
  .option("--max-git-commits <n>", "default maximum git commits to inspect for scan_project", "500")
  .option("--no-cache", "bypass persistent incremental cache by default for scan_project")
  .option("--mcp-text-mode <mode>", "tools/call text content mode: summary or json", "summary")
  .action((opts: {
    report?: string;
    baseline?: string;
    allowScan?: boolean;
    stateDir?: string;
    reportOut?: string;
    cacheDir?: string;
    config?: string;
    openapi?: string;
    python?: string;
    coverage?: string;
    git?: boolean;
    maxGitCommits?: string;
    cache?: boolean;
    mcpTextMode?: string;
  }) => {
    if (!opts.report && !opts.allowScan) {
      throw new Error("code-mri mcp requires --report unless --allow-scan is set");
    }
    const stateDir = path.resolve(opts.stateDir ?? ".code-mri");
    const defaultCacheDir = path.join(stateDir, "cache");
    const defaultReportPath = path.join(stateDir, "current-report.json");
    const defaultBaselinePath = path.join(stateDir, "baseline-report.json");
    const report = opts.report ? readReport(opts.report) : undefined;
    const baseline = opts.baseline ? readReport(opts.baseline) : undefined;
    startMcpServer({
      report,
      baseline,
      allowScan: Boolean(opts.allowScan),
      textMode: opts.mcpTextMode === "json" ? "json" : "summary",
      scanDefaults: {
        ...(opts.allowScan
          ? {
              cacheDir: opts.cacheDir ? path.resolve(opts.cacheDir) : defaultCacheDir,
              reportPath: opts.reportOut ? path.resolve(opts.reportOut) : defaultReportPath,
              baselinePath: opts.baseline ? path.resolve(opts.baseline) : defaultBaselinePath,
            }
          : {}),
        ...(opts.config ? { configPath: path.resolve(opts.config) } : {}),
        ...(opts.openapi ? { openapi: path.resolve(opts.openapi) } : {}),
        ...(opts.coverage ? { coverage: path.resolve(opts.coverage) } : {}),
        ...(opts.python ? { python: opts.python } : {}),
        git: opts.git,
        maxGitCommits: Number(opts.maxGitCommits),
        noCache: opts.cache === false,
      },
    });
  });

program
  .command("suggest-boundaries")
  .description("print a starter .codemri.yml boundary group draft from a report JSON")
  .argument("<report>", "Code MRI report JSON")
  .action((reportPath: string) => {
    const report = JSON.parse(readFileSync(path.resolve(reportPath), "utf8")) as Report;
    process.stdout.write(formatBoundarySuggestion(report));
  });

program
  .command("init-config")
  .description("create a starter .codemri.yml for a framework preset")
  .option("--preset <name>", `preset: ${CODE_MRI_PRESET_NAMES.join(", ")}`, "next")
  .option("--output <file>", "config file to write", ".codemri.yml")
  .option("--print", "print the config to stdout instead of writing a file")
  .option("--force", "overwrite an existing output file")
  .action((opts: { preset: string; output: string; print?: boolean; force?: boolean }) => {
    if (!CODE_MRI_PRESET_NAMES.includes(opts.preset as CodeMriPresetName)) {
      throw new Error(`Unknown preset "${opts.preset}". Use one of: ${CODE_MRI_PRESET_NAMES.join(", ")}`);
    }
    const text = formatCodeMriConfig(createCodeMriPresetConfig(opts.preset as CodeMriPresetName));
    if (opts.print) {
      process.stdout.write(text);
      return;
    }

    const out = path.resolve(opts.output);
    if (existsSync(out) && !opts.force) {
      throw new Error(`${opts.output} already exists. Re-run with --force to overwrite.`);
    }
    writeText(out, text);
    process.stdout.write(`Wrote ${opts.output} using preset ${opts.preset}\n`);
  });

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`code-mri: ${(err as Error).message}\n`);
  process.exitCode = process.argv[2] === "ci" ? 2 : 1;
});
