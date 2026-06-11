# Code MRI MCP Server

Code MRI MCP is a local-first code intelligence server for coding agents. It
scans a project, keeps a deterministic code graph in memory, and answers impact,
context, risk, and verification questions without sending broad source code to a
remote model.

## Install

From npm after publishing:

```bash
npx -y @code-mri/engine mcp --allow-scan --state-dir .code-mri
```

From this repository:

```bash
pnpm --filter @code-mri/engine build
node engine/dist/cli/index.js mcp --allow-scan --state-dir .code-mri
```

## Scan Once, Ask Many

Start MCP with scan enabled:

```bash
code-mri mcp --allow-scan --state-dir .code-mri
```

The default state layout is:

- `.code-mri/current-report.json` — latest report written by `scan_project`
- `.code-mri/baseline-report.json` — optional baseline loaded by `scan_project`
- `.code-mri/cache/` — incremental parser cache

Typical agent flow:

1. Call `scan_project` with `{ "path": "." }`.
2. Call `prepare_edit_context` with the user task and a `tokenBudget`.
3. Call `read_windows` only for returned `mustRead` windows.
4. Call `review_planned_change` before editing.
5. After edits, call `review_diff`.
6. Call `recommend_tests` and run the returned commands.

## Tools

- `scan_project` — opt-in live scan; updates active MCP report.
- `load_report` — loads an existing report JSON into active context.
- `prepare_edit_context` — returns must-read line windows, impacts, risks,
  verification commands, and next tool calls for a task.
- `read_windows` — reads only bounded line windows. Secret candidates are
  redacted; use `mode="locations"` when source should stay omitted.
- `review_planned_change` — checks a planned edit before files are modified.
- `review_diff` — checks changed files or unified diff text after editing.
- `graph_search` — searches graph nodes by path, id, name, and naming variants.
- `impact_query` — returns impacted nodes; file nodes expand to contained symbols.
- `get_node_context` — returns a node, direct edges, and attached issues.
- `find_dead_code` — returns dead-code and unused-endpoint candidates.
- `check_breaking_changes` — returns breaking issues and baseline diff risk.
- `ask_graph` — routes natural language to a deterministic graph tool.
- `recommend_tests` — suggests focused test/typecheck/build commands.

Every tool returns structured content with `confidence`, source `loc`, compact
`resultStats`, and evidence where available.

## Token Budget Mode

The default MCP text response is a short summary. Full data is returned in
`structuredContent`, so clients do not need to feed duplicate JSON text back into
the model. Use `--mcp-text-mode json` only for older clients that parse
`content.text` as JSON.

Most query tools accept these fields:

- `detail`: `brief`, `standard`, or `full`; default is `brief`.
- `tokenBudget`: approximate result budget for the agent step.
- `includeEvidence`: include or suppress evidence strings.
- `limit`: hard result count cap.

When a result is truncated, `resultStats.omitted` and `nextQueries` tell the
agent what to ask next. The intended pattern is incremental: start brief, read
only returned windows, then ask for more detail only when needed.

`read_windows` returns bounded source windows by default, not full files. It
enforces window, line, and character caps, redacts secret candidates, and returns
a file `sha1` for stale-window detection. Use `mode="outline"` for declaration
orientation or `mode="locations"` when the agent should see only coordinates.

The MCP test suite keeps the `tools/list` schema footprint under a fixed byte
budget so tool descriptions and schemas do not become the dominant session cost.
See [mcp-agent-evals.md](mcp-agent-evals.md) for the agent workflow eval set.

## Project Fit

Best supported:

- Next.js, React, Vite, and React Router frontends
- TypeScript packages and monorepos
- Django/DRF, FastAPI, Flask, Express, and NestJS backends
- Split frontend/backend repos via `scan_project.repos`
- Docker Compose service maps
- OpenAPI specs for frontend/backend linking

Partially supported:

- Dynamic routing, runtime plugin systems, generated code, and framework
  conventions that are not visible statically. Use `publicApi` and
  `risk.ignorePaths` in `.codemri.yml` to tune those projects.

## Presets

Create a starter config:

```bash
code-mri init-config --preset next-django
```

Available presets:

- `next`
- `next-django`
- `vite-react`
- `node-api`
- `python-api`
- `library`

Print instead of writing:

```bash
code-mri init-config --preset vite-react --print
```
