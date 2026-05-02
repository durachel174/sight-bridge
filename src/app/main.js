import { analyzeDisclosure } from "../engine/sensitivityEngine.js";
import { analyzeImageFile } from "../engine/imageAnalyzer.js";

const els = {
  imageInput: document.querySelector("#image-input"),
  analyzeImageButton: document.querySelector("#analyze-image-button"),
  preview: document.querySelector("#preview"),
  scenarioSelect: document.querySelector("#scenario-select"),
  sceneText: document.querySelector("#scene-text"),
  sensitivityLevel: document.querySelector("#sensitivity-level"),
  analyzeButton: document.querySelector("#analyze-button"),
  severity: document.querySelector("#severity"),
  disclosureMessage: document.querySelector("#disclosure-message"),
  reasoning: document.querySelector("#reasoning"),
  permissionActions: document.querySelector("#permission-actions"),
  processingMode: document.querySelector("#processing-mode"),
  explanationStrip: document.querySelector("#explanation-strip"),
  plainExplanation: document.querySelector("#plain-explanation"),
  scanHistory: document.querySelector("#scan-history"),
  metricTotal: document.querySelector("#metric-total"),
  metricAlerts: document.querySelector("#metric-alerts"),
  metricRestricted: document.querySelector("#metric-restricted"),
  metricAiOnly: document.querySelector("#metric-ai-only"),
  sampleList: document.querySelector("#sample-list")
};

els.startCameraButton = document.querySelector("#start-camera-button");
els.captureButton = document.querySelector("#capture-button");
els.cameraPreview = document.querySelector("#camera-preview");
els.captureCanvas = document.querySelector("#capture-canvas");
els.localMode = document.querySelector("#local-mode");
els.cloudMode = document.querySelector("#cloud-mode");
els.evidenceCategory = document.querySelector("#evidence-category");
els.evidenceProcessing = document.querySelector("#evidence-processing");
els.evidenceText = document.querySelector("#evidence-text");
els.preferenceSensitivity = document.querySelector("#preference-sensitivity");
els.continueAction = document.querySelector("#continue-action");
els.restrictAction = document.querySelector("#restrict-action");
els.aiOnlyAction = document.querySelector("#ai-only-action");
els.cancelAction = document.querySelector("#cancel-action");
els.clearCurrentButton = document.querySelector("#clear-current-button");
els.clearLocalButton = document.querySelector("#clear-local-button");

let scenarios = [];
let selectedImage = null;
let cameraStream = null;
let currentScan = null;
const scanHistory = loadScanHistory();
const DEFAULT_PREFERENCES = {
  sensitivity: "medium",
  alertCategories: ["financial", "medical", "identity", "address", "screen", "personal"]
};

init();

async function init() {
  scenarios = await loadScenarios();
  for (const scenario of scenarios) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = `${scenario.id}. ${scenario.scene}`;
    els.scenarioSelect.append(option);
  }

  els.imageInput.addEventListener("change", handleImage);
  els.analyzeImageButton.addEventListener("click", analyze);
  els.startCameraButton.addEventListener("click", startCamera);
  els.captureButton.addEventListener("click", captureFrame);
  els.scenarioSelect.addEventListener("change", handleScenario);
  els.analyzeButton.addEventListener("click", analyze);
  els.continueAction.addEventListener("click", () => applyDisclosureAction("continued"));
  els.restrictAction.addEventListener("click", () => applyDisclosureAction("restricted"));
  els.aiOnlyAction.addEventListener("click", () => applyDisclosureAction("ai-only"));
  els.cancelAction.addEventListener("click", cancelCurrentScan);
  els.clearCurrentButton.addEventListener("click", cancelCurrentScan);
  els.clearLocalButton.addEventListener("click", clearLocalData);
  els.preferenceSensitivity.addEventListener("change", savePreferencesFromUI);
  document.querySelectorAll("input[name='preference-category']").forEach((input) => {
    input.addEventListener("change", savePreferencesFromUI);
  });
  loadPreferences();
  renderHistory();
  renderSamples();
  configureCloudMode();
}

async function configureCloudMode() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    els.cloudMode.disabled = !config.cloudVisionAvailable;
    els.localMode.disabled = config.localOcrAvailable === false;

    if (config.localOcrAvailable === false && config.cloudVisionAvailable) {
      els.cloudMode.checked = true;
      els.processingMode.textContent = "Cloud vision assist";
    }

    if (config.localOcrAvailable === false && !config.cloudVisionAvailable) {
      els.processingMode.textContent = "Demo mode: configure cloud vision for uploads";
      els.disclosureMessage.textContent = "Cloud vision is not configured.";
      els.reasoning.textContent = "Sample scans still work. Image uploads need OPENAI_API_KEY in deployment.";
    }

    els.cloudMode.parentElement.title = config.cloudVisionAvailable
      ? "Cloud vision is available. You will be asked before any image is sent."
      : "Set OPENAI_API_KEY before starting the server to enable cloud vision assist.";
    els.localMode.parentElement.title = config.localOcrAvailable === false
      ? "Local OCR is only available from the local Python/Swift server."
      : "Local macOS Vision OCR is available.";
  } catch {
    els.cloudMode.disabled = true;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    els.disclosureMessage.textContent = "Camera is not available in this browser.";
    els.reasoning.textContent =
      "Use Choose image for now. Some embedded browsers do not expose camera access even on a Mac.";
    els.permissionActions.hidden = true;
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    els.cameraPreview.srcObject = cameraStream;
    els.captureButton.disabled = false;
    els.startCameraButton.textContent = "Camera active";
    els.disclosureMessage.textContent = "Camera is active.";
    els.reasoning.textContent = "Capture a frame when you want SightBridge to run local OCR disclosure analysis.";
    els.permissionActions.hidden = true;
  } catch (error) {
    els.disclosureMessage.textContent = "Camera could not be started.";
    els.reasoning.textContent = cameraErrorMessage(error);
    els.permissionActions.hidden = true;
  }
}

async function captureFrame() {
  if (!cameraStream) return;

  const video = els.cameraPreview;
  const canvas = els.captureCanvas;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  selectedImage = new File([blob], `sightbridge-capture-${Date.now()}.jpg`, { type: "image/jpeg" });

  const image = document.createElement("img");
  image.alt = "Captured scene preview";
  image.src = URL.createObjectURL(selectedImage);
  els.preview.replaceChildren(image);
  els.analyzeImageButton.disabled = false;
  els.disclosureMessage.textContent = "Frame captured.";
  els.reasoning.textContent = "Use Analyze image to check the captured frame for visible sensitive text.";
}

async function loadScenarios() {
  const response = await fetch("../fixtures/scenarios.json");
  return response.json();
}

function handleImage(event) {
  const [file] = event.target.files;
  if (!file) return;

  selectedImage = file;
  const image = document.createElement("img");
  image.alt = "Selected scene preview";
  image.src = URL.createObjectURL(file);

  els.preview.replaceChildren(image);
  els.analyzeImageButton.disabled = false;
  els.disclosureMessage.textContent = "Image selected.";
  els.reasoning.textContent =
    "Use Analyze image to run local OCR and then check the extracted text for disclosure risks.";
  els.processingMode.textContent = "Local image OCR + local disclosure rules";
}

function handleScenario(event) {
  const scenario = scenarios.find((item) => String(item.id) === event.target.value);
  if (!scenario) return;

  els.sceneText.value = scenario.prototypeText;
  els.preview.replaceChildren(document.createTextNode(scenario.scene));
  analyze();
}

function renderSamples() {
  const sampleIds = [12, 6, 5, 7];
  els.sampleList.replaceChildren();

  for (const id of sampleIds) {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sample-card";
    button.innerHTML = `<strong>${scenario.scene}</strong><span>Expected: ${scenario.expectedSensitivity}</span>`;
    button.addEventListener("click", () => runSampleScenario(scenario));
    els.sampleList.append(button);
  }
}

function runSampleScenario(scenario) {
  selectedImage = null;
  els.sceneText.value = scenario.prototypeText;
  els.preview.replaceChildren(document.createTextNode(scenario.scene));
  els.disclosureMessage.textContent = "Sample loaded.";
  els.reasoning.textContent = "Running this sample through the same disclosure engine.";
  analyze();
}

async function analyze() {
  els.analyzeButton.disabled = true;
  els.analyzeImageButton.disabled = true;
  els.analyzeButton.textContent = "Analyzing...";
  els.analyzeImageButton.textContent = "Analyzing...";

  const mode = selectedAnalysisMode();
  if (mode === "cloud" && selectedImage) {
    const approved = window.confirm(
      "Cloud vision sends this image to OpenAI for analysis. Continue?"
    );
    if (!approved) {
      els.analyzeButton.disabled = false;
      els.analyzeImageButton.disabled = !selectedImage;
      els.analyzeButton.textContent = "Analyze disclosure";
      els.analyzeImageButton.textContent = "Analyze image";
      return;
    }
  }

  const imageResult = await analyzeImageFile(selectedImage, { mode });
  const text = [els.sceneText.value, imageResult.text].filter(Boolean).join("\n");

  const result = await analyzeDisclosure({
    text,
    preferences: currentPreferences()
  });

  renderResult(result, imageResult, text);
  els.analyzeButton.disabled = false;
  els.analyzeImageButton.disabled = !selectedImage;
  els.analyzeButton.textContent = "Analyze disclosure";
  els.analyzeImageButton.textContent = "Analyze image";
}

function selectedCategories() {
  return [...document.querySelectorAll("input[name='category']:checked")].map((input) => input.value);
}

function currentPreferences() {
  const alertCategories = [...document.querySelectorAll("input[name='preference-category']:checked")].map(
    (input) => input.value
  );

  return {
    sensitivity: els.preferenceSensitivity.value,
    alertCategories
  };
}

function loadPreferences() {
  const stored = localStorage.getItem("sightbridge.preferences");
  const preferences = stored ? JSON.parse(stored) : DEFAULT_PREFERENCES;
  const categories = preferences.alertCategories ?? DEFAULT_PREFERENCES.alertCategories;

  els.preferenceSensitivity.value = preferences.sensitivity ?? DEFAULT_PREFERENCES.sensitivity;
  els.sensitivityLevel.value = els.preferenceSensitivity.value;

  document.querySelectorAll("input[name='preference-category']").forEach((input) => {
    input.checked = categories.includes(input.value);
  });

  syncDeveloperCategoryMirror(categories);
}

function savePreferencesFromUI() {
  const preferences = currentPreferences();
  localStorage.setItem("sightbridge.preferences", JSON.stringify(preferences));
  els.sensitivityLevel.value = preferences.sensitivity;
  syncDeveloperCategoryMirror(preferences.alertCategories);
}

function syncDeveloperCategoryMirror(alertCategories) {
  document.querySelectorAll("input[name='category']").forEach((input) => {
    input.checked = alertCategories.includes(input.value);
  });
}

function renderResult(result, imageResult, analyzedText) {
  const cloudDecision = imageResult?.cloudDecision;
  const displayedResult = cloudDecision ? cloudDecisionToResult(cloudDecision, result) : result;

  els.severity.textContent = displayedResult.severity;
  els.severity.dataset.severity = displayedResult.severity;
  els.disclosureMessage.textContent = displayedResult.disclosureMessage;
  const imageNote = selectedImage && imageResult?.message ? `${imageResult.message} ` : "";
  els.reasoning.textContent = `${imageNote}${displayedResult.reasoning} Latency: ${result.latencyMs}ms.`;
  els.permissionActions.hidden = displayedResult.permissionChoices.length === 0;
  els.processingMode.textContent = imageResult?.message ?? result.processing.external;
  els.evidenceCategory.textContent = displayedResult.category;
  els.evidenceProcessing.textContent = imageResult?.message ?? "Local text rules";
  els.evidenceText.textContent = analyzedText || "No readable text or model evidence returned.";
  els.plainExplanation.textContent = explainDecision(displayedResult, analyzedText, imageResult);
  els.explanationStrip.hidden = false;
  currentScan = createScanRecord(displayedResult);
  addHistoryItem(currentScan);

  if (shouldSuggestCloud(displayedResult, analyzedText, imageResult)) {
    els.reasoning.textContent += " Local OCR found little evidence; cloud vision may help if you choose to send this image.";
  }
}

function createScanRecord(result) {
  return {
    id: crypto.randomUUID(),
    severity: result.severity,
    category: result.category,
    message: result.disclosureMessage,
    action: "pending",
    feedback: null,
    time: new Date()
  };
}

function applyDisclosureAction(action) {
  if (!currentScan) return;

  currentScan.action = action;
  currentScan.time = new Date();
  persistScanHistory();

  const actionCopy = {
    continued: {
      heading: "Sharing continued.",
      reason: "You accepted the disclosure risk for this scan."
    },
    restricted: {
      heading: "Sharing restricted.",
      reason: "Move or cover the sensitive item, then capture a new frame before sharing."
    },
    "ai-only": {
      heading: "AI-only mode selected.",
      reason: "Human sharing stays off. Use AI processing only for this sensitive content."
    }
  };

  const copy = actionCopy[action];
  els.disclosureMessage.textContent = copy.heading;
  els.reasoning.textContent = copy.reason;
  els.plainExplanation.textContent = `Choice recorded: ${historyActionLabel(action)}.`;
  els.permissionActions.hidden = true;
  renderHistory();
}

function cancelCurrentScan() {
  if (currentScan) {
    currentScan.action = "cancelled";
    currentScan.time = new Date();
    persistScanHistory();
  }

  selectedImage = null;
  els.preview.replaceChildren(document.createTextNode("No image selected"));
  els.analyzeImageButton.disabled = true;
  els.severity.textContent = "Ready";
  els.severity.dataset.severity = "ready";
  els.disclosureMessage.textContent = "Ready to analyze";
  els.reasoning.textContent = "SightBridge will explain what may be visible before external sharing.";
  els.plainExplanation.textContent = "Scan cancelled.";
  els.evidenceCategory.textContent = "None";
  els.evidenceProcessing.textContent = "Local rules ready";
  els.evidenceText.textContent = "No analysis yet.";
  els.permissionActions.hidden = true;
  renderHistory();
}

function clearLocalData() {
  localStorage.removeItem("sightbridge.scanHistory");
  localStorage.removeItem("sightbridge.preferences");
  scanHistory.splice(0);
  currentScan = null;
  loadPreferences();
  cancelCurrentScan();
  renderHistory();
}

function explainDecision(result, analyzedText, imageResult) {
  const evidence = analyzedText.toLowerCase();

  if (result.severity === "low") {
    if (!analyzedText.trim()) {
      return imageResult?.available
        ? "The image was processed, but no readable sensitive text was found."
        : "No image or text evidence was available for analysis.";
    }
    return "The readable text looks public, generic, or low risk.";
  }

  const evidenceMap = [
    ["financial", "Detected payment, bank, account, routing, or statement-like information."],
    ["medical", "Detected prescription, patient, medication, dosage, or pharmacy-like information."],
    ["identity", "Detected ID, license, name, date-of-birth, or identity-document information."],
    ["address", "Detected street-address or mailing-address style text."],
    ["screen", "Detected private-screen, inbox, login, banking, or authentication-code information."],
    ["personal", "Detected personal contact or correspondence-like information."]
  ];

  const match = evidenceMap.find(([category]) => category === result.category);
  if (match) return match[1];

  if (evidence.includes("visa") || evidence.includes("mastercard")) {
    return "Detected payment card branding or card-like number groups.";
  }

  return "The analysis found text or context that could expose private information if shared.";
}

function addHistoryItem(scan) {
  scanHistory.unshift(scan);
  scanHistory.splice(5);
  persistScanHistory();
  renderHistory();
}

function renderHistory() {
  els.scanHistory.replaceChildren();
  renderMetrics();

  if (scanHistory.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-history";
    empty.textContent = "No scans yet.";
    els.scanHistory.append(empty);
    return;
  }

  for (const item of scanHistory) {
    const row = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `history-dot ${item.severity}`;
    dot.setAttribute("aria-hidden", "true");

    const main = document.createElement("div");
    main.className = "history-main";
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = item.message;
    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${item.severity} / ${item.category} / ${historyActionLabel(item.action)}`;
    main.append(title, meta);

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = new Date(item.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const feedbackActions = document.createElement("div");
    feedbackActions.className = "feedback-actions";
    const falsePositive = document.createElement("button");
    falsePositive.type = "button";
    falsePositive.textContent = item.feedback === "unnecessary" ? "Marked unnecessary" : "Unnecessary alert";
    falsePositive.addEventListener("click", () => markFeedback(item.id, "unnecessary"));
    const falseNegative = document.createElement("button");
    falseNegative.type = "button";
    falseNegative.textContent = item.feedback === "missed" ? "Marked missed" : "Should have alerted";
    falseNegative.addEventListener("click", () => markFeedback(item.id, "missed"));
    feedbackActions.append(falsePositive, falseNegative);

    row.append(dot, main, time, feedbackActions);
    els.scanHistory.append(row);
  }
}

function renderMetrics() {
  const total = scanHistory.length;
  const alerts = scanHistory.filter((item) => item.severity !== "low").length;
  const restricted = scanHistory.filter((item) => item.action === "restricted").length;
  const aiOnly = scanHistory.filter((item) => item.action === "ai-only").length;

  els.metricTotal.textContent = total;
  els.metricAlerts.textContent = alerts;
  els.metricRestricted.textContent = restricted;
  els.metricAiOnly.textContent = aiOnly;
}

function markFeedback(id, feedback) {
  const item = scanHistory.find((scan) => scan.id === id);
  if (!item) return;
  item.feedback = item.feedback === feedback ? null : feedback;
  persistScanHistory();
  renderHistory();
}

function loadScanHistory() {
  const stored = localStorage.getItem("sightbridge.scanHistory");
  if (!stored) return [];

  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function persistScanHistory() {
  localStorage.setItem("sightbridge.scanHistory", JSON.stringify(scanHistory));
}

function historyActionLabel(action) {
  const labels = {
    pending: "pending",
    continued: "continued",
    restricted: "restricted",
    "ai-only": "AI-only",
    cancelled: "cancelled"
  };
  return labels[action] ?? action;
}

function cloudDecisionToResult(decision, fallback) {
  const severity = decision.severity ?? fallback.severity;
  return {
    severity,
    category: decision.category ?? fallback.category,
    action: severity === "high" ? "interrupt_confirm" : severity === "low" ? "none" : "passive_disclosure",
    disclosureMessage: decision.disclosure_message ?? fallback.disclosureMessage,
    reasoning: decision.reasoning ?? fallback.reasoning,
    permissionChoices: severity === "low" ? [] : ["Continue sharing", "Restrict sharing", "AI-only mode", "Cancel"]
  };
}

function selectedAnalysisMode() {
  return document.querySelector("input[name='analysis-mode']:checked")?.value ?? "local";
}

function shouldSuggestCloud(result, analyzedText, imageResult) {
  if (!selectedImage || els.cloudMode.disabled) return false;
  if (selectedAnalysisMode() === "cloud") return false;
  if (imageResult?.cloudDecision) return false;

  const textLength = analyzedText.trim().length;
  return result.severity === "low" && textLength < 40;
}

function cameraErrorMessage(error) {
  const name = error?.name ?? "UnknownError";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied or blocked by the browser. On macOS, check System Settings > Privacy & Security > Camera, then allow Codex or your browser.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. On a Mac without an available camera, use Choose image for testing.";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera exists, but another app may be using it or macOS may be blocking access.";
  }

  if (window.location.protocol !== "https:" && window.location.hostname !== "127.0.0.1" && window.location.hostname !== "localhost") {
    return "Camera access requires HTTPS or localhost. Open the app from http://127.0.0.1:5173/public/.";
  }

  return `Camera failed with ${name}. Use Choose image for now, or check macOS camera permissions.`;
}
