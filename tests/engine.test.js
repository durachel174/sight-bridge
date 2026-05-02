import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDisclosure } from "../src/engine/sensitivityEngine.js";

test("high-risk financial patterns require confirmation", async () => {
  const result = await analyzeDisclosure({
    text: "Credit card 4111 1111 1111 1111 is visible on the table."
  });

  assert.equal(result.severity, "high");
  assert.equal(result.action, "interrupt_confirm");
  assert.equal(result.category, "financial");
});

test("public content does not trigger an alert", async () => {
  const result = await analyzeDisclosure({
    text: "Restaurant menu with public food prices."
  });

  assert.equal(result.severity, "low");
  assert.equal(result.action, "none");
});

test("low sensitivity suppresses medium-only signals", async () => {
  const result = await analyzeDisclosure({
    text: "Envelope with return address visible: 1420 Pine Street.",
    preferences: {
      sensitivity: "low",
      alertCategories: ["address"]
    }
  });

  assert.equal(result.severity, "low");
});

test("uncertain contextual content asks before proceeding", async () => {
  const result = await analyzeDisclosure({
    text: "Handwritten sticky note with possible personal note.",
    preferences: {
      sensitivity: "medium",
      alertCategories: ["personal"]
    }
  });

  assert.equal(result.severity, "uncertain");
  assert.equal(result.action, "ask_if_proceed");
});

test("split OCR card digits still trigger a high-risk alert", async () => {
  const result = await analyzeDisclosure({
    text: "Visa Platinum\n4000\n4000\n1234 5678\n9010\nGOOD THRU 12/20"
  });

  assert.equal(result.severity, "high");
  assert.equal(result.action, "interrupt_confirm");
  assert.equal(result.category, "financial");
});

test("public recipe measurements do not look like a credit card", async () => {
  const result = await analyzeDisclosure({
    text: `YIELD: 1 LOAF
BANANA BREAD
PREPPING TIME: 15 MINUTES
BAKING TIME: 60 MINUTES
O 260 g All-purpose Flour
200 g Sugar
6 g Baking Soda
225 g Banana
100 g Vegetable Oil
23 cm x 13 cm (2 L)
SP 1290 | February 2023
1. Preheat oven to 180 C
This publication is available free of charge https://doi.org/10.6028/NIST.SP.1290`
  });

  assert.equal(result.severity, "low");
  assert.equal(result.action, "none");
});

test("degraded prescription OCR still triggers a medical alert", async () => {
  const result = await analyzeDisclosure({
    text: `WiTE
Patal
REFO
ANACL
Nome
METK
THaLI
500 MS*
Taki
2:`
  });

  assert.equal(result.severity, "high");
  assert.equal(result.action, "interrupt_confirm");
  assert.equal(result.category, "medical");
});

test("bank account numbers do not get mislabeled as SSNs", async () => {
  const result = await analyzeDisclosure({
    text: "FIRST HARBOR BANK\nMonthly Statement\nAccount: 123456789\nRouting: 021000021"
  });

  assert.equal(result.severity, "high");
  assert.equal(result.category, "financial");
});
