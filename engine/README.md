# Code MRI Engine

Public CLI, engine API, CI helpers, and MCP stdio server for Code MRI.

Requires Node.js 24 LTS.

Scan a local project:

```bash
npx -y @code-mri/engine@latest scan . --json .code-mri/current-report.json
```

Run the MCP server for coding agents:

```bash
npx -y @code-mri/engine@latest mcp --allow-scan --state-dir .code-mri
```

MCP clients only install `@code-mri/engine`; `@code-mri/shared-types` is pulled
automatically as the shared report-schema dependency.

See the repository README for the local Next.js UI, full setup, MCP behavior,
and client configuration examples.
