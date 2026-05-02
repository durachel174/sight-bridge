import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPrivacyMode,
  buildTransparency,
  localAssistPrecheck,
  shouldRequestClaude,
  shouldSpeakDisclosure
} from "../src/engine/assistMode.js";

test("privacy modes handle unclear frames differently", () => {
  const unclear = localAssistPrecheck({ hasFrame: true });

  assert.equal(applyPrivacyMode(unclear, "strict").status, "risky");
  assert.equal(applyPrivacyMode(unclear, "balanced").status, "unclear");
  assert.equal(applyPrivacyMode(unclear, "relaxed").status, "safe");
});

test("Claude is requested only when session assist is enabled for balanced unclear frames", () => {
  const safe = localAssistPrecheck({ text: "Public cafe menu", hasFrame: true });
  const risky = localAssistPrecheck({ text: "Visa card visible", hasFrame: true });
  const unclear = localAssistPrecheck({ hasFrame: true });

  assert.equal(shouldRequestClaude(safe, "balanced", true), false);
  assert.equal(shouldRequestClaude(risky, "balanced", true), false);
  assert.equal(shouldRequestClaude(unclear, "balanced", false), false);
  assert.equal(shouldRequestClaude(unclear, "balanced", true), true);
  assert.equal(shouldRequestClaude(unclear, "strict", true), false);
  assert.equal(shouldRequestClaude(unclear, "relaxed", true), false);
});

test("transparency records Claude and storage state", () => {
  const localPrecheck = localAssistPrecheck({ hasFrame: true });
  const transparency = buildTransparency({
    localPrecheck,
    claudeRequested: true,
    claudeCalled: false,
    category: "none"
  });

  assert.equal(transparency.localScanResult, "unclear");
  assert.equal(transparency.claudeRequested, true);
  assert.equal(transparency.claudeCalled, false);
  assert.equal(transparency.frameStorage, "Not stored");
  assert.match(transparency.redactedEvidence, /Claude|required|browser/i);
});

test("speech toggle does not speak when disabled", () => {
  assert.equal(
    shouldSpeakDisclosure({
      speakEnabled: false,
      lastSpoken: "",
      nextDisclosure: "Possible ID document detected."
    }),
    false
  );
});
