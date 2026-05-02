import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("evaluation export includes phase 2 transparency fields", () => {
  const page = readFileSync("app/page.jsx", "utf8");
  for (const field of [
    "assistMode",
    "privacyMode",
    "localPrecheck",
    "resultSource",
    "claudeRequested",
    "claudeCalled",
    "spokenDisclosure",
    "sentToCloudSummary"
  ]) {
    assert.match(page, new RegExp(`${field}:`));
  }
});

test("assist mode suppresses unprompted unclear local rows", () => {
  const page = readFileSync("app/page.jsx", "utf8");
  assert.match(page, /function shouldRecordAssistScan/);
  assert.match(page, /return claudeRequested/);
});
