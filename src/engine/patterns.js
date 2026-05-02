const CATEGORY_LABELS = {
  financial: "financial information",
  medical: "medical information",
  identity: "identity information",
  address: "address or location information",
  screen: "private screen content",
  personal: "personal information"
};

const PATTERNS = [
  {
    category: "financial",
    severity: "high",
    label: "payment card branding",
    regex: /\b(?:visa|mastercard|american express|amex|discover|platinum|good thru|valid thru)\b/gi
  },
  {
    category: "identity",
    severity: "high",
    label: "Social Security number",
    regex: /\b(?:\d{3}[- ]\d{2}[- ]\d{4}|(?:ssn|social security)\s*(?:#|number|no\.?)?\s*:?\s*\d{9})\b/gi
  },
  {
    category: "identity",
    severity: "high",
    label: "identity document",
    regex: /\b(?:driver license|drivers license|driver's license|passport|government id|dln|dob|family name|given names)\b/gi
  },
  {
    category: "financial",
    severity: "high",
    label: "credit card number",
    regex: /\b(?:\d[\s-]*?){13,19}\b/g
  },
  {
    category: "financial",
    severity: "high",
    label: "bank account or routing number",
    regex: /\b(?:account|routing|acct)\s*(?:#|number|no\.?)?\s*:?\s*\d{6,17}\b/gi
  },
  {
    category: "screen",
    severity: "high",
    label: "authentication code",
    regex: /\b(?:password reset code|verification code|one[- ]time code|otp|2fa code)\b/gi
  },
  {
    category: "personal",
    severity: "medium",
    label: "email address",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    category: "personal",
    severity: "medium",
    label: "phone number",
    regex: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g
  },
  {
    category: "address",
    severity: "medium",
    label: "street address",
    regex: /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)\b/gi
  },
  {
    category: "address",
    severity: "medium",
    label: "mailing address field",
    regex: /\b(?:street address|to-street address|from-street address|city,\s*state,\s*zip|mailing address)\b/gi
  },
  {
    category: "medical",
    severity: "high",
    label: "medical or prescription term",
    regex: /\b(?:prescription|rx|dosage|pharmacy|patient|patal|refill|medication|diagnosis|clinic|doctor|metformin|metk|tablet|capsule|take|taki)\b/gi
  },
  {
    category: "medical",
    severity: "high",
    label: "dosage amount",
    regex: /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|ms\*)\b/gi
  },
  {
    category: "financial",
    severity: "medium",
    label: "financial document term",
    regex: /\b(?:bank|statement|balance|w-2|tax|paystub|invoice|routing|credit card)\b/gi
  },
  {
    category: "screen",
    severity: "medium",
    label: "private screen term",
    regex: /\b(?:inbox|email|password|login|account settings|banking tab|messages|private chat)\b/gi
  }
];

const PAYMENT_CARD_CONTEXT = /\b(?:visa|mastercard|american express|amex|discover|platinum|good thru|valid thru|cardholder|debit|credit card)\b/i;

const SEVERITY_RANK = {
  low: 0,
  uncertain: 1,
  medium: 2,
  high: 3
};

export function detectPatterns(text = "") {
  const matches = [];

  for (const pattern of PATTERNS) {
    const found = [...text.matchAll(pattern.regex)];
    if (found.length > 0) {
      matches.push({
        category: pattern.category,
        severity: pattern.severity,
        label: pattern.label,
        count: found.length
      });
    }
  }

  const cardCandidates = detectCardCandidates(text);
  if (cardCandidates.length > 0 && !matches.some((match) => match.label === "credit card number")) {
    matches.push({
      category: "financial",
      severity: "high",
      label: "credit card number",
      count: cardCandidates.length
    });
  }

  return matches;
}

function detectCardCandidates(text) {
  if (!PAYMENT_CARD_CONTEXT.test(text)) {
    return [];
  }

  const candidates = new Set();
  const digitRuns = text.match(/\d[\d \t-]{11,}\d/g) ?? [];

  for (const run of digitRuns) {
    const digits = run.replace(/\D/g, "");
    addCardLengthWindows(digits, candidates);
  }

  const groups = text.match(/\b\d{3,4}\b/g) ?? [];
  for (let start = 0; start < groups.length; start += 1) {
    let combined = "";
    for (let end = start; end < groups.length && combined.length < 20; end += 1) {
      combined += groups[end];
      addCardLengthWindows(combined, candidates);
    }
  }

  return [...candidates];
}

function addCardLengthWindows(digits, candidates) {
  for (let length = 13; length <= 19; length += 1) {
    if (digits.length === length) {
      candidates.add(digits);
    }

    if (digits.length > length) {
      for (let index = 0; index <= digits.length - length; index += 1) {
        candidates.add(digits.slice(index, index + length));
      }
    }
  }
}

export function topSeverity(items) {
  return items.reduce((highest, item) => {
    return SEVERITY_RANK[item.severity] > SEVERITY_RANK[highest] ? item.severity : highest;
  }, "low");
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? "sensitive information";
}

export { SEVERITY_RANK };
