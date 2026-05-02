import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDecision } from "../app/api/analyze-image-cloud/route.js";

test("driver licenses stay identity even when card-shaped with numbers", () => {
  const result = normalizeDecision({
    severity: "high",
    category: "financial",
    disclosure_message: "Financial information appears visible.",
    reasoning: "The image appears to show a card with number groups.",
    evidence: "California driver's license card with license number and date of birth.",
    detected_text: "Driver license text detected.",
    visual_context: "State driver's license identity document.",
    confidence: 0.85
  });

  assert.equal(result.category, "identity");
  assert.equal(result.severity, "high");
});

test("payment cards still normalize to financial", () => {
  const result = normalizeDecision({
    severity: "medium",
    category: "personal",
    disclosure_message: "Private card appears visible.",
    reasoning: "A Visa card is visible.",
    evidence: "Visa card with cardholder and valid thru fields.",
    detected_text: "Visa 4147 [redacted]",
    visual_context: "Person holding payment card.",
    confidence: 0.9
  });

  assert.equal(result.category, "financial");
  assert.equal(result.severity, "high");
});
