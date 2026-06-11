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
```

5. Pack to inspect package contents:

```bash
mkdir -p /tmp/code-mri-pack
cd engine
pnpm pack --pack-destination /tmp/code-mri-pack
```

Use `pnpm pack` or `pnpm publish` for release checks.

6. Publish engine/MCP CLI:

```bash
pnpm --filter @code-mri/engine publish --access public
```

7. If an old `@code-mri/shared-types` package is visible on npm, deprecate it:

```bash
npm deprecate @code-mri/shared-types "Code MRI is now one package. Use @code-mri/engine for CLI, MCP, and report types."
```

8. Smoke test from npm:

```bash
npx -y @code-mri/engine@latest mcp --allow-scan --state-dir .code-mri
```
