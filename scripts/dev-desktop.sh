#!/bin/bash
# Wrapper so the preview tool launches the desktop dev server with Node 22.
export PATH="/Users/tahaatas/.nvm/versions/node/v22.8.0/bin:$PATH"
cd /Users/tahaatas/workspace/code-mri/apps/desktop
exec pnpm dev
