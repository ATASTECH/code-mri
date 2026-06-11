# Code MRI Engine

Public CLI, engine API, CI helpers, report schema types, and MCP stdio server
for Code MRI.

This is the only public package an MCP client needs. The MCP server acts as an
agent context router: AI agents can ask for impact, risk, focused source
windows, and test commands without reading the whole repository into the model.

Requires Node.js 24 LTS.

Scan a local project:

```bash
npx -y @code-mri/engine@latest scan . --json .code-mri/current-report.json
```

Run the MCP server for coding agents:

```bash
npx -y @code-mri/engine@latest mcp --allow-scan --state-dir .code-mri
```

MCP clients only install `@code-mri/engine`; report schema types are exported
from this package.

Recommended MCP workflow for coding agents:

```text
scan_project/load_report -> prepare_edit_context -> read_windows -> review_diff -> recommend_tests
```

See the repository README for the local Next.js UI, full setup, MCP behavior,
and client configuration examples.
