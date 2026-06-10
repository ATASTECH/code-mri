// Regenerate engine/test/fixtures/expected.json from the current engine output.
// Mirrors the golden test exactly: analyzeProject(FIXTURE) with root normalized.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../src/pipeline/analyze.js";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/sample-app", import.meta.url));
const EXPECTED = fileURLToPath(new URL("../test/fixtures/expected.json", import.meta.url));

const { report } = await analyzeProject(FIXTURE);
const normalized = { ...report, project: { ...report.project, root: "<fixture>" } };
writeFileSync(EXPECTED, `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`Regenerated ${EXPECTED}`);
