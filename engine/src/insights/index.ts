import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type {
  AiExplanation,
  AnalysisInsights,
  CoverageMetric,
  GitChurnMetric,
  GraphNode,
  HotspotMetric,
  Issue,
  SecretFinding,
} from "../types.js";
import type { Graph } from "../graph/graph.js";
import { nodeId } from "../ids.js";
import type { FileCategory, ScanFile } from "../scanner/index.js";

const DEFAULT_GIT_MAX_COMMITS = 500;
const MAX_SECRET_SCAN_BYTES = 1_500_000;
const HOTSPOT_SCORE_THRESHOLD = 25;
const COMPLEXITY_THRESHOLD = 18;
const LOW_COVERAGE_THRESHOLD = 50;
const HIGH_IMPACT_THRESHOLD = 3;

export interface InsightFile {
  path: string;
  graphPath: string;
  abs: string;
  category: FileCategory;
}

export interface InsightRepo {
  id?: string;
  root: string;
  files: InsightFile[];
  coveragePath?: string;
}

export interface BuildInsightsOptions {
  graph: Graph;
  repos: InsightRepo[];
  coverage?: string;
  coverageByRepo?: Record<string, string>;
  git?: boolean;
  maxGitCommits?: number;
}

export interface BuildInsightsResult {
  nodes: GraphNode[];
  issues: Issue[];
  insights: AnalysisInsights;
}

interface MutableChurn {
  file: string;
  commits: number;
  authors: Set<string>;
  lastCommitAt?: string;
}

interface CoverageAccumulator {
  file: string;
  total: number;
  covered: number;
  source: CoverageMetric["source"];
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function safeRead(abs: string): string | null {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function fileNodeId(file: string): string {
  return nodeId("File", file);
}

export function insightFilesFromScan(scanFiles: ScanFile[]): InsightFile[] {
  return scanFiles.map((file) => ({
    path: file.path,
    graphPath: file.path,
    abs: file.abs,
    category: file.category,
  }));
}

function collectGitChurn(repo: InsightRepo, maxCommits: number): GitChurnMetric[] {
  if (!existsSync(path.join(repo.root, ".git"))) return [];

  const byRel = new Map(repo.files.map((file) => [file.path, file.graphPath]));
  const metrics = new Map<string, MutableChurn>();

  let output = "";
  try {
    output = execFileSync(
      "git",
      [
        "-C",
        repo.root,
        "log",
        `--max-count=${maxCommits}`,
        "--date=iso-strict",
        "--format=--CODEMRI-COMMIT--%x09%an%x09%ad",
        "--name-only",
        "--",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      },
    );
  } catch {
    return [];
  }

  let author = "unknown";
  let date: string | undefined;
  let filesSeenInCommit = new Set<string>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("--CODEMRI-COMMIT--")) {
      const [, nextAuthor, nextDate] = line.split("\t");
      author = nextAuthor || "unknown";
      date = nextDate || undefined;
      filesSeenInCommit = new Set<string>();
      continue;
    }

    const rel = toPosix(line);
    const graphPath = byRel.get(rel);
    if (!graphPath || filesSeenInCommit.has(graphPath)) continue;
    filesSeenInCommit.add(graphPath);

    const current =
      metrics.get(graphPath) ??
      ({ file: graphPath, commits: 0, authors: new Set<string>() } satisfies MutableChurn);
    current.commits++;
    current.authors.add(author);
    current.lastCommitAt ??= date;
    metrics.set(graphPath, current);
  }

  return [...metrics.values()]
    .map((metric) => ({
      file: metric.file,
      commits: metric.commits,
      authors: metric.authors.size,
      ...(metric.lastCommitAt ? { lastCommitAt: metric.lastCommitAt } : {}),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function resolveCoveragePath(repo: InsightRepo, globalCoverage?: string): string | null {
  const explicit = repo.coveragePath ?? globalCoverage;
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(repo.root, explicit);
    return existsSync(abs) ? abs : null;
  }

  for (const rel of [
    "coverage/lcov.info",
    "coverage/coverage-final.json",
    "coverage/coverage.json",
  ]) {
    const abs = path.join(repo.root, rel);
    if (existsSync(abs)) return abs;
  }

  return null;
}

function graphPathForCoverage(repo: InsightRepo, rawFile: string): string | null {
  const normalized = toPosix(rawFile).replace(/^\.\//, "");
  const rel = path.isAbsolute(rawFile)
    ? toPosix(path.relative(repo.root, rawFile))
    : normalized;
  const byRel = new Map(repo.files.map((file) => [file.path, file.graphPath]));

  if (byRel.has(rel)) return byRel.get(rel) as string;

  const match = repo.files.find(
    (file) => rel.endsWith(`/${file.path}`) || file.path.endsWith(`/${rel}`),
  );
  return match?.graphPath ?? null;
}

function pct(covered: number, total: number): number | null {
  return total > 0 ? round1((covered / total) * 100) : null;
}

function upsertCoverage(
  out: Map<string, CoverageAccumulator>,
  file: string,
  total: number,
  covered: number,
  source: CoverageMetric["source"],
): void {
  const current = out.get(file);
  if (current) {
    current.total += total;
    current.covered += covered;
  } else {
    out.set(file, { file, total, covered, source });
  }
}

function parseLcov(repo: InsightRepo, text: string): CoverageMetric[] {
  const out = new Map<string, CoverageAccumulator>();
  let currentFile: string | null = null;
  let total = 0;
  let covered = 0;

  function flush(): void {
    if (currentFile) upsertCoverage(out, currentFile, total, covered, "lcov");
    currentFile = null;
    total = 0;
    covered = 0;
  }

  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      flush();
      currentFile = graphPathForCoverage(repo, line.slice(3).trim());
    } else if (line.startsWith("DA:") && currentFile) {
      const [, hitsRaw] = line.slice(3).split(",");
      total++;
      if (Number(hitsRaw) > 0) covered++;
    } else if (line === "end_of_record") {
      flush();
    }
  }
  flush();

  return [...out.values()]
    .map((metric) => ({ ...metric, pct: pct(metric.covered, metric.total) }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function parseCoverageJson(repo: InsightRepo, text: string): CoverageMetric[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const out = new Map<string, CoverageAccumulator>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const rawPath = typeof record.path === "string" ? record.path : key;
    const graphPath = graphPathForCoverage(repo, rawPath);
    if (!graphPath) continue;

    const statementCounts = record.s;
    if (statementCounts && typeof statementCounts === "object") {
      const counts = Object.values(statementCounts as Record<string, unknown>).map(Number);
      upsertCoverage(
        out,
        graphPath,
        counts.length,
        counts.filter((count) => count > 0).length,
        "coverage-json",
      );
      continue;
    }

    const lines = record.lines;
    if (lines && typeof lines === "object") {
      const lineRecord = lines as Record<string, unknown>;
      const total = Number(lineRecord.total);
      const covered = Number(lineRecord.covered);
      if (Number.isFinite(total) && Number.isFinite(covered)) {
        upsertCoverage(out, graphPath, total, covered, "coverage-json");
      }
    }
  }

  return [...out.values()]
    .map((metric) => ({ ...metric, pct: pct(metric.covered, metric.total) }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function collectCoverage(repo: InsightRepo, globalCoverage?: string): CoverageMetric[] {
  const coveragePath = resolveCoveragePath(repo, globalCoverage);
  if (!coveragePath) return [];
  const text = safeRead(coveragePath);
  if (!text) return [];
  return coveragePath.endsWith(".info") ? parseLcov(repo, text) : parseCoverageJson(repo, text);
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const p = count / value.length;
    return sum - p * Math.log2(p);
  }, 0);
}

function allowedSecretValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("example") ||
    lower.includes("placeholder") ||
    lower.includes("dummy") ||
    lower.includes("changeme") ||
    lower.includes("not-a-secret") ||
    lower.includes("localhost") ||
    /^x+$/.test(lower) ||
    /^0+$/.test(lower)
  );
}

function mask(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function pushSecret(
  out: SecretFinding[],
  file: string,
  line: number,
  column: number,
  rule: string,
  value: string,
  entropyValue?: number,
): void {
  if (allowedSecretValue(value)) return;
  out.push({
    file,
    line,
    column,
    rule,
    preview: mask(value),
    ...(entropyValue ? { entropy: round1(entropyValue) } : {}),
  });
}

function collectSecrets(files: InsightFile[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  const fixedRules: Array<[string, RegExp]> = [
    ["aws-access-key", /\b(AKIA[0-9A-Z]{16})\b/g],
    ["github-token", /\b(ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
    ["slack-token", /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g],
  ];
  const quotedAssignment =
    /\b([A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\b\s*[:=]\s*["']([^"']{12,})["']/gi;
  const envAssignment =
    /^\s*(?:export\s+)?([A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\b\s*=\s*([^"'\s#]{12,})/gi;
  const highEntropy = /[A-Za-z0-9+/=_-]{32,}/g;

  for (const file of files) {
    const text = safeRead(file.abs);
    if (!text || text.length > MAX_SECRET_SCAN_BYTES) continue;

    text.split("\n").forEach((lineText, index) => {
      const line = index + 1;
      for (const [rule, regex] of fixedRules) {
        regex.lastIndex = 0;
        for (const match of lineText.matchAll(regex)) {
          const value = match[1];
          if (value) pushSecret(out, file.graphPath, line, (match.index ?? 0) + 1, rule, value);
        }
      }

      quotedAssignment.lastIndex = 0;
      for (const match of lineText.matchAll(quotedAssignment)) {
        const value = match[2];
        if (!value) continue;
        pushSecret(
          out,
          file.graphPath,
          line,
          (match.index ?? 0) + 1,
          "secret-assignment",
          value,
          entropy(value),
        );
      }

      envAssignment.lastIndex = 0;
      for (const match of lineText.matchAll(envAssignment)) {
        const value = match[2];
        if (!value) continue;
        pushSecret(
          out,
          file.graphPath,
          line,
          (match.index ?? 0) + 1,
          "secret-assignment",
          value,
          entropy(value),
        );
      }

      if (!/(secret|token|api[_-]?key|password|private[_-]?key)/i.test(lineText)) return;
      highEntropy.lastIndex = 0;
      for (const match of lineText.matchAll(highEntropy)) {
        const value = match[0];
        const e = entropy(value);
        if (e >= 4.2) {
          pushSecret(out, file.graphPath, line, (match.index ?? 0) + 1, "high-entropy", value, e);
        }
      }
    });
  }

  return out.sort((a, b) => `${a.file}:${a.line}:${a.column}`.localeCompare(`${b.file}:${b.line}:${b.column}`));
}

function fileComplexity(file: InsightFile): number {
  if (file.category !== "typescript" && file.category !== "python") return 0;
  const text = safeRead(file.abs);
  if (!text) return 0;

  const keywordMatches = text.match(
    /\b(if|elif|else\s+if|for|while|case|catch|except|switch)\b/g,
  );
  const booleanMatches = text.match(/&&|\|\||\?/g);
  return 1 + (keywordMatches?.length ?? 0) + (booleanMatches?.length ?? 0);
}

function numericMeta(meta: Record<string, unknown> | undefined, key: string): number | null {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildHotspots(
  graph: Graph,
  nodes: GraphNode[],
  files: InsightFile[],
  churn: Map<string, GitChurnMetric>,
  coverage: Map<string, CoverageMetric>,
): HotspotMetric[] {
  const complexityByFile = new Map(files.map((file) => [file.graphPath, fileComplexity(file)]));
  const hotspots: HotspotMetric[] = [];

  for (const node of nodes) {
    const file = node.loc?.file;
    if (!file || node.kind === "File" || node.kind === "Directory") continue;

    const complexity = complexityByFile.get(file) ?? 0;
    const churnMetric = churn.get(file);
    const fanIn = graph.inEdges(node.id).length;
    const fanOut = graph.outEdges(node.id).length;
    const impact = graph.impact(node.id).length;
    const commits = churnMetric?.commits ?? 0;
    const score =
      commits > 0
        ? Math.round(complexity * commits * (1 + fanIn * 0.05 + fanOut * 0.02))
        : 0;
    const coveragePct = coverage.get(file)?.pct ?? null;
    const existingScore = numericMeta(node.meta, "hotspotScore");

    const metric: HotspotMetric = {
      nodeId: node.id,
      kind: node.kind,
      name: node.name,
      file,
      churn: commits,
      authors: churnMetric?.authors ?? 0,
      complexity,
      fanIn,
      fanOut,
      impact,
      score: existingScore ?? score,
      coveragePct,
    };

    if (metric.score > 0 || complexity >= COMPLEXITY_THRESHOLD) hotspots.push(metric);
  }

  return hotspots
    .sort((a, b) => b.score - a.score || b.complexity - a.complexity || a.nodeId.localeCompare(b.nodeId))
    .slice(0, 25);
}

function enrichNodes(
  graph: Graph,
  churn: Map<string, GitChurnMetric>,
  coverage: Map<string, CoverageMetric>,
  hotspots: Map<string, HotspotMetric>,
): GraphNode[] {
  return graph.nodes().map((node) => {
    const file = node.loc?.file;
    if (!file) return node;
    const churnMetric = churn.get(file);
    const coverageMetric = coverage.get(file);
    const hotspot = hotspots.get(node.id);
    if (!churnMetric && !coverageMetric && !hotspot) return node;

    return {
      ...node,
      meta: {
        ...(node.meta ?? {}),
        ...(churnMetric
          ? { churn: churnMetric.commits, authors: churnMetric.authors }
          : {}),
        ...(coverageMetric ? { coveragePct: coverageMetric.pct } : {}),
        ...(hotspot
          ? {
              complexity: hotspot.complexity,
              fanIn: hotspot.fanIn,
              fanOut: hotspot.fanOut,
              impact: hotspot.impact,
              hotspotScore: hotspot.score,
            }
          : {}),
      },
    };
  });
}

function issuesFromInsights(
  secrets: SecretFinding[],
  hotspots: HotspotMetric[],
): Issue[] {
  const issues: Issue[] = [];

  for (const secret of secrets) {
    issues.push({
      kind: "SECRET_CANDIDATE",
      severity: "high",
      message: `Potential ${secret.rule} secret in ${secret.file}:${secret.line}`,
      nodes: [fileNodeId(secret.file)],
      candidate: true,
      meta: { ...secret },
    });
  }

  for (const hotspot of hotspots) {
    if (hotspot.score >= HOTSPOT_SCORE_THRESHOLD || hotspot.complexity >= COMPLEXITY_THRESHOLD) {
      issues.push({
        kind: "COMPLEXITY_HOTSPOT",
        severity: hotspot.score >= HOTSPOT_SCORE_THRESHOLD ? "medium" : "low",
        message: `${hotspot.name} has complexity ${hotspot.complexity} and hotspot score ${hotspot.score}`,
        nodes: [hotspot.nodeId],
        candidate: true,
        meta: { ...hotspot },
      });
    }

    if (
      hotspot.coveragePct !== null &&
      hotspot.coveragePct !== undefined &&
      hotspot.coveragePct < LOW_COVERAGE_THRESHOLD &&
      hotspot.impact >= HIGH_IMPACT_THRESHOLD
    ) {
      issues.push({
        kind: "UNCOVERED_RISKY_NODE",
        severity: "medium",
        message: `${hotspot.name} has ${hotspot.coveragePct}% coverage and impacts ${hotspot.impact} nodes`,
        nodes: [hotspot.nodeId],
        candidate: true,
        meta: { ...hotspot },
      });
    }
  }

  return issues;
}

function buildExplanations(
  hotspots: HotspotMetric[],
  secrets: SecretFinding[],
  coverage: CoverageMetric[],
): AiExplanation[] {
  const explanations: AiExplanation[] = [];
  const topHotspot = hotspots[0];
  if (topHotspot) {
    explanations.push({
      id: "top-hotspot",
      title: "Top hotspot",
      summary: `${topHotspot.name} is the highest ranked hotspot: score ${topHotspot.score}, complexity ${topHotspot.complexity}, churn ${topHotspot.churn}.`,
      evidence: [
        {
          nodeId: topHotspot.nodeId,
          file: topHotspot.file,
          label: "highest hotspot score",
        },
      ],
    });
  }

  if (secrets.length) {
    explanations.push({
      id: "secret-review",
      title: "Secret review",
      summary: `${secrets.length} committed secret candidate${secrets.length === 1 ? "" : "s"} need manual verification.`,
      evidence: secrets.slice(0, 5).map((secret) => ({
        issueKind: "SECRET_CANDIDATE",
        file: secret.file,
        label: `${secret.rule} at line ${secret.line}`,
      })),
    });
  }

  const lowCoverage = coverage.filter((metric) => metric.pct !== null && metric.pct < LOW_COVERAGE_THRESHOLD);
  if (lowCoverage.length) {
    explanations.push({
      id: "coverage-gaps",
      title: "Coverage gaps",
      summary: `${lowCoverage.length} covered file${lowCoverage.length === 1 ? "" : "s"} are below ${LOW_COVERAGE_THRESHOLD}% line/statement coverage.`,
      evidence: lowCoverage.slice(0, 5).map((metric) => ({
        file: metric.file,
        label: `${metric.pct}% covered`,
      })),
    });
  }

  if (explanations.length === 0) {
    explanations.push({
      id: "phase-10-clean",
      title: "No phase-10 hotspots",
      summary: "No churn hotspots, secret candidates, or coverage gaps were detected from the available local inputs.",
      evidence: [],
    });
  }

  return explanations;
}

export function buildInsights(options: BuildInsightsOptions): BuildInsightsResult {
  const allFiles = options.repos.flatMap((repo) => repo.files);
  const maxGitCommits = options.maxGitCommits ?? DEFAULT_GIT_MAX_COMMITS;
  const churn = options.git === false
    ? []
    : options.repos.flatMap((repo) => collectGitChurn(repo, maxGitCommits));
  const coverage = options.repos.flatMap((repo) =>
    collectCoverage(
      {
        ...repo,
        coveragePath: repo.id ? options.coverageByRepo?.[repo.id] : repo.coveragePath,
      },
      options.coverage,
    ),
  );
  const secrets = collectSecrets(allFiles);

  const churnByFile = new Map(churn.map((metric) => [metric.file, metric]));
  const coverageByFile = new Map(coverage.map((metric) => [metric.file, metric]));
  const rawNodes = options.graph.nodes();
  const hotspots = buildHotspots(options.graph, rawNodes, allFiles, churnByFile, coverageByFile);
  const hotspotByNode = new Map(hotspots.map((hotspot) => [hotspot.nodeId, hotspot]));
  const nodes = enrichNodes(options.graph, churnByFile, coverageByFile, hotspotByNode);
  const issues = issuesFromInsights(secrets, hotspots);

  return {
    nodes,
    issues,
    insights: {
      churn,
      coverage,
      hotspots,
      secrets,
      explanations: buildExplanations(hotspots, secrets, coverage),
      dependencyAudit: {
        status: "not_run",
        reason: "Dependency CVE lookup requires an external advisory source; the local deterministic scan records this as not run.",
      },
    },
  };
}
