# Publishing Checklist

Code MRI publishes one public package: `@code-mri/engine`. The CLI, engine API,
report schema types, CI helpers, and MCP server all ship from that package.

1. Update the version in `engine/package.json`.
2. Use Node.js 24 LTS:

```bash
node -v
```

3. Confirm npm auth and scope access:

```bash
npm whoami
npm org ls code-mri
```

4. Build and test:

```bash
pnpm --filter @code-mri/engine test
pnpm --filter @code-mri/engine typecheck
pnpm --filter @code-mri/engine build
pnpm --filter @code-mri/desktop test
pnpm --filter @code-mri/desktop typecheck
pnpm --filter @code-mri/desktop build
```

5. Run MCP context-router smoke checks locally from the built dist:

```bash
node engine/dist/cli/index.js mcp --allow-scan --state-dir .code-mri --mcp-text-mode summary
```

Check that `tools/list` includes `prepare_edit_context`, `read_windows`,
`review_planned_change`, and `review_diff`, and that `tools/call` returns
compact `content.text` plus full `structuredContent.resultStats`.

6. Pack and smoke the exact tarball:

```bash
mkdir -p /tmp/code-mri-pack
pnpm --dir engine pack --pack-destination /tmp/code-mri-pack
npm_config_cache=/tmp/code-mri-npm-cache npm install --prefix /tmp/code-mri-smoke /tmp/code-mri-pack/code-mri-engine-0.3.0.tgz --no-audit --no-fund
/tmp/code-mri-smoke/node_modules/.bin/code-mri mcp --allow-scan --mcp-text-mode summary
```

7. Publish engine/MCP CLI:

```bash
pnpm --filter @code-mri/engine publish --access public
```

8. After publish, verify the public registry package:

```bash
npx -y @code-mri/engine@0.3.0 mcp --allow-scan --mcp-text-mode summary
```

9. If an old `@code-mri/shared-types` package is visible on npm, deprecate it:

```bash
npm deprecate @code-mri/shared-types "Code MRI is now one package. Use @code-mri/engine for CLI, MCP, and report types."
```
