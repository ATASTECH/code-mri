# Code MRI Engine

Public CLI, engine API, CI helpers, and MCP stdio server for Code MRI.

Requires Node.js 24 LTS.

Scan a local project:

```bash
npx -y @code-mri/engine scan . --json .code-mri/current-report.json
```

Run the MCP server for coding agents:

```bash
npx -y @code-mri/engine mcp --allow-scan --state-dir .code-mri
```

See the repository README for the local Next.js UI, full setup, MCP behavior,
and client configuration examples.
