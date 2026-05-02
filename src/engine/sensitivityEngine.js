import { categoryLabel, detectPatterns, SEVERITY_RANK, topSeverity } from "./patterns.js";
import { classifyContext } from "./contextClassifier.js";

const DEFAULT_PREFERENCES = {
  sensitivity: "medium",
  alertCategories: ["financial", "medical", "identity", "address", "screen", "personal"]
};

export async function analyzeDisclosure({ text = "", preferences = {} } = {}) {
  const startedAt = performanceNow();
  const userPreferences = { ...DEFAULT_PREFERENCES, ...preferences };
  const patternMatches = detectPatterns(text);
  const context = await classifyContext({ text });
  const decision = mergeSignals(patternMatches, context, userPreferences);

  return {
    ...decision,
    patternMatches,
    context,
    latencyMs: Math.round(performanceNow() - startedAt),
    processing: {
      local: "PII patterns and sensitivity preferences ran locally in the browser.",
      external: "Context classification is currently a local stub. A production build should disclose the chosen cloud AI provider before sending images."
    }
  };
}

export function mergeSignals(patternMatches, context, preferences = DEFAULT_PREFERENCES) {
  const enabledCategories = new Set(preferences.alertCategories ?? DEFAULT_PREFERENCES.alertCategories);
  const filteredPatterns = patternMatches.filter((match) => enabledCategories.has(match.category));
  const contextEnabled = enabledCategories.has(context.category);
  const patternSeverity = topSeverity(filteredPatterns);
  const hasHardPii = filteredPatterns.some((match) => match.severity === "high");
  const highContext = contextEnabled && context.confidence >= 0.8;
  const mediumContext = contextEnabled && context.confidence >= 0.55;

  if (filteredPatterns.length === 0 && !contextEnabled) {
    return noAlert("No enabled sensitivity category was detected.");
  }

  if (preferences.sensitivity === "low" && !hasHardPii) {
    return noAlert("Low sensitivity mode only alerts on confirmed high-risk patterns.");
  }

  if (hasHardPii) {
    const categories = unique(filteredPatterns.map((match) => match.category));
    return {
      severity: "high",
      category: categories[0],
      action: "interrupt_confirm",
      disclosureMessage: `${capitalize(categoryLabel(categories[0]))} appears visible.`,
      reasoning: summarizePatterns(filteredPatterns, context),
      permissionChoices: ["Continue sharing", "Restrict sharing", "AI-only mode", "Cancel"]
    };
  }

  if (highContext) {
    return {
      severity: "medium",
      category: context.category,
      action: "passive_disclosure",
      disclosureMessage: `${capitalize(categoryLabel(context.category))} may be visible.`,
      reasoning: context.reasoning,
      permissionChoices: ["Continue sharing", "Restrict sharing", "AI-only mode", "Cancel"]
    };
  }

  if (patternSeverity === "medium") {
    const category = filteredPatterns[0].category;
    return {
      severity: "medium",
      category,
      action: "passive_disclosure",
      disclosureMessage: `${capitalize(categoryLabel(category))} may be visible.`,
      reasoning: summarizePatterns(filteredPatterns, context),
      permissionChoices: ["Continue sharing", "Restrict sharing", "AI-only mode", "Cancel"]
    };
  }

  if (mediumContext || (preferences.sensitivity === "high" && contextEnabled)) {
    return {
      severity: "uncertain",
      category: context.category,
      action: "ask_if_proceed",
      disclosureMessage: `This may include ${categoryLabel(context.category)}, but I am not certain.`,
      reasoning: context.reasoning,
      permissionChoices: ["Continue sharing", "Restrict sharing", "AI-only mode", "Cancel"]
    };
  }

  return noAlert("The scene appears low risk or public.");
}

function noAlert(reasoning) {
  return {
    severity: "low",
    category: "none",
    action: "none",
    disclosureMessage: "No disclosure alert needed.",
    reasoning,
    permissionChoices: []
  };
}

function summarizePatterns(patternMatches, context) {
  const labels = patternMatches.map((match) => match.label);
  const patternSummary = `Detected ${joinList(unique(labels))}.`;
  if (context.category === "unknown" || context.category === "public") {
    return patternSummary;
  }
  return `${patternSummary} ${context.reasoning}`;
}

function unique(items) {
  return [...new Set(items)];
}

function joinList(items) {
  if (items.length <= 1) return items[0] ?? "sensitive content";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function performanceNow() {
  if (typeof performance !== "undefined" && performance.now) return performance.now();
  return Date.now();
}

export { DEFAULT_PREFERENCES, SEVERITY_RANK };
