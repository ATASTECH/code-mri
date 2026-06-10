# Code MRI Desktop

Next.js desktop UI for local Code MRI project analysis.

Requires Node.js 24 LTS.

```bash
pnpm --filter @code-mri/desktop dev
```

## Local Database

SQLite storage resolves in this order:

1. `CODE_MRI_DB_PATH`
2. `CODE_MRI_APP_DATA_DIR/code-mri.sqlite`
3. OS app-data in production
4. `.code-mri/code-mri.sqlite` in local development

## Runtime

V1 runs as a Next.js app with local API routes, SQLite storage, and the scan engine invoked through its CLI child process. Native shells such as Electron or Tauri are intentionally out of scope for now.

Governance config is loaded by the engine CLI during scans. The engine auto-discovers `.codemri.yml` from project roots; set `CODE_MRI_CONFIG=/path/to/.codemri.yml` to force a specific file from the desktop app.
