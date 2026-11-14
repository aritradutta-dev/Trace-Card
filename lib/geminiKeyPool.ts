import { ApiError, GoogleGenAI } from "@google/genai";
import { maskApiKey, registerServerKeys, sanitizeErrorMessage } from "@/lib/masking";

export type KeyStatus = "active" | "cooling" | "disabled";

export type KeyState = {
  index: number;
  key: string;
  masked: string;
  status: KeyStatus;
  cooldownUntil: number;
  failureCount: number;
  successCount: number;
  lastUsed: number;
  lastError: string | null;
};

class GeminiKeyPool {
  private keys: KeyState[] = [];
  private currentIndex = 0;
  private initialized = false;

  constructor() {
    this.refreshKeys();
  }

  public refreshKeys() {
    const rawKeys: string[] = [];

    // 1. Check GEMINI_API_KEYS (comma, semicolon, or newline separated)
    const multiEnv = process.env.GEMINI_API_KEYS;
    if (multiEnv) {
      for (const piece of multiEnv.split(/[,;\r\n]+/)) {
        const trimmed = piece.trim();
        if (trimmed) rawKeys.push(trimmed);
      }
    }

    // 2. Check GEMINI_API_KEY (single or comma-separated)
    const singleEnv = process.env.GEMINI_API_KEY;
    if (singleEnv) {
      for (const piece of singleEnv.split(/[,;\r\n]+/)) {
        const trimmed = piece.trim();
        if (trimmed) rawKeys.push(trimmed);
      }
    }

    // 3. Check numbered keys GEMINI_API_KEY_1 .. GEMINI_API_KEY_10
    for (let i = 1; i <= 10; i += 1) {
      const numbered = process.env[`GEMINI_API_KEY_${i}`]?.trim();
      if (numbered) rawKeys.push(numbered);
    }

    // Deduplicate preserving order
    const uniqueKeys = Array.from(new Set(rawKeys.filter((k) => k.length >= 8)));

    // Register all server keys into the masking registry
    registerServerKeys(uniqueKeys);

    // Keep existing health stats if refreshing
    const previousMap = new Map(this.keys.map((k) => [k.key, k]));

    this.keys = uniqueKeys.map((key, i) => {
      const existing = previousMap.get(key);
      if (existing) {
        existing.index = i + 1;
        return existing;
      }
      return {
        index: i + 1,
        key,
        masked: maskApiKey(key),
        status: "active" as KeyStatus,
        cooldownUntil: 0,
        failureCount: 0,
        successCount: 0,
        lastUsed: 0,
        lastError: null,
      };
    });

    this.initialized = true;
  }

  public hasKeys(): boolean {
    if (!this.initialized) this.refreshKeys();
    return this.keys.length > 0;
  }

  public getKeyCount(): number {
    if (!this.initialized) this.refreshKeys();
    return this.keys.length;
  }

  public getStatus() {
    if (!this.initialized) this.refreshKeys();
    const now = Date.now();
    let activeCount = 0;
    let coolingCount = 0;

    const list = this.keys.map((k) => {
      const isCooling = k.status === "cooling" && k.cooldownUntil > now;
      if (isCooling) coolingCount += 1;
      else if (k.status === "active") activeCount += 1;

      return {
        index: k.index,
        masked: k.masked,
        status: isCooling ? "cooling" : k.status,
        cooldownRemainingSeconds: isCooling ? Math.ceil((k.cooldownUntil - now) / 1000) : 0,
        successCount: k.successCount,
        failureCount: k.failureCount,
      };
    });

    return {
      configured: this.keys.length > 0,
      totalKeys: this.keys.length,
      activeKeys: activeCount,
      coolingKeys: coolingCount,
      keys: list,
    };
  }

  /**
   * Determine whether an error is caused by a key failure (quota, auth, provider outage)
   * which warrants switching to another API key.
   */
  private isKeyRecoverableError(error: unknown): boolean {
    if (!error) return false;

    // Check Google GenAI ApiError
    if (error instanceof ApiError) {
      // 429 = Quota exceeded / rate limit
      // 403 = Permission denied / quota / API key restricted
      // 401 = Unauthorized / invalid key
      // 503 = Service unavailable
      // 500 = Internal server error
      if ([401, 403, 429, 500, 502, 503, 504].includes(error.status)) return true;
    }

    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

    // Check message heuristics for quota, auth, and availability issues
    if (
      message.includes("resource_exhausted") ||
      message.includes("quota exceeded") ||
      message.includes("too many requests") ||
      message.includes("rate limit") ||
      message.includes("api_key_invalid") ||
      message.includes("permission_denied") ||
      message.includes("api key not valid") ||
      message.includes("unauthenticated") ||
      message.includes("service unavailable") ||
      message.includes("overloaded") ||
      message.includes("fetch failed") ||
      message.includes("econnreset") ||
      message.includes("etimedout")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Mark a key in cooldown based on failure type.
   */
  private markCooldown(entry: KeyState, error: unknown) {
    const now = Date.now();
    entry.failureCount += 1;
    entry.lastError = sanitizeErrorMessage(error);

    let cooldownDurationMs = 60_000; // default 1 min

    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        // Invalid or unauthorized key: longer cooldown (10 minutes)
        cooldownDurationMs = 600_000;
        entry.status = "disabled";
      } else if (error.status === 429) {
        // Quota limit: progressive backoff (60s, 120s, 300s)
        cooldownDurationMs = Math.min(300_000, 60_000 * entry.failureCount);
        entry.status = "cooling";
      } else {
        // 503 / 500 / Network: 30 seconds
        cooldownDurationMs = 30_000;
        entry.status = "cooling";
      }
    } else {
      entry.status = "cooling";
    }

    entry.cooldownUntil = now + cooldownDurationMs;
  }

  private markSuccess(entry: KeyState) {
    entry.status = "active";
    entry.failureCount = 0;
    entry.cooldownUntil = 0;
    entry.successCount += 1;
    entry.lastError = null;
  }

  /**
   * Execute an operation with automatic key rotation and failover.
   * If a key encounters rate limits, quota exhaustion, or provider errors,
   * it is placed in cooldown and the operation immediately retries with the next available key.
   */
  public async executeWithFailover<T>(
    signal: AbortSignal,
    operation: (ai: GoogleGenAI, keyInfo: { index: number; masked: string; totalKeys: number }) => Promise<T>,
  ): Promise<T> {
    if (!this.initialized) this.refreshKeys();

    if (this.keys.length === 0) {
      throw new Error("No Gemini API key is configured. Please set GEMINI_API_KEY or GEMINI_API_KEYS in .env.");
    }

    const now = Date.now();

    // Recover any cooling keys whose cooldown has expired
    for (const k of this.keys) {
      if (k.status === "cooling" && k.cooldownUntil <= now) {
        k.status = "active";
        k.cooldownUntil = 0;
      }
    }

    // Build the list of keys to attempt: prioritize active, then soonest-expiring cooling keys if all are cooling
    const available = this.keys.filter((k) => k.status === "active");
    const candidates = available.length > 0 ? available : [...this.keys].sort((a, b) => a.cooldownUntil - b.cooldownUntil);

    // Rotate start index round-robin
    const startIndex = this.currentIndex % candidates.length;
    this.currentIndex = (this.currentIndex + 1) % Math.max(1, candidates.length);

    const orderedCandidates: KeyState[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      orderedCandidates.push(candidates[(startIndex + i) % candidates.length]);
    }

    let lastCaughtError: unknown = null;

    for (let attempt = 0; attempt < orderedCandidates.length; attempt += 1) {
      signal.throwIfAborted();
      const currentEntry = orderedCandidates[attempt];
      currentEntry.lastUsed = Date.now();

      const ai = new GoogleGenAI({
        apiKey: currentEntry.key,
        httpOptions: {
          timeout: 45_000,
          retryOptions: { attempts: 1 },
          fetch: (input, init) => {
            const combinedSignal = init?.signal
              ? AbortSignal.any([init.signal, signal])
              : signal;
            return fetch(input, { ...init, signal: combinedSignal });
          },
        },
      });

      try {
        const result = await operation(ai, {
          index: currentEntry.index,
          masked: currentEntry.masked,
          totalKeys: this.keys.length,
        });

        this.markSuccess(currentEntry);
        return result;
      } catch (error) {
        lastCaughtError = error;

        // If the client aborted, don't failover keys
        if (signal.aborted) throw error;

        const isRecoverable = this.isKeyRecoverableError(error);
        if (!isRecoverable) {
          // If it's a schema validation error or model not found error, rethrow without blaming the key
          throw error;
        }

        this.markCooldown(currentEntry, error);

        const nextKeyIndex = (attempt + 1 < orderedCandidates.length)
          ? orderedCandidates[attempt + 1].index
          : null;

        console.warn(
          `[KeyPool] Gemini key #${currentEntry.index} (${currentEntry.masked}) failed: ${sanitizeErrorMessage(error)}. ` +
          (nextKeyIndex ? `Auto-switching to key #${nextKeyIndex}...` : `No more keys to failover to.`),
        );

        // If there are more keys left in the candidate list, continue to next iteration!
      }
    }

    // All keys have been attempted and failed
    throw new Error(
      `All Gemini API keys (${this.keys.length}) in the pool are temporarily exhausted or unavailable: ${sanitizeErrorMessage(lastCaughtError)}`,
    );
  }
}

export const keyPool = new GeminiKeyPool();
