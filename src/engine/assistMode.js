const RISK_TERMS = [
  ["financial", /\b(?:visa|mastercard|amex|discover|credit|debit|bank|routing|account|paystub|w-?2)\b/i],
  ["medical", /\b(?:rx|prescription|patient|medicine|medication|dosage|pharmacy|tablet|capsule)\b/i],
  ["identity", /\b(?:driver'?s?\s+license|passport|government\s+id|state\s+id|student\s+id|dob|date\s+of\s+birth)\b/i],
  ["address", /\b\d{1,6}\s+[a-z0-9 .'-]+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|way)\b/i],
  ["screen", /\b(?:inbox|message|login|password|verification|auth|dashboard|email|chat)\b/i]
];

export function localAssistPrecheck({ text = "", hasFrame = false, frameSignal = "unknown" } = {}) {
  const trimmed = text.trim();
  if (trimmed) {
    const term = RISK_TERMS.find(([, pattern]) => pattern.test(trimmed));
    if (term) {
      return {
        status: "risky",
        severity: "high",
        category: term[0],
        disclosure: voiceDisclosureFor({ severity: "high", category: term[0] }),
        evidence: "Local text pre-check found sensitive-looking terms before any cloud call."
      };
    }

    return {
      status: "safe",
      severity: "low",
      category: "public",
      disclosure: "Safe to describe: public or ordinary text.",
      evidence: "Local text pre-check did not find enabled sensitive terms."
    };
  }

  if (!hasFrame) {
    return {
      status: "safe",
      severity: "low",
      category: "none",
      disclosure: "No camera frame is active yet.",
      evidence: "No frame or local text was available for assist scanning."
    };
  }

  if (frameSignal === "blank") {
    return {
      status: "safe",
      severity: "low",
      category: "none",
      disclosure: "Safe to describe: no readable private content detected locally.",
      evidence: "The frame looked blank or too visually uniform for a privacy warning."
    };
  }

  return {
    status: "unclear",
    severity: "uncertain",
    category: "none",
    disclosure: "Local web pre-check needs Claude for this frame.",
    evidence: "The browser pre-check can confirm camera readiness, but it cannot read image content in production. Claude is required for visual privacy detection."
  };
}

export function applyPrivacyMode(precheck, privacyMode = "balanced") {
  if (privacyMode === "relaxed" && precheck.severity !== "high") {
    return {
      ...precheck,
      status: "safe",
      severity: "low",
      disclosure: "Safe to describe unless high-risk content is confirmed."
    };
  }

  if (privacyMode === "strict" && precheck.status === "unclear") {
    return {
      ...precheck,
      status: "risky",
      severity: "uncertain",
      disclosure: "Unclear privacy risk. Sharing is paused in strict mode."
    };
  }

  return precheck;
}

export function shouldRequestClaude(precheck, privacyMode = "balanced") {
  return privacyMode === "balanced" && precheck.status === "unclear";
}

export function voiceDisclosureFor({ severity = "low", category = "none" } = {}) {
  if (severity === "low") return "Safe to describe: public or ordinary content.";
  const labels = {
    financial: "This may contain financial information.",
    medical: "Possible medical information detected.",
    identity: "Possible ID document detected.",
    address: "Possible address or mail detected.",
    screen: "Private screen content may be visible.",
    personal: "Possible personal information detected."
  };
  return labels[category] ?? "Possible private information detected.";
}

export function buildTransparency({
  localPrecheck,
  claudeRequested = false,
  claudeCalled = false,
  category = "none",
  evidenceSummary = "",
  stored = false
} = {}) {
  return {
    localScanResult: localPrecheck?.status ?? "unknown",
    claudeRequested,
    claudeCalled,
    category,
    redactedEvidence: evidenceSummary || localPrecheck?.evidence || "No sensitive evidence stored.",
    notStored: "Camera frames and uploaded images are not stored in scan history or exports.",
    frameStorage: stored ? "Stored" : "Not stored"
  };
}

export function shouldSpeakDisclosure({ speakEnabled = false, lastSpoken = "", nextDisclosure = "" } = {}) {
  return Boolean(speakEnabled && nextDisclosure && nextDisclosure !== lastSpoken);
}
