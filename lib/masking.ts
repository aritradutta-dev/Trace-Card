/**
 * Comprehensive API credential and PII masking for incoming traces,
 * server logs, error traces, and model requests.
 */

const KNOWN_SERVER_KEYS = new Set<string>();

/**
 * Register active server-side API keys so they are guaranteed to be redacted
 * from any log, error trace, or outgoing payload.
 */
export function registerServerKeys(keys: string[]) {
  for (const key of keys) {
    const trimmed = key.trim();
    if (trimmed && trimmed.length >= 8) {
      KNOWN_SERVER_KEYS.add(trimmed);
    }
  }
}

/**
 * Mask an API key for safe logging and status reporting (e.g. "AQ...iYEA").
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return "[NOT_CONFIGURED]";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

export function maskSensitiveText(value: string): string {
  if (!value || typeof value !== "string") return "";
  let masked = value;

  // 1. First redact any known server-side API keys explicitly
  for (const serverKey of KNOWN_SERVER_KEYS) {
    if (masked.includes(serverKey)) {
      masked = masked.replaceAll(serverKey, "[MASKED_SERVER_API_KEY]");
    }
  }

  const replace = (pattern: RegExp, label: string) => {
    masked = masked.replace(pattern, () => `[MASKED_${label}]`);
  };

  // 2. Private Keys
  replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "PRIVATE_KEY");

  // 3. JWT Tokens
  replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "JWT");

  // 4. API keys from various providers
  // Google / Gemini API keys: AIza... and AQ....
  replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "GEMINI_API_KEY");
  replace(/\bAQ\.[0-9A-Za-z_-]{20,}\b/g, "GEMINI_API_KEY");
  // OpenAI & Anthropic keys
  replace(/\bsk-(?:ant-api\d{2}-)?[A-Za-z0-9_-]{18,}\b/g, "API_KEY");
  // GitHub tokens
  replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "GITHUB_TOKEN");
  // AWS Access Key ID
  replace(/\bAKIA[0-9A-Z]{16}\b/g, "AWS_ACCESS_KEY");
  // Slack tokens
  replace(/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, "SLACK_TOKEN");
  // Hugging Face tokens
  replace(/\bhf_[A-Za-z0-9]{20,}\b/g, "HF_TOKEN");

  // 5. Bearer / Authorization headers
  replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "TOKEN");

  // 6. Database Connection Strings (passwords inside URIs)
  masked = masked.replace(
    /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s]+:([^@\s]+)@/gi,
    (full, pass: string) => full.replace(`:${pass}@`, ":[MASKED_DB_PASSWORD]@"),
  );

  // 7. Key-Value credential assignments
  masked = masked.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|auth[_-]?token)\s*([:=])\s*["']?([^\s,;"'<>]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}[MASKED_CREDENTIAL]`,
  );

  // 8. Email Addresses
  replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "EMAIL");

  // 9. IPv4 Addresses
  replace(/\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g, "IP");

  // 10. Local filesystem usernames in paths
  masked = masked.replace(
    /(?:\/Users\/|\/home\/|C:\\Users\\)([^/\\\s]+)/g,
    (full, user: string) => full.replace(user, "[MASKED_USERNAME]"),
  );

  // 11. High-Entropy secrets (32+ chars mixed case + numbers)
  replace(/\b(?=[A-Za-z0-9+/=_-]{32,}\b)(?=[A-Za-z0-9+/=_-]*[a-z])(?=[A-Za-z0-9+/=_-]*[A-Z])(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{32,}\b/g, "HIGH_ENTROPY");

  return masked;
}

export function maskNested(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return maskSensitiveText(value);
  if (depth >= 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => maskNested(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [key, maskNested(item, depth + 1)]),
    );
  }
  return value;
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Unknown failure");
  return maskSensitiveText(message).slice(0, 500);
}
