# MCP Client Configuration

Use the npm package after publishing:

```bash
npx -y @code-mri/engine mcp --allow-scan --state-dir .code-mri
```

If your client supports `cwd`, set it to the project root you want Code MRI to
scan. If not, use absolute paths in `--state-dir`, `--config`, and tool
arguments.

## Claude Desktop

```json
{
  "mcpServers": {
    "code-mri": {
      "command": "npx",
      "args": [
        "-y",
        "@code-mri/engine",
        "mcp",
        "--allow-scan",
        "--state-dir",
        ".code-mri"
      ]
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
      "args": ["-y", "@code-mri/engine", "mcp", "--allow-scan", "--state-dir", ".code-mri"]
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
      "args": ["-y", "@code-mri/engine", "mcp", "--allow-scan", "--state-dir", ".code-mri"]
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
