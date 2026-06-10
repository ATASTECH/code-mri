# Code MRI MCP Server

Code MRI MCP is a local-first code intelligence server for coding agents. It
scans a project, keeps a deterministic code graph in memory, and answers impact,
context, risk, and verification questions without sending source code to a
remote service.

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
2. Ask `impact_query` before editing a file or symbol.
3. Use `get_node_context` for local incoming/outgoing graph edges.
4. Use `recommend_tests` after planning the edit.
5. Run `scan_project` again and compare with a baseline when needed.

## Tools

- `scan_project` — opt-in live scan; updates active MCP report.
- `load_report` — loads an existing report JSON into active context.
- `graph_search` — searches graph nodes by path, id, name, and naming variants.
- `impact_query` — returns impacted nodes; file nodes expand to contained symbols.
- `get_node_context` — returns a node, direct edges, and attached issues.
- `find_dead_code` — returns dead-code and unused-endpoint candidates.
- `check_breaking_changes` — returns breaking issues and baseline diff risk.
- `ask_graph` — routes natural language to a deterministic graph tool.
- `recommend_tests` — suggests focused test/typecheck/build commands.

Every tool returns structured content with `confidence`, source `loc`, and
evidence where available.

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
