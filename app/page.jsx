"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeDisclosure } from "../src/engine/sensitivityEngine.js";
import { analyzeImageFile } from "../src/engine/imageAnalyzer.js";
import {
  applyPrivacyMode,
  buildTransparency,
  localAssistPrecheck,
  shouldRequestClaude,
  shouldSpeakDisclosure,
  voiceDisclosureFor
} from "../src/engine/assistMode.js";
import scenariosData from "../fixtures/scenarios.json";

const DEFAULT_PREFERENCES = {
  sensitivity: "medium",
  alertCategories: ["financial", "medical", "identity", "address", "screen", "personal"]
};

const EVALUATION_CATEGORIES = ["financial", "medical", "identity", "address", "screen", "personal", "public", "none"];

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
  const assistBusyRef = useRef(false);
  const lastSpokenRef = useRef("");
  const lastClaudePromptAtRef = useRef(0);
  const [config, setConfig] = useState({ cloudVisionAvailable: false, localOcrAvailable: true });
  const [cameraStream, setCameraStream] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLabel, setPreviewLabel] = useState("No image selected");
  const [activeTab, setActiveTab] = useState("review");
  const [mode, setMode] = useState("local");
  const [assistRunning, setAssistRunning] = useState(false);
  const [privacyMode, setPrivacyMode] = useStoredState("sightbridge.privacyMode", "balanced");
  const [speakDisclosures, setSpeakDisclosures] = useStoredState("sightbridge.speakDisclosures", false);
  const [assistDisclosure, setAssistDisclosure] = useState("Assist Mode is ready.");
  const [assistFrameCount, setAssistFrameCount] = useState(0);
  const [transparency, setTransparency] = useState(
    buildTransparency({ localPrecheck: { status: "waiting", evidence: "No assist frame has been scanned yet." } })
  );
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

  useEffect(() => {
    if (!assistRunning || !cameraStream) return;
    analyzeAssistFrame();
    const interval = window.setInterval(() => analyzeAssistFrame(), 3000);
    return () => window.clearInterval(interval);
  }, [assistRunning, cameraStream, privacyMode, speakDisclosures, developerText, config.cloudVisionAvailable]);

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
      wrongCategory: meaningfulHistory.filter((scan) => scan.feedback === "wrong_category").length,
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
      return stream;
    } catch (error) {
      setResult({
        ...EMPTY_RESULT,
        disclosureMessage: "Camera could not be started.",
        reasoning: cameraErrorMessage(error)
      });
      return null;
    }
  }

  async function captureFrame() {
    const file = await captureFrameFile();
    if (!file) return;
    setSelectedImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewLabel("Captured frame");
    setResult({
      ...EMPTY_RESULT,
      disclosureMessage: "Frame captured.",
      reasoning: "Analyze this frame before sharing."
    });
  }

  async function captureFrameFile() {
    if (!cameraStream || !videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return new File([blob], `sightbridge-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
  }

  async function analyzeAssistFrame() {
    if (assistBusyRef.current || !canvasRef.current) return;
    assistBusyRef.current = true;
    try {
      const file = await captureFrameFile();
      if (!file) {
        setAssistDisclosure("Waiting for a camera frame...");
        setTransparency(
          buildTransparency({
            localPrecheck: {
              status: "waiting",
              evidence: "Camera is active, but the video frame is not ready yet."
            }
          })
        );
        return;
      }
      const frameSignal = inspectCanvasSignal(canvasRef.current);
      const localPrecheck = applyPrivacyMode(
        localAssistPrecheck({ text: developerText, hasFrame: Boolean(file), frameSignal }),
        privacyMode
      );

      let claudeRequested = false;
      let claudeCalled = false;
      let displayedResult = assistPrecheckToResult(localPrecheck);
      let evidenceSummary = localPrecheck.evidence;
      let processing = "Assist local pre-check only.";

      if (file && config.cloudVisionAvailable && shouldRequestClaude(localPrecheck, privacyMode)) {
        claudeRequested = true;
        const now = Date.now();
        const canPrompt = now - lastClaudePromptAtRef.current > 10000;
        if (canPrompt) lastClaudePromptAtRef.current = now;
        if (canPrompt && window.confirm("Local scan is unclear. Ask Claude to inspect this frame?")) {
          const imageResult = await analyzeImageFile(file, { mode: "cloud" });
          claudeCalled = imageResult.available !== false;
          if (imageResult.cloudDecision) {
            displayedResult = cloudDecisionToResult(imageResult.cloudDecision, displayedResult);
            evidenceSummary = imageResult.text || imageResult.cloudDecision.evidence || evidenceSummary;
            processing = imageResult.message ?? "Processed with Claude cloud vision after user confirmation.";
          } else if (imageResult.message) {
            processing = imageResult.message;
          }
        }
      }

      const disclosure = displayedResult.reasoning || voiceDisclosureFor(displayedResult);
      setAssistFrameCount((count) => count + 1);
      setAssistDisclosure(displayedResult.disclosureMessage || disclosure);
      setResult(displayedResult);
      setEvidence({
        processing,
        text: evidenceSummary,
        why: explainDecision(displayedResult, evidenceSummary, { available: true })
      });
      setTransparency(
        buildTransparency({
          localPrecheck,
          claudeRequested,
          claudeCalled,
          category: displayedResult.category,
          evidenceSummary
        })
      );

      addHistory(displayedResult, {
        source: "assist_frame",
        previewLabel: "Assist frame",
        processing,
        evidenceSummary,
        assistMode: true,
        privacyMode,
        localPrecheck: localPrecheck.status,
        claudeRequested,
        claudeCalled,
        spokenDisclosure: speakDisclosures,
        sentToCloudSummary: claudeCalled
          ? "One confirmed camera frame was sent to Claude. The frame itself was not stored."
          : "No camera frame was sent to Claude."
      });

      maybeSpeak(displayedResult.disclosureMessage || disclosure, speakDisclosures, lastSpokenRef);
    } finally {
      assistBusyRef.current = false;
    }
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
      expectedCategory: "",
      source: details.source ?? "unknown",
      label: details.previewLabel ?? previewLabel,
      processing: details.processing ?? "Unknown",
      evidenceSummary: details.evidenceSummary ?? "",
      sensitivity: preferences.sensitivity,
      alertCategories: preferences.alertCategories,
      assistMode: Boolean(details.assistMode),
      privacyMode: details.privacyMode ?? "",
      localPrecheck: details.localPrecheck ?? "",
      claudeRequested: Boolean(details.claudeRequested),
      claudeCalled: Boolean(details.claudeCalled),
      spokenDisclosure: Boolean(details.spokenDisclosure),
      sentToCloudSummary: details.sentToCloudSummary ?? "",
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

  function markFeedback(id, feedback, expectedCategory = "") {
    setHistory((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const isToggleOff = item.feedback === feedback && feedback !== "wrong_category";
        return {
          ...item,
          feedback: isToggleOff ? null : feedback,
          expectedCategory:
            feedback === "wrong_category" ? expectedCategory || item.expectedCategory || item.category || "" : ""
        };
      })
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

  async function toggleAssistMode() {
    if (assistRunning) {
      setAssistRunning(false);
      setAssistDisclosure("Assist Mode paused.");
      return;
    }

    setActiveTab("assist");
    setAssistDisclosure("Starting camera...");
    const stream = cameraStream ?? (await startCamera());
    if (!stream && !cameraStream) {
      setAssistDisclosure("Camera could not be started.");
      return;
    }
    setAssistRunning(true);
    setAssistDisclosure("Waiting for a camera frame...");
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

        <nav className="mode-tabs" aria-label="SightBridge mode">
          <button type="button" className={activeTab === "review" ? "active" : ""} onClick={() => setActiveTab("review")}>
            Review
          </button>
          <button type="button" className={activeTab === "assist" ? "active" : ""} onClick={() => setActiveTab("assist")}>
            Assist
          </button>
        </nav>

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

        {activeTab === "review" ? (
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
        ) : (
          <AssistPanel
            running={assistRunning}
            canRun={Boolean(cameraStream)}
            privacyMode={privacyMode}
            setPrivacyMode={setPrivacyMode}
            speakDisclosures={speakDisclosures}
            setSpeakDisclosures={setSpeakDisclosures}
            disclosure={assistDisclosure}
            frameCount={assistFrameCount}
            transparency={transparency}
            onToggle={toggleAssistMode}
          />
        )}

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

        {activeTab === "review" ? (
          <>
            <Preferences preferences={preferences} setPreferences={setPreferences} />
            <Samples samples={samples} onRun={(scenario) => analyze({ scenario })} />
          </>
        ) : null}
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

function AssistPanel({
  running,
  canRun,
  privacyMode,
  setPrivacyMode,
  speakDisclosures,
  setSpeakDisclosures,
  disclosure,
  frameCount,
  transparency,
  onToggle
}) {
  return (
    <section className="assist-panel" aria-label="Real-time assist mode">
      <div className="section-head compact-head">
        <div>
          <p className="kicker">Assist Mode</p>
          <h2>Real-time privacy assist</h2>
        </div>
        <span className={`privacy-chip ${running ? "live-chip" : ""}`}>{running ? "Scanning every 3s" : "Paused"}</span>
      </div>
      <div className="assist-disclosure">
        <span>Voice-style disclosure</span>
        <strong>{disclosure}</strong>
      </div>
      <div className="assist-controls">
        <button className="button primary" type="button" onClick={onToggle}>
          {running ? "Pause assist" : canRun ? "Start assist" : "Start camera + assist"}
        </button>
        <label className="field compact">
          <span>Privacy mode</span>
          <select value={privacyMode} onChange={(event) => setPrivacyMode(event.target.value)}>
            <option value="strict">Strict</option>
            <option value="balanced">Balanced</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </label>
        <label className="assist-toggle">
          <input
            type="checkbox"
            checked={speakDisclosures}
            onChange={(event) => setSpeakDisclosures(event.target.checked)}
          />{" "}
          Speak disclosures
        </label>
      </div>
      <TransparencyPanel transparency={transparency} frameCount={frameCount} />
    </section>
  );
}

function TransparencyPanel({ transparency, frameCount }) {
  return (
    <section className="transparency-panel" aria-label="What got sent">
      <div className="section-head compact-head">
        <div>
          <p className="kicker">Transparency</p>
          <h2>What got sent?</h2>
        </div>
        <span className="privacy-chip">{frameCount} frames</span>
      </div>
      <dl>
        <div>
          <dt>Local scan</dt>
          <dd>{transparency.localScanResult}</dd>
        </div>
        <div>
          <dt>Claude requested</dt>
          <dd>{transparency.claudeRequested ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Claude called</dt>
          <dd>{transparency.claudeCalled ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{labelForCategory(transparency.category)}</dd>
        </div>
        <div className="wide-row">
          <dt>Redacted evidence</dt>
          <dd>{transparency.redactedEvidence}</dd>
        </div>
        <div className="wide-row">
          <dt>Not stored</dt>
          <dd>{transparency.notStored}</dd>
        </div>
        <div>
          <dt>Frame storage</dt>
          <dd>{transparency.frameStorage}</dd>
        </div>
      </dl>
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
  return (
    <div className="result-feedback" aria-label="Result feedback">
      <div>
        <span>Feedback</span>
        <strong>Was this result right?</strong>
      </div>
      <FeedbackControls scan={scan} onFeedback={onFeedback} inline />
    </div>
  );
}

function FeedbackControls({ scan, onFeedback, inline = false }) {
  const options = [
    ["correct", "Correct"],
    ["unnecessary", "Unnecessary alert"],
    ["missed", "Should have alerted"],
    ["wrong_category", "Wrong category"]
  ];
  const selectedExpectedCategory = scan.expectedCategory || scan.category || "";

  return (
    <div className={`feedback-control ${inline ? "inline-feedback" : ""}`}>
      <div className="feedback-actions">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scan.feedback === value ? "selected-feedback" : ""}
            aria-pressed={scan.feedback === value}
            onClick={() => onFeedback(scan.id, value, selectedExpectedCategory)}
          >
            {scan.feedback === value ? `Marked: ${label}` : label}
          </button>
        ))}
      </div>
      {scan.feedback === "wrong_category" ? (
        <label className="expected-category">
          <span>Expected category</span>
          <select value={selectedExpectedCategory} onChange={(event) => onFeedback(scan.id, "wrong_category", event.target.value)}>
            {EVALUATION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {labelForCategory(category)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
            {metrics.correct} correct / {metrics.unnecessary} unnecessary / {metrics.missed} missed / {metrics.wrongCategory} wrong category
          </strong>
        </div>
        <div>
          <span>Restricted shares</span>
          <strong>{metrics.restricted}</strong>
        </div>
      </div>
      <EvaluationSummary history={history} metrics={metrics} />
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
                {item.feedback ? (
                  <span className="feedback-chip">
                    {feedbackLabel(item.feedback)}
                    {item.feedback === "wrong_category" && item.expectedCategory
                      ? `: ${labelForCategory(item.expectedCategory)}`
                      : ""}
                  </span>
                ) : null}
              </div>
              <span className="history-time">
                {new Date(item.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              <FeedbackControls scan={item} onFeedback={onFeedback} />
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

function EvaluationSummary({ history, metrics }) {
  const meaningful = history.filter(isMeaningfulScan);
  const reviewed = meaningful.filter((item) => item.feedback);
  const accuracy = reviewed.length === 0 ? 0 : Math.round((metrics.correct / reviewed.length) * 100);
  const groups = EVALUATION_CATEGORIES.map((category) => ({
    category,
    total: meaningful.filter((item) => item.category === category).length
  })).filter((group) => group.total > 0);
  const needsTuning = meaningful.filter((item) => ["unnecessary", "missed", "wrong_category"].includes(item.feedback)).slice(0, 4);

  return (
    <section className="evaluation-summary" aria-label="Evaluation summary">
      <div className="summary-stat">
        <span>Accuracy</span>
        <strong>{reviewed.length ? `${accuracy}%` : "No feedback yet"}</strong>
      </div>
      <div className="summary-stat">
        <span>False alarms</span>
        <strong>{metrics.unnecessary}</strong>
      </div>
      <div className="summary-stat">
        <span>Missed alerts</span>
        <strong>{metrics.missed}</strong>
      </div>
      <div className="summary-stat">
        <span>Wrong category</span>
        <strong>{metrics.wrongCategory}</strong>
      </div>
      <div className="summary-wide">
        <span>Results by category</span>
        <p>{groups.length ? groups.map((group) => `${labelForCategory(group.category)} ${group.total}`).join(" / ") : "No evaluated scans yet."}</p>
      </div>
      <div className="summary-wide">
        <span>Needs tuning</span>
        <p>
          {needsTuning.length
            ? needsTuning.map((item) => `${item.label || item.category}: ${feedbackLabel(item.feedback)}`).join(" / ")
            : "No tuning issues marked yet."}
        </p>
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
    expectedCategory: item.expectedCategory ?? "",
    processing: item.processing ?? "",
    evidenceSummary: item.evidenceSummary ?? "",
    sensitivity: item.sensitivity ?? "",
    alertCategories: (item.alertCategories ?? []).join("|"),
    assistMode: Boolean(item.assistMode),
    privacyMode: item.privacyMode ?? "",
    localPrecheck: item.localPrecheck ?? "",
    claudeRequested: Boolean(item.claudeRequested),
    claudeCalled: Boolean(item.claudeCalled),
    spokenDisclosure: Boolean(item.spokenDisclosure),
    sentToCloudSummary: item.sentToCloudSummary ?? ""
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

function assistPrecheckToResult(precheck) {
  const severity = precheck.severity ?? "uncertain";
  return {
    severity,
    category: precheck.category ?? "none",
    action: severity === "high" || precheck.status === "risky" ? "interrupt_confirm" : severity === "low" ? "none" : "ask_if_proceed",
    disclosureMessage: precheck.disclosure,
    reasoning: precheck.evidence,
    permissionChoices: severity === "low" ? [] : ["Continue sharing", "Restrict sharing", "AI-only mode"]
  };
}

function inspectCanvasSignal(canvas) {
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) return "unknown";
  const sampleWidth = Math.min(canvas.width, 96);
  const sampleHeight = Math.min(canvas.height, 54);
  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let min = 255;
  let max = 0;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722);
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }
  return max - min < 18 ? "blank" : "unknown";
}

function maybeSpeak(disclosure, speakEnabled, lastSpokenRef) {
  if (
    shouldSpeakDisclosure({
      speakEnabled,
      lastSpoken: lastSpokenRef.current,
      nextDisclosure: disclosure
    }) &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window
  ) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(disclosure));
    lastSpokenRef.current = disclosure;
  }
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
    missed: "Should have alerted",
    wrong_category: "Wrong category"
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
    personal: "Personal docs",
    public: "Public"
  }[category];
}
