/**
 * In-memory sliding-window rate limiter with automatic TTL pruning
 * and bounded LRU capacity to prevent memory leaks.
 */

type ClientRecord = {
  timestamps: number[];
  lastSeen: number;
};

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 20;
const MAX_TRACKED_IPS = 5_000;
const PRUNE_INTERVAL_MS = 60_000;

const clients = new Map<string, ClientRecord>();
let lastPruneTime = Date.now();

// Strict IPv4 and IPv6 validation patterns to prevent spoofing arbitrary keys
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_REGEX = /^(?:[a-fA-F0-9]{1,4}:){1,7}[a-fA-F0-9]{1,4}$|^::1$/;

function isValidIp(ip: string): boolean {
  return IPV4_REGEX.test(ip) || IPV6_REGEX.test(ip);
}

export function extractClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp && isValidIp(cfIp)) return cfIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp && isValidIp(firstIp)) return firstIp;
  }

  return "127.0.0.1";
}

function pruneExpired(now: number) {
  if (now - lastPruneTime < PRUNE_INTERVAL_MS) return;
  lastPruneTime = now;

  for (const [ip, record] of clients.entries()) {
    record.timestamps = record.timestamps.filter((time) => now - time < WINDOW_MS);
    if (record.timestamps.length === 0) {
      clients.delete(ip);
    }
  }
}

function evictOldestIfFull() {
  if (clients.size < MAX_TRACKED_IPS) return;

  let oldestIp: string | null = null;
  let oldestTime = Infinity;

  for (const [ip, record] of clients.entries()) {
    if (record.lastSeen < oldestTime) {
      oldestTime = record.lastSeen;
      oldestIp = ip;
    }
  }

  if (oldestIp) {
    clients.delete(oldestIp);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  headers: Record<string, string>;
};

export function checkRateLimit(request: Request, customLimit?: number): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const limit = customLimit || (Number(process.env.RATE_LIMIT_PER_MINUTE) || DEFAULT_LIMIT);
  const ip = extractClientIp(request);

  let record = clients.get(ip);
  if (!record) {
    evictOldestIfFull();
    record = { timestamps: [], lastSeen: now };
    clients.set(ip, record);
  } else {
    // Re-insert to refresh Map iteration order (LRU behavior)
    clients.delete(ip);
    clients.set(ip, record);
  }

  record.lastSeen = now;
  record.timestamps = record.timestamps.filter((time) => now - time < WINDOW_MS);

  const count = record.timestamps.length;
  const oldestTimestamp = record.timestamps[0] ?? now;
  const resetMs = Math.max(0, WINDOW_MS - (now - oldestTimestamp));
  const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));

  if (count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetSeconds,
      headers: {
        "Retry-After": String(resetSeconds),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
      },
    };
  }

  record.timestamps.push(now);
  const remaining = Math.max(0, limit - record.timestamps.length);

  return {
    allowed: true,
    limit,
    remaining,
    resetSeconds,
    headers: {
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(resetSeconds),
    },
  };
}
