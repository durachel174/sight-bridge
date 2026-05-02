const DISCLOSURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    severity: { type: "string", enum: ["low", "medium", "high", "uncertain"] },
    category: {
      type: "string",
      enum: ["financial", "medical", "identity", "address", "screen", "personal", "public", "none"]
    },
    disclosure_message: { type: "string" },
    reasoning: { type: "string" },
    evidence: { type: "string" },
    detected_text: { type: "string" },
    visual_context: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: [
    "severity",
    "category",
    "disclosure_message",
    "reasoning",
    "evidence",
    "detected_text",
    "visual_context",
    "confidence"
  ]
};

const DISCLOSURE_PROMPT = `
You are SightBridge's privacy disclosure classifier for images a person may share through a camera or screen.

Return JSON only. Be conservative about privacy, but avoid false positives on public/ordinary documents.

Decision policy:
- high: visible financial, medical, identity, login, private screen, or account information likely needs user confirmation before sharing.
- medium: private content may be visible, but the exact sensitive information is partial or ambiguous.
- uncertain: the image suggests a sensitive scene, but you cannot identify enough detail to classify it safely.
- low: no disclosure alert is needed.

Classify these cases:
- Payment cards: high financial if the image is a credit/debit card, banking card, card number groups, cardholder name, expiration date, CVV-like field, or payment-brand card surface is visible. This includes a person holding a partially covered payment card if any card digits, name, expiry, or bank/payment-card context is visible. Redact full numbers in evidence.
- Do not classify driver's licenses, passports, government IDs, school/work IDs, insurance cards, or tax forms as payment cards. These are identity documents even when they are plastic/card-shaped or include grouped ID numbers.
- Recipes, public instructions, posters, product labels, public PDFs, measurements, temperatures, dates, page numbers, DOI/URL strings, and publication IDs: low/public or none unless they also contain personal, medical, financial, identity, or private screen information.
- Prescription or medicine labels: high medical if patient name, medication name, dosage, pharmacy label, prescription bottle, or Rx-style private label is visible. If blurry but clearly a prescription/medicine label, use high or uncertain medical rather than low.
- Computer or phone screens: high/medium screen if messages, email, login, dashboards, account pages, documents, private tabs, code with secrets, or personal content is visible.
- IDs and documents: high identity for passports, driver's licenses, school/work IDs, tax forms, insurance cards, or government records.
- Addresses/mail: medium or high address when a residential address, mail label, shipping label, or envelope is visible.

False-positive guardrails:
- Do not label ordinary recipe quantities or NIST/public document numbers as credit cards.
- Do not infer a credit card from any 4 numbers unless the visual context is a payment card, bank/payment document, checkout page, or the number pattern is clearly payment-related.
- If content is public/educational and not personalized, choose low with category public or none.
- If unsure between low and high for a private-looking document, choose uncertain or medium and explain the uncertainty.

Output fields:
- evidence: brief user-facing evidence. Do not include people's names, exact card digits, expiration dates, phone numbers, addresses, ID numbers, prescription numbers, or medical record numbers.
- detected_text: short OCR-like text summary, but use type labels instead of sensitive values. Use "" if unreadable.
- visual_context: what type of scene/object/document this appears to be.
- reasoning: one concise sentence explaining why the category and severity were chosen.
`;

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { available: false, message: "Cloud vision is not configured. Set ANTHROPIC_API_KEY in deployment." },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const image = body?.image;
    if (!image?.dataUrl?.startsWith("data:image/")) {
      return Response.json({ available: false, message: "Expected image.dataUrl." }, { status: 400 });
    }

    const decision = normalizeDecision(await callClaudeVision(image.dataUrl));
    return Response.json({
      available: true,
      text: decision.evidence ?? "",
      message: "Processed with Claude cloud vision after user confirmation.",
      decision: sanitizeDecisionForClient(decision)
    });
  } catch (error) {
    return Response.json({ available: false, message: error.message ?? "Cloud vision failed." }, { status: 502 });
  }
}

async function callClaudeVision(dataUrl) {
  const image = parseDataUrl(dataUrl);
  const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_VISION_MODEL || "claude-sonnet-4-5",
      max_tokens: 900,
      system:
        "You return only valid JSON. Do not include Markdown, code fences, or prose outside the JSON object.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64
              }
            },
            {
              type: "text",
              text: `${DISCLOSURE_PROMPT}\n\nReturn an object matching this JSON schema:\n${JSON.stringify(
                DISCLOSURE_SCHEMA
              )}`
            }
          ]
        }
      ]
    })
  });

  const payload = await apiResponse.json();
  if (!apiResponse.ok) throw new Error(payload.error?.message ?? "Claude vision request failed.");
  return JSON.parse(extractResponseText(payload));
}

function extractResponseText(payload) {
  const text = (payload.content ?? [])
    .filter((content) => content.type === "text" && content.text)
    .map((content) => content.text)
    .join("\n")
    .trim();
  return stripJsonFence(text);
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  if (!match) throw new Error("Expected a JPEG, PNG, GIF, or WebP data URL.");
  return { mediaType: match[1], base64: match[2] };
}

function stripJsonFence(text) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function normalizeDecision(decision) {
  const combined = [
    decision.category,
    decision.disclosure_message,
    decision.reasoning,
    decision.evidence,
    decision.detected_text,
    decision.visual_context
  ]
    .filter(Boolean)
    .join("\n");

  if (hasIdentityDocumentEvidence(combined)) {
    return {
      ...decision,
      severity: decision.severity === "low" ? "high" : decision.severity,
      category: "identity",
      disclosure_message:
        decision.disclosure_message || "Identity information appears visible.",
      reasoning:
        decision.reasoning ||
        "The image appears to show an identity document with private identifying information.",
      evidence:
        decision.evidence ||
        "Identity document visible with personal identifying fields. Sensitive values are hidden."
    };
  }

  if (hasPaymentCardEvidence(combined)) {
    return {
      ...decision,
      severity: "high",
      category: "financial",
      disclosure_message: "Financial information appears visible.",
      reasoning:
        "The image appears to show a payment card with visible card details or card-number groups.",
      evidence: "Payment card visible with card details such as number groups, cardholder name, and expiration date."
    };
  }

  return decision;
}

function sanitizeDecisionForClient(decision) {
  if (decision.category === "identity" && hasIdentityDocumentEvidence(JSON.stringify(decision))) {
    return {
      ...decision,
      evidence: "Identity document visible with personal identifying fields. Sensitive values are hidden.",
      detected_text: "Identity document text detected. Sensitive values are hidden.",
      visual_context: "Identity document with private identifying information."
    };
  }

  if (decision.category === "financial" && hasPaymentCardEvidence(JSON.stringify(decision))) {
    return {
      ...decision,
      evidence:
        "Payment card visible with card details such as number groups, cardholder name, and expiration date.",
      detected_text: "Payment card text detected. Sensitive values are hidden.",
      visual_context: "Person holding a payment card with visible private card details."
    };
  }

  const evidence = redactSensitiveText(decision.evidence || "");
  const detectedText = redactSensitiveText(decision.detected_text || "");

  return {
    ...decision,
    evidence,
    detected_text: detectedText
  };
}

function hasIdentityDocumentEvidence(text) {
  const normalized = text.toLowerCase();
  return /\b(?:driver'?s?\s+licen[cs]e|passport|government\s+id|state\s+id|identity\s+card|id\s+card|student\s+id|work\s+id|employee\s+id|tax\s+form|w-?2|insurance\s+card|date\s+of\s+birth|dob)\b/.test(
    normalized
  );
}

function hasPaymentCardEvidence(text) {
  const normalized = text.toLowerCase();
  const paymentContext =
    /\b(?:credit card|debit card|payment card|bank card|cardholder|valid thru|good thru|visa|mastercard|american express|amex|discover|cvv|card number)\b/.test(
      normalized
    );
  const groupedCardDigits = /(?:\b\d{4}\b[\s-]*){2,5}/.test(normalized);
  return paymentContext || groupedCardDigits;
}

function redactSensitiveText(text) {
  return text
    .replace(/\b(?:\d[\s-]*){4,19}\b/g, "[redacted number]")
    .replace(/\b(?:valid thru|good thru|exp(?:iration)?(?: date)?)\s*:?\s*\d{1,2}\s*\/\s*\d{2,4}\b/gi, "[redacted expiration]")
    .replace(/\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, "[redacted phone]")
    .replace(/\b[A-Z][A-Z' -]{3,}\b/g, (match) => {
      if (/\b(?:VISA|MASTERCARD|AMEX|DISCOVER|PAYMENT|CARD|VALID|THRU|GOOD|SERVICE)\b/.test(match)) {
        return match;
      }
      return "[redacted name]";
    });
}
