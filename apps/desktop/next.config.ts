import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
  // The scan engine pulls in ts-morph, which embeds the full TypeScript
  // compiler (@ts-morph/common is an ~11MB single file; typescript is ~23MB).
  // Letting Turbopack bundle these on-demand spikes dev memory by >1GB per
  // route compile and can exhaust system RAM. Keep them external so they are
  // require()'d at runtime from node_modules instead of being bundled.
  serverExternalPackages: [
    "@code-mri/engine",
    "ts-morph",
    "@ts-morph/common",
    "typescript",
  ],
  experimental: {
    // Barrel libraries (icon sets, charting, graph) otherwise force the dev
    // compiler to walk thousands of modules per importer, which balloons
    // Turbopack memory during on-demand route compilation. Optimizing the
    // imports keeps only the symbols actually used.
    optimizePackageImports: ["lucide-react", "recharts", "@xyflow/react"],
  },
}

export default nextConfig
