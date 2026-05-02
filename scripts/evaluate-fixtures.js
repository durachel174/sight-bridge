import fs from "node:fs/promises";
import path from "node:path";
import { analyzeDisclosure } from "../src/engine/sensitivityEngine.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const MANIFEST_PATH = path.join(ROOT, "fixtures/images/manifest.json");
const SERVER_URL = process.env.SIGHTBRIDGE_SERVER_URL ?? "http://127.0.0.1:5173";
const SHOULD_RUN_CLOUD = process.argv.includes("--cloud") || process.env.EVAL_CLOUD === "1";

const CATEGORY_ALIASES = {
  public: "none"
};

async function main() {
  const config = await assertServer();
  const runCloud = SHOULD_RUN_CLOUD && config.cloudVisionAvailable;

  if (SHOULD_RUN_CLOUD && !config.cloudVisionAvailable) {
    console.log("Cloud comparison requested, but cloud vision is not configured.");
    console.log("Start the server with OPENAI_API_KEY to enable it.\n");
  }

  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  const results = [];

  for (const fixture of manifest) {
    const imagePath = path.join(ROOT, fixture.path);
    const ocr = await analyzeImage(imagePath);
    const localDecision = await analyzeDisclosure({ text: ocr.text });
    const localCategory = normalizeCategory(localDecision.category);
    const localPassed =
      localDecision.severity === fixture.expectedSeverity &&
      localCategory === fixture.expectedCategory;

    const cloud = runCloud ? await analyzeCloudImage(imagePath) : null;
    const cloudDecision = cloud?.decision ?? null;
    const cloudCategory = cloudDecision ? normalizeCategory(cloudDecision.category) : null;
    const cloudPassed = cloudDecision
      ? cloudDecision.severity === fixture.expectedSeverity && cloudCategory === fixture.expectedCategory
      : null;

    results.push({
      ...fixture,
      localSeverity: localDecision.severity,
      localCategory,
      localDisclosureMessage: localDecision.disclosureMessage,
      cloudSeverity: cloudDecision?.severity ?? null,
      cloudCategory,
      cloudDisclosureMessage: cloudDecision?.disclosure_message ?? null,
      ocrText: ocr.text,
      localPassed,
      cloudPassed,
      comparison: compareDecisions(localPassed, cloudPassed)
    });
  }

  printResults(results, { runCloud, cloudConfigured: config.cloudVisionAvailable });

  if (results.some((result) => !result.localPassed)) {
    process.exitCode = 1;
  }
}

async function assertServer() {
  try {
    const response = await fetch(`${SERVER_URL}/api/config`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (error) {
    throw new Error(
      `SightBridge server is not reachable at ${SERVER_URL}. Start it with python3 scripts/server.py.`
    );
  }
}

async function analyzeImage(imagePath) {
  const imageBytes = await fs.readFile(imagePath);
  const formData = new FormData();
  formData.append("image", new Blob([imageBytes]), path.basename(imagePath));

  const response = await fetch(`${SERVER_URL}/api/analyze-image`, {
    method: "POST",
    body: formData
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`${path.basename(imagePath)} OCR failed: ${payload.message ?? response.status}`);
  }

  return payload;
}

async function analyzeCloudImage(imagePath) {
  const imageBytes = await fs.readFile(imagePath);
  const formData = new FormData();
  formData.append("image", new Blob([imageBytes]), path.basename(imagePath));

  const response = await fetch(`${SERVER_URL}/api/analyze-image-cloud`, {
    method: "POST",
    body: formData
  });
  const payload = await response.json();

  if (!response.ok) {
    return {
      available: false,
      decision: null,
      message: payload.message ?? `Cloud HTTP ${response.status}`
    };
  }

  return payload;
}

function printResults(results, { runCloud, cloudConfigured }) {
  const rows = results.map((result) => ({
    id: result.id,
    expected: `${result.expectedSeverity}/${result.expectedCategory}`,
    local: `${result.localSeverity}/${result.localCategory}`,
    localPass: result.localPassed ? "yes" : "no",
    cloud: runCloud ? `${result.cloudSeverity}/${result.cloudCategory}` : cloudConfigured ? "available (--cloud off)" : "not configured",
    comparison: result.comparison
  }));

  console.table(rows);

  const passed = results.filter((result) => result.localPassed).length;
  console.log(`\nLocal: ${passed}/${results.length} fixtures passed`);

  if (runCloud) {
    const cloudPassed = results.filter((result) => result.cloudPassed).length;
    console.log(`Cloud: ${cloudPassed}/${results.length} fixtures passed`);
  }

  for (const result of results.filter((item) => !item.localPassed)) {
    console.log(`\nFAIL ${result.id}`);
    console.log(`Expected: ${result.expectedSeverity}/${result.expectedCategory}`);
    console.log(`Local:    ${result.localSeverity}/${result.localCategory}`);
    console.log(`Message:  ${result.localDisclosureMessage}`);
    console.log(`OCR:      ${preview(result.ocrText)}`);
  }
}

function normalizeCategory(category) {
  return CATEGORY_ALIASES[category] ?? category ?? "none";
}

function compareDecisions(localPassed, cloudPassed) {
  if (cloudPassed === null) return "local only";
  if (localPassed && cloudPassed) return "matched pass";
  if (!localPassed && cloudPassed) return "cloud improved";
  if (localPassed && !cloudPassed) return "cloud regressed";
  return "both missed";
}

function preview(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 220) return cleaned;
  return `${cleaned.slice(0, 220)}...`;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
