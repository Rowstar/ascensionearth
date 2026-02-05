import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readFileIfExists(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) return "";
  return fs.readFileSync(fullPath, "utf8").trim();
}

function firstLines(text, maxLines = 16) {
  if (!text) return "_CURRENT_STATE.md is missing or empty._";
  const lines = text.split(/\r?\n/).slice(0, maxLines);
  return lines.join("\n");
}

const dateStamp = new Date().toISOString().slice(0, 10);
const currentState = readFileIfExists("CURRENT_STATE.md");

const brief = [
  `# Studio Brief (${dateStamp})`,
  "",
  "## Current Snapshot",
  firstLines(currentState, 18),
  "",
  "## Required Context",
  "- Read VISION.md",
  "- Read STUDIO_MEMORY.md",
  "- Read DECISION_LOG.md",
  "- Read CURRENT_STATE.md",
  "",
  "## Next-Cycle Checklist",
  "- [ ] Run a Constraint Scan before planning",
  "- [ ] Write plan using docs/PLAN_TEMPLATE.md",
  "- [ ] Execute work and track drift",
  "- [ ] Run Plan Fidelity Review using docs/REVIEW_TEMPLATE.md",
  "- [ ] Ask only high-level questions if direction is needed",
  "- [ ] Update STUDIO_MEMORY.md, CURRENT_STATE.md, and DECISION_LOG.md",
  ""
].join("\n");

const outputPath = path.join(root, "docs", "STUDIO_BRIEF.md");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${brief}\n`, "utf8");

process.stdout.write(`${brief}\n`);
process.stdout.write(`Saved to ${path.relative(root, outputPath)}\n`);
