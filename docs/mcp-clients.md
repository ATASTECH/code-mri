# MCP Client Configuration

Use the npm package. This is the only package an MCP client needs; report
schema types are exported from `@code-mri/engine`.

```bash
npx -y @code-mri/engine@latest mcp --allow-scan --state-dir .code-mri
```

If your client supports `cwd`, set it to the project root you want Code MRI to
scan. If not, use absolute paths in `--state-dir`, `--config`, and tool
arguments.

## Codex Desktop

```toml
[mcp_servers.code-mri]
command = "npx"
args = ["-y", "@code-mri/engine@latest", "mcp", "--allow-scan", "--state-dir", ".code-mri"]
cwd = "/absolute/path/to/project"
startup_timeout_sec = 120
```

## Claude Desktop

```json
{
  "mcpServers": {
    "code-mri": {
      "command": "npx",
      "args": [
        "-y",
        "@code-mri/engine@latest",
        "mcp",
        "--allow-scan",
        "--state-dir",
        ".code-mri"
      ],
      "cwd": "/absolute/path/to/project"
    }
  }
}
```

## Cursor

```json
{
  "mcpServers": {
    "code-mri": {
      "command": "npx",
      "args": ["-y", "@code-mri/engine@latest", "mcp", "--allow-scan", "--state-dir", ".code-mri"],
      "cwd": "/absolute/path/to/project"
    }
  }
}
```

## Windsurf

```json
{
  "mcpServers": {
    "code-mri": {
      "command": "npx",
      "args": ["-y", "@code-mri/engine@latest", "mcp", "--allow-scan", "--state-dir", ".code-mri"],
      "cwd": "/absolute/path/to/project"
    }
  }
}
```

## Codex Desktop Local Repo

```json
{
  "mcpServers": {
    "code-mri": {
      "command": "node",
      "args": [
        "/absolute/path/to/code-mri/engine/dist/cli/index.js",
        "mcp",
        "--allow-scan",
        "--state-dir",
        "/absolute/path/to/project/.code-mri"
      ],
      "cwd": "/absolute/path/to/project"
    }
  }
}
```

## Report-Only Mode

Use this when CI already created a report and agents should not start scans:

```json
{
  "mcpServers": {
    "code-mri": {
      "command": "npx",
      "args": [
        "-y",
        "@code-mri/engine",
        "mcp",
        "--report",
        ".code-mri/current-report.json",
        "--baseline",
        ".code-mri/baseline-report.json"
      ]
    }
  }
}
```
