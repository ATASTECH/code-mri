# Publishing Checklist

Publish order matters because `@code-mri/engine` depends on
`@code-mri/shared-types`.

1. Update versions in:
   - `packages/shared-types/package.json`
   - `engine/package.json`
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
cd packages/shared-types
pnpm pack --pack-destination /tmp/code-mri-pack
cd ../../engine
pnpm pack --pack-destination /tmp/code-mri-pack
```

Use `pnpm pack` or `pnpm publish` for release checks. The engine package has a
workspace dependency on `@code-mri/shared-types`; pnpm rewrites that dependency
to the package version in the published tarball.

6. Publish shared types first:

```bash
pnpm --filter @code-mri/shared-types publish --access public
```

7. Publish engine/MCP CLI:

```bash
pnpm --filter @code-mri/engine publish --access public
```

8. Smoke test from npm:

```bash
npx -y @code-mri/engine mcp --allow-scan --state-dir .code-mri
```
