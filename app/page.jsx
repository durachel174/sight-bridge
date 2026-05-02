"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeDisclosure } from "../src/engine/sensitivityEngine.js";
import { analyzeImageFile } from "../src/engine/imageAnalyzer.js";
import scenariosData from "../fixtures/scenarios.json";

const DEFAULT_PREFERENCES = {
  sensitivity: "medium",
  alertCategories: ["financial", "medical", "identity", "address", "screen", "personal"]
};

const EMPTY_RESULT = {
  severity: "ready",
  category: "none",
  disclosureMessage: "Ready to analyze",
  reasoning: "SightBridge will explain what may be visible before external sharing.",
  permissionChoices: []
};

const IMAGE_ANALYSIS_BLOCKED_RESULT = {
  severity: "uncertain",
  category: "none",
  action: "passive_disclosure",
  disclosureMessage: "Image analysis did not run.",
  reasoning:
    "SightBridge could not inspect the image, so it cannot safely say whether sensitive information is visible.",
  permissionChoices: ["Continue sharing", "Restrict sharing", "AI-only mode"]
};

export default function SightBridgeApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [config, setConfig] = useState({ cloudVisionAvailable: false, localOcrAvailable: true });
  const [cameraStream, setCameraStream] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLabel, setPreviewLabel] = useState("No image selected");
  const [mode, setMode] = useState("local");
  const [preferences, setPreferences] = useStoredState("sightbridge.preferences", DEFAULT_PREFERENCES);
  const [history, setHistory] = useStoredState("sightbridge.scanHistory", []);
  const [scenarios] = useState(scenariosData);
  const [developerText, setDeveloperText] = useState("");
  const [result, setResult] = useState(EMPTY_RESULT);
  const [evidence, setEvidence] = useState({
    processing: "Local rules ready",
    text: "No analysis yet.",
    why: "No analysis yet."
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((nextConfig) => {
        setConfig(nextConfig);
        if (nextConfig.localOcrAvailable === false && nextConfig.cloudVisionAvailable) {
          setMode("cloud");
        }
      })
      .catch(() => setConfig({ cloudVisionAvailable: false, localOcrAvailable: false }));

  }, []);

  const samples = useMemo(() => {
    const ids = new Set([12, 6, 5, 7]);
    return scenarios.filter((scenario) => ids.has(scenario.id));
  }, [scenarios]);

  const metrics = useMemo(() => {
    const meaningfulHistory = history.filter(isMeaningfulScan);
    const categoryCounts = meaningfulHistory.reduce((counts, scan) => {
      if (scan.category && scan.category !== "none") counts[scan.category] = (counts[scan.category] ?? 0) + 1;
      return counts;
    }, {});
    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";

    return {
      total: meaningfulHistory.length,
      alerts: meaningfulHistory.filter((scan) => scan.severity !== "low").length,
      continued: meaningfulHistory.filter((scan) => scan.action === "continued").length,
      restricted: meaningfulHistory.filter((scan) => scan.action === "restricted").length,
      aiOnly: meaningfulHistory.filter((scan) => scan.action === "ai-only").length,
      correct: meaningfulHistory.filter((scan) => scan.feedback === "correct").length,
      unnecessary: meaningfulHistory.filter((scan) => scan.feedback === "unnecessary").length,
      missed: meaningfulHistory.filter((scan) => scan.feedback === "missed").length,
      topCategory
    };
  }, [history]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setResult({
        ...EMPTY_RESULT,
        disclosureMessage: "Camera is not available in this browser.",
        reasoning: "Use image import for now. Some embedded browsers do not expose camera access."
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setResult({
        ...EMPTY_RESULT,
        disclosureMessage: "Camera is active.",
        reasoning: "Capture a frame when you want SightBridge to run disclosure analysis."
      });
    } catch (error) {
      setResult({
        ...EMPTY_RESULT,
        disclosureMessage: "Camera could not be started.",
        reasoning: cameraErrorMessage(error)
      });
    }
  }

  async function captureFrame() {
    if (!cameraStream || !videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    const file = new File([blob], `sightbridge-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    setSelectedImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewLabel("Captured frame");
    setResult({
      ...EMPTY_RESULT,
      disclosureMessage: "Frame captured.",
      reasoning: "Analyze this frame before sharing."
    });
  }

  function chooseImage(event) {
    const [file] = event.target.files ?? [];
    if (!file) return;
    setSelectedImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewLabel(file.name);
    setResult({
      ...EMPTY_RESULT,
      disclosureMessage: "Image selected.",
      reasoning: "Analyze the image to check for visible sensitive information."
    });
  }

  async function analyze({ scenario } = {}) {
    const effectiveMode = selectedImage && config.localOcrAvailable === false && config.cloudVisionAvailable ? "cloud" : mode;

    if (effectiveMode === "cloud" && selectedImage) {
      const approved = window.confirm("Cloud vision sends this image to Claude for analysis. Continue?");
      if (!approved) return;
    }

    setIsAnalyzing(true);
    try {
      let imageResult = { text: "", message: "Local text rules" };
      let text = developerText;

      if (scenario) {
        text = scenario.prototypeText;
        setDeveloperText(scenario.prototypeText);
        setPreviewUrl("");
        setPreviewLabel(scenario.scene);
      } else if (selectedImage) {
        imageResult = await analyzeImageFile(selectedImage, { mode: effectiveMode });
        if (imageResult.available === false) {
          const blockedResult = {
            ...IMAGE_ANALYSIS_BLOCKED_RESULT,
            reasoning: imageResult.message || IMAGE_ANALYSIS_BLOCKED_RESULT.reasoning
          };
          setResult(blockedResult);
          setEvidence({
            processing: imageResult.message ?? "Image analysis unavailable",
            text: "No model analysis was returned.",
            why: "The image was not analyzed, so a no-disclosure result would be unsafe."
          });
          addHistory(blockedResult, {
            source: selectedImage ? "image_upload" : "manual_text",
            previewLabel,
            processing: imageResult.message ?? "Image analysis unavailable",
            evidenceSummary: "No model analysis was returned."
          });
          return;
        }
        text = [developerText, imageResult.text].filter(Boolean).join("\n");
      }

      const localResult = await analyzeDisclosure({ text, preferences });
      const displayedResult = imageResult.cloudDecision
        ? cloudDecisionToResult(imageResult.cloudDecision, localResult)
        : localResult;

      setResult(displayedResult);
      setEvidence({
        processing: imageResult.message ?? "Local text rules",
        text: text || "No readable text or model evidence returned.",
        why: explainDecision(displayedResult, text, imageResult)
      });

      addHistory(displayedResult, {
        source: scenario ? "sample_scan" : selectedImage ? "image_upload" : developerText ? "manual_text" : "empty_scan",
        previewLabel: scenario?.scene ?? previewLabel,
        processing: imageResult.message ?? "Local text rules",
        evidenceSummary: text || "No readable text or model evidence returned."
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  function addHistory(nextResult, details = {}) {
    const scan = {
      id: crypto.randomUUID(),
      severity: nextResult.severity,
      category: nextResult.category,
      message: nextResult.disclosureMessage,
      reasoning: nextResult.reasoning,
      action: "pending",
      feedback: null,
      source: details.source ?? "unknown",
      label: details.previewLabel ?? previewLabel,
      processing: details.processing ?? "Unknown",
      evidenceSummary: details.evidenceSummary ?? "",
      sensitivity: preferences.sensitivity,
      alertCategories: preferences.alertCategories,
      time: new Date().toISOString()
    };
    setHistory((items) => [scan, ...items].slice(0, 20));
  }

  function applyAction(action) {
    setHistory((items) => {
      if (items.length === 0) return items;
      const [first, ...rest] = items;
      return [{ ...first, action, time: new Date().toISOString() }, ...rest];
    });

    const copy = {
      continued: ["Sharing continued.", "You accepted the disclosure risk for this scan."],
      restricted: ["Sharing restricted.", "Move or cover the sensitive item, then capture a new frame before sharing."],
      "ai-only": ["AI-only mode selected.", "Human sharing stays off. Use AI processing only for this sensitive content."]
    }[action];

    setResult((current) => ({ ...current, disclosureMessage: copy[0], reasoning: copy[1], permissionChoices: [] }));
    setEvidence((current) => ({ ...current, why: `Choice recorded: ${historyActionLabel(action)}.` }));
  }

  function cancelCurrentScan() {
    setSelectedImage(null);
    setPreviewUrl("");
    setPreviewLabel("No image selected");
    setResult(EMPTY_RESULT);
    setEvidence({ processing: "Local rules ready", text: "No analysis yet.", why: "Scan cancelled." });
    setHistory((items) => {
      if (items.length === 0) return items;
      const [first, ...rest] = items;
      return [{ ...first, action: "cancelled", time: new Date().toISOString() }, ...rest];
    });
  }

  function clearLocalData() {
    localStorage.removeItem("sightbridge.scanHistory");
    localStorage.removeItem("sightbridge.preferences");
    setHistory([]);
    setPreferences(DEFAULT_PREFERENCES);
    cancelCurrentScan();
  }

  function markFeedback(id, feedback) {
    setHistory((items) =>
      items.map((item) => (item.id === id ? { ...item, feedback: item.feedback === feedback ? null : feedback } : item))
    );
  }

  function exportHistory(format) {
    if (history.length === 0) return;
    const rows = history.filter(isMeaningfulScan).map(toEvaluationRow);
    if (rows.length === 0) return;
    const content = format === "csv" ? rowsToCsv(rows) : JSON.stringify(rows, null, 2);
    const mime = format === "csv" ? "text/csv" : "application/json";
    const extension = format === "csv" ? "csv" : "json";
    downloadTextFile(content, `sightbridge-evaluation-${new Date().toISOString().slice(0, 10)}.${extension}`, mime);
  }

  return (
    <main className="shell">
      <section className="workspace" aria-labelledby="app-title">
        <header className="masthead">
          <div>
            <p className="eyebrow">Privacy preview</p>
            <h1 id="app-title">SightBridge</h1>
            <p className="tagline">Check what a camera or shared image may reveal before anyone else sees it.</p>
          </div>
          <div className="status-stack" aria-label="System status">
            <div className="status-pill">{config.cloudVisionProvider ?? "Cloud vision"}</div>
            <div className="status-pill muted-pill">{evidence.processing}</div>
          </div>
        </header>

        <section className="camera-panel" aria-label="Camera capture">
          <div className="section-head">
            <div>
              <p className="kicker">Live scan</p>
              <h2>Camera</h2>
            </div>
            <span className="privacy-chip">{config.cloudVisionAvailable ? "Claude ready" : "Cloud offline"}</span>
          </div>
          <div className="camera-frame">
            <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
            <div className="viewfinder-mark top-left" />
            <div className="viewfinder-mark top-right" />
            <div className="viewfinder-mark bottom-left" />
            <div className="viewfinder-mark bottom-right" />
          </div>
          <canvas ref={canvasRef} hidden />
          <div className="controls">
            <button className="button primary" type="button" onClick={startCamera}>
              {cameraStream ? "Camera active" : "Start camera"}
            </button>
            <button className="button secondary" type="button" disabled={!cameraStream} onClick={captureFrame}>
              Capture frame
            </button>
          </div>
        </section>

        <section className="capture-panel" aria-label="Scene input">
          <div className="section-head compact-head">
            <div>
              <p className="kicker">Image check</p>
              <h2>Upload</h2>
            </div>
          </div>
          <div className="preview">
            {previewUrl ? <img src={previewUrl} alt="Selected scene preview" /> : <span>{previewLabel}</span>}
          </div>
          <div className="controls">
            <label className="button secondary">
              <input ref={fileRef} type="file" accept="image/*" onChange={chooseImage} />
              Choose image
            </label>
            <button className="button secondary" type="button" disabled={!selectedImage || isAnalyzing} onClick={() => analyze()}>
              {isAnalyzing ? "Analyzing..." : "Analyze image"}
            </button>
          </div>
        </section>

        <section className="settings-panel" aria-label="Alert settings">
          <div className="section-head compact-head">
            <div>
              <p className="kicker">Privacy</p>
              <h2>Detection</h2>
            </div>
          </div>
          <fieldset>
            <legend>Analysis mode</legend>
            <label>
              <input
                type="radio"
                name="analysis-mode"
                value="local"
                checked={mode === "local"}
                disabled={config.localOcrAvailable === false}
                onChange={() => setMode("local")}
              />{" "}
              Local OCR first
            </label>
            <label>
              <input
                type="radio"
                name="analysis-mode"
                value="cloud"
                checked={mode === "cloud"}
                disabled={!config.cloudVisionAvailable}
                onChange={() => setMode("cloud")}
              />{" "}
              Cloud vision
            </label>
          </fieldset>
          <button className="button primary" type="button" disabled={isAnalyzing || (!selectedImage && !developerText)} onClick={() => analyze()}>
            {isAnalyzing ? "Analyzing..." : "Run check"}
          </button>
        </section>

        <Preferences preferences={preferences} setPreferences={setPreferences} />
        <Samples samples={samples} onRun={(scenario) => analyze({ scenario })} />
        <ResultPanel
          result={result}
          evidence={evidence}
          latestScan={history[0]}
          onAction={applyAction}
          onFeedback={markFeedback}
        />
        <HistoryPanel
          history={history}
          metrics={metrics}
          onFeedback={markFeedback}
          onExport={exportHistory}
          onClearCurrent={cancelCurrentScan}
          onClearLocal={clearLocalData}
        />
        <PrivacyNote />
      </section>
    </main>
  );
}

function Preferences({ preferences, setPreferences }) {
  const categories = ["financial", "medical", "identity", "address", "screen", "personal"];
  return (
    <section className="preferences-panel" aria-label="Disclosure preferences">
      <div className="section-head compact-head">
        <div>
          <p className="kicker">Preferences</p>
          <h2>What should interrupt?</h2>
        </div>
      </div>
      <label className="field compact">
        <span>Sensitivity</span>
        <select
          value={preferences.sensitivity}
          onChange={(event) => setPreferences({ ...preferences, sensitivity: event.target.value })}
        >
          <option value="medium">Balanced</option>
          <option value="low">Quiet</option>
          <option value="high">Careful</option>
        </select>
      </label>
      <fieldset className="preference-grid">
        <legend>Alert me about</legend>
        {categories.map((category) => (
          <label key={category}>
            <input
              type="checkbox"
              checked={preferences.alertCategories.includes(category)}
              onChange={() => {
                const next = preferences.alertCategories.includes(category)
                  ? preferences.alertCategories.filter((item) => item !== category)
                  : [...preferences.alertCategories, category];
                setPreferences({ ...preferences, alertCategories: next });
              }}
            />{" "}
            {labelForCategory(category)}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function Samples({ samples, onRun }) {
  return (
    <section className="samples-panel" aria-label="Sample scans">
      <div className="section-head compact-head">
        <div>
          <p className="kicker">Calibration</p>
          <h2>Sample checks</h2>
        </div>
      </div>
      <div className="sample-list">
        {samples.map((scenario) => (
          <button key={scenario.id} className="sample-card" type="button" onClick={() => onRun(scenario)}>
            <strong>{scenario.scene}</strong>
            <span>Expected: {scenario.expectedSensitivity}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultPanel({ result, evidence, latestScan, onAction, onFeedback }) {
  const showActions = result.permissionChoices?.length > 0;
  const canGiveFeedback = latestScan && result.severity !== "ready";
  return (
    <section className="result-panel" data-severity={result.severity} aria-live="polite" aria-label="Disclosure result">
      <div className="result-topline">
        <p className="kicker">Result</p>
        <div className="severity" data-severity={result.severity}>
          {result.severity}
        </div>
      </div>
      <h2>{result.disclosureMessage}</h2>
      <p>{result.reasoning}</p>
      <div className="explanation-strip">
        <span>Why</span>
        <p>{evidence.why}</p>
      </div>
      <ReviewTimeline result={result} latestScan={latestScan} />
      {canGiveFeedback ? <FeedbackPanel scan={latestScan} onFeedback={onFeedback} /> : null}
      <details className="evidence-panel">
        <summary>Detected evidence</summary>
        <dl>
          <div>
            <dt>Category</dt>
            <dd>{result.category}</dd>
          </div>
          <div>
            <dt>Processing</dt>
            <dd>{evidence.processing}</dd>
          </div>
          <div>
            <dt>Safe evidence summary</dt>
            <dd>
              <pre>{evidence.text}</pre>
            </dd>
          </div>
        </dl>
      </details>
      {showActions ? (
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => onAction("continued")}>
            Continue sharing
          </button>
          <button className="button secondary" type="button" onClick={() => onAction("restricted")}>
            Restrict sharing
          </button>
          <button className="button secondary" type="button" onClick={() => onAction("ai-only")}>
            AI-only mode
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FeedbackPanel({ scan, onFeedback }) {
  const options = [
    ["correct", "Correct"],
    ["unnecessary", "Unnecessary alert"],
    ["missed", "Should have alerted"]
  ];

  return (
    <div className="result-feedback" aria-label="Result feedback">
      <div>
        <span>Feedback</span>
        <strong>Was this result right?</strong>
      </div>
      <div className="feedback-actions inline-feedback">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scan.feedback === value ? "selected-feedback" : ""}
            aria-pressed={scan.feedback === value}
            onClick={() => onFeedback(scan.id, value)}
          >
            {scan.feedback === value ? `Marked: ${label}` : label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewTimeline({ result, latestScan }) {
  const hasScan = latestScan && result.severity !== "ready";
  const steps = [
    {
      label: "Imported",
      detail: hasScan ? latestScan.label || sourceLabel(latestScan.source) : "Waiting for an image, camera frame, or sample.",
      status: hasScan ? "done" : "idle"
    },
    {
      label: "Analyzed",
      detail: hasScan ? latestScan.processing : "No analysis has run yet.",
      status: hasScan ? "done" : "idle"
    },
    {
      label: "Disclosure",
      detail: hasScan ? `${severityLabel(latestScan.severity)} ${labelForCategory(latestScan.category)}` : "No disclosure decision yet.",
      status: hasScan ? (latestScan.severity === "low" ? "done" : "attention") : "idle"
    },
    {
      label: "User choice",
      detail: hasScan ? historyActionLabel(latestScan.action) : "No choice recorded.",
      status: hasScan && latestScan.action !== "pending" ? "done" : "idle"
    }
  ];

  return (
    <div className="review-timeline" aria-label="Review timeline">
      {steps.map((step) => (
        <div key={step.label} className="timeline-step" data-status={step.status}>
          <span aria-hidden="true" />
          <div>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryPanel({ history, metrics, onFeedback, onExport, onClearCurrent, onClearLocal }) {
  return (
    <section className="history-panel" aria-label="Recent scans">
      <div className="section-head compact-head">
        <div>
          <p className="kicker">Recent</p>
          <h2>Scan history</h2>
        </div>
      </div>
      <div className="metrics-grid" aria-label="Scan metrics">
        <Metric value={metrics.total} label="Total" />
        <Metric value={metrics.alerts} label="Alerts" />
        <Metric value={metrics.continued} label="Approved" />
        <Metric value={metrics.aiOnly} label="AI-only" />
      </div>
      <div className="session-summary">
        <div>
          <span>Most common category</span>
          <strong>{labelForCategory(metrics.topCategory)}</strong>
        </div>
        <div>
          <span>Feedback</span>
          <strong>
            {metrics.correct} correct / {metrics.unnecessary} unnecessary / {metrics.missed} missed
          </strong>
        </div>
        <div>
          <span>Restricted shares</span>
          <strong>{metrics.restricted}</strong>
        </div>
      </div>
      <div className="evaluation-toolbar">
        <p>Export scan results for prompt tuning. Images are not saved.</p>
        <div>
          <button type="button" disabled={history.length === 0} onClick={() => onExport("json")}>
            Export JSON
          </button>
          <button type="button" disabled={history.length === 0} onClick={() => onExport("csv")}>
            Export CSV
          </button>
        </div>
      </div>
      <ol className="scan-history">
        {history.length === 0 ? (
          <li className="empty-history">No scans yet.</li>
        ) : (
          history.map((item) => (
            <li key={item.id}>
              <span className={`history-dot ${item.severity}`} aria-hidden="true" />
              <div className="history-main">
                <p className="history-title">{item.message}</p>
                <span className="history-meta">
                  {item.severity} / {item.category} / {historyActionLabel(item.action)}
                </span>
                {item.feedback ? <span className="feedback-chip">{feedbackLabel(item.feedback)}</span> : null}
              </div>
              <span className="history-time">
                {new Date(item.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              <div className="feedback-actions">
                <button type="button" onClick={() => onFeedback(item.id, "correct")}>
                  {item.feedback === "correct" ? "Marked correct" : "Correct"}
                </button>
                <button type="button" onClick={() => onFeedback(item.id, "unnecessary")}>
                  {item.feedback === "unnecessary" ? "Marked unnecessary" : "Unnecessary alert"}
                </button>
                <button type="button" onClick={() => onFeedback(item.id, "missed")}>
                  {item.feedback === "missed" ? "Marked missed" : "Should have alerted"}
                </button>
              </div>
            </li>
          ))
        )}
      </ol>
      <div className="controls utility-controls">
        <button className="button ghost" type="button" onClick={onClearCurrent}>
          Clear current scan
        </button>
        <button className="button ghost" type="button" onClick={onClearLocal}>
          Clear local data
        </button>
      </div>
    </section>
  );
}

function Metric({ value, label }) {
  return (
    <div>
      <span>{value}</span>
      <p>{label}</p>
    </div>
  );
}

function PrivacyNote() {
  return (
    <section className="privacy-note" aria-label="Privacy note">
      <p className="kicker">Privacy note</p>
      <p>
        Local OCR runs through this device/server. Cloud vision is off unless you configure Claude and approve sending an image.
        Preferences, history, and feedback stay in this browser.
      </p>
    </section>
  );
}

function toEvaluationRow(item) {
  return {
    id: item.id,
    time: item.time,
    source: item.source ?? "unknown",
    label: item.label ?? "",
    severity: item.severity,
    category: item.category,
    message: item.message,
    reasoning: item.reasoning ?? "",
    action: item.action,
    feedback: item.feedback ?? "",
    processing: item.processing ?? "",
    evidenceSummary: item.evidenceSummary ?? "",
    sensitivity: item.sensitivity ?? "",
    alertCategories: (item.alertCategories ?? []).join("|")
  };
}

function isMeaningfulScan(item) {
  return Boolean(
    item &&
      item.source !== "unknown" &&
      (item.label || item.message || item.reasoning || item.evidenceSummary || item.processing)
  );
}

function rowsToCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))].join("\n");
}

function downloadTextFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function useStoredState(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
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
  if (evidence.includes("visa") || evidence.includes("mastercard")) return "Detected payment card branding or card-like number groups.";
  return "The analysis found text or context that could expose private information if shared.";
}

function cloudDecisionToResult(decision, fallback) {
  const severity = decision.severity ?? fallback.severity;
  return {
    severity,
    category: decision.category ?? fallback.category,
    action: severity === "high" ? "interrupt_confirm" : severity === "low" ? "none" : "passive_disclosure",
    disclosureMessage: decision.disclosure_message ?? fallback.disclosureMessage,
    reasoning: decision.reasoning ?? fallback.reasoning,
    permissionChoices: severity === "low" ? [] : ["Continue sharing", "Restrict sharing", "AI-only mode"]
  };
}

function cameraErrorMessage(error) {
  const name = error?.name ?? "UnknownError";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was denied or blocked by the browser.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. Use image import for testing.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera exists, but another app may be using it.";
  return `Camera failed with ${name}. Use image import for now.`;
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

function sourceLabel(source) {
  return {
    image_upload: "Image upload",
    sample_scan: "Sample scan",
    manual_text: "Manual text",
    empty_scan: "Empty scan"
  }[source] ?? "Scan input";
}

function severityLabel(severity) {
  return {
    high: "High-risk",
    medium: "Medium-risk",
    uncertain: "Uncertain",
    low: "Low-risk",
    ready: "Ready"
  }[severity] ?? severity;
}

function feedbackLabel(feedback) {
  return {
    correct: "Correct",
    unnecessary: "Unnecessary alert",
    missed: "Should have alerted"
  }[feedback] ?? feedback;
}

function labelForCategory(category) {
  return {
    none: "None",
    financial: "Financial",
    medical: "Medical",
    identity: "Identity",
    address: "Address",
    screen: "Screens",
    personal: "Personal docs"
  }[category];
}
