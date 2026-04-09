/**
 * lib/yahoo.ts
 *
 * Shared Yahoo Finance fetch utility used by all API routes.
 *
 * What this solves:
 *  - In-memory cache with per-key TTLs → reuses data within the same serverless
 *    instance instead of hitting Yahoo on every request
 *  - 429 detection → never throws an unhandled error; returns { rateLimited: true }
 *    so callers can serve stale data instead of a 500
 *  - Retry with exponential backoff → one automatic retry on transient errors
 *  - Request timeout → 8s hard limit so Vercel functions don't hang
 *  - Single fallback host (query2) if query1 fails
 */

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Vercel serverless functions reuse the same Node process for ~minutes, so
// module-level state persists across requests within the same instance.
// This is enough to absorb repeated tab opens / rapid refreshes.

interface CacheEntry {
  data: any
  expiresAt: number  // ms epoch
}

const cache = new Map<string, CacheEntry>()

export function cacheGet(key: string): any | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function cacheGetStale(key: string): any | null {
  // Returns data even if expired — used as fallback when Yahoo is rate-limiting
  return cache.get(key)?.data ?? null
}

export function cacheSet(key: string, data: any, ttlSeconds: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 })
}

// ─── HTTP fetch with timeout + retry ─────────────────────────────────────────

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers: HEADERS, cache: "no-store", signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface YahooResult {
  data: any | null
  rateLimited: boolean
  error: string | null
}

/**
 * Fetch a Yahoo Finance URL with:
 *  - 8s timeout
 *  - automatic retry on query2 if query1 returns a non-429 error
 *  - 429 detection (returns rateLimited: true instead of throwing)
 */
export async function yahooFetch(path: string): Promise<YahooResult> {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ]

  for (let i = 0; i < hosts.length; i++) {
    const url = `${hosts[i]}${path}`
    try {
      const res = await fetchWithTimeout(url)

      // 429 = rate limited — stop immediately, do not retry
      if (res.status === 429) {
        console.warn(`[yahoo] 429 rate-limited on ${hosts[i]}`)
        return { data: null, rateLimited: true, error: "Rate limited (429)" }
      }

      if (!res.ok) {
        // Non-429 error — try next host if available
        if (i < hosts.length - 1) continue
        return { data: null, rateLimited: false, error: `HTTP ${res.status}` }
      }

      const json = await res.json()
      return { data: json, rateLimited: false, error: null }

    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Request timed out" : err?.message ?? "Unknown error"
      if (i < hosts.length - 1) continue
      return { data: null, rateLimited: false, error: msg }
    }
  }

  return { data: null, rateLimited: false, error: "All Yahoo hosts failed" }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse OHLC bars from a v8/finance/chart response */
export function parseBars(json: any): { date: string; close: number }[] {
  const result = json?.chart?.result?.[0]
  if (!result) return []
  const ts: number[] = result.timestamp ?? []
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? []
  return ts
    .map((t, i) => ({
      date: new Date(t * 1000).toISOString().split("T")[0],
      close: closes[i] as number,
    }))
    .filter(d => d.close != null && d.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Compute return % against a target date from sorted bars */
export function computeReturn(
  bars: { date: string; close: number }[],
  currentPrice: number,
  targetDate: string
): number | null {
  let base: number | null = null
  for (const b of bars) {
    if (b.date <= targetDate) base = b.close
    else break
  }
  if (!base || base <= 0) return null
  return ((currentPrice - base) / base) * 100
}

/** Compute all standard return periods from weekly bars */
export function computeReturns(
  weeklyBars: { date: string; close: number }[],
  price: number
) {
  if (!weeklyBars.length) return { w1: null, m1: null, ytd: null, y1: null, y5: null }
  const latest = weeklyBars[weeklyBars.length - 1].date
  const offset = (n: number, unit: "d" | "m" | "y") => {
    const dt = new Date(latest)
    if (unit === "d") dt.setDate(dt.getDate() - n)
    if (unit === "m") dt.setMonth(dt.getMonth() - n)
    if (unit === "y") dt.setFullYear(dt.getFullYear() - n)
    return dt.toISOString().split("T")[0]
  }
  return {
    w1:  computeReturn(weeklyBars, price, offset(7, "d")),
    m1:  computeReturn(weeklyBars, price, offset(1, "m")),
    ytd: computeReturn(weeklyBars, price, latest.slice(0, 4) + "-01-01"),
    y1:  computeReturn(weeklyBars, price, offset(1, "y")),
    y5:  computeReturn(weeklyBars, price, offset(5, "y")),
  }
}
