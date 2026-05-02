const CONTEXT_RULES = [
  {
    category: "financial",
    confidence: 0.86,
    keywords: [
      "bank statement",
      "credit card",
      "debit card",
      "visa",
      "visa platinum",
      "mastercard",
      "american express",
      "amex",
      "discover",
      "good thru",
      "valid thru",
      "tax form",
      "w-2",
      "paystub",
      "routing number"
    ],
    reasoning: "The scene appears to include a financial document or payment information."
  },
  {
    category: "medical",
    confidence: 0.88,
    keywords: [
      "prescription bottle",
      "pharmacy",
      "rx",
      "patient",
      "patal",
      "medication",
      "metformin",
      "metk",
      "500 ms",
      "clinic"
    ],
    reasoning: "The scene appears to include medical or prescription information."
  },
  {
    category: "identity",
    confidence: 0.84,
    keywords: ["driver license", "driver's license", "passport", "id badge", "government id", "dln", "dob", "ssn"],
    reasoning: "The scene appears to include identity information."
  },
  {
    category: "screen",
    confidence: 0.78,
    keywords: ["laptop screen", "banking tab", "email inbox", "inbox", "password reset code", "private message", "someone else's phone"],
    reasoning: "A private screen may be visible in the camera frame."
  },
  {
    category: "address",
    confidence: 0.74,
    keywords: ["mailing address", "envelope", "return address", "home address"],
    reasoning: "Personal mail or address information may be visible."
  },
  {
    category: "personal",
    confidence: 0.62,
    keywords: ["open mail", "letter", "sticky note", "whiteboard"],
    reasoning: "The scene may include personal notes or correspondence."
  }
];

const PUBLIC_CONTENT = [
  "restaurant menu",
  "recipe blog",
  "store shelf",
  "product packaging",
  "street sign",
  "news broadcast",
  "bookshelf"
];

export async function classifyContext({ text = "" } = {}) {
  const normalized = text.toLowerCase();

  if (PUBLIC_CONTENT.some((phrase) => normalized.includes(phrase))) {
    return {
      category: "public",
      confidence: 0.82,
      reasoning: "The visible content appears public or impersonal."
    };
  }

  const match = CONTEXT_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(keyword))
  );

  if (!match) {
    return {
      category: "unknown",
      confidence: 0.32,
      reasoning: "No strong contextual sensitivity signal was found."
    };
  }

  return {
    category: match.category,
    confidence: match.confidence,
    reasoning: match.reasoning
  };
}
