/**
 * lib/twelvedata.ts
 *
 * Twelve Data API utility.
 *
 * Free tier: 800 requests/day, 8 requests/minute
 * Endpoints used:
 *   /price           — single symbol real-time price (free)
 *   /batch_price     — NOT available on Twelve Data; we use /quote with comma-joined symbols instead
 *   /quote           — full quote for 1 symbol (open, high, low, close, change, volume, 52w) — free
 *                      Multiple symbols comma-joined = one request (returns object keyed by symbol)
 *   /time_series     — OHLCV bars for one symbol — free
 *   /news            — market news — free
 *
 * Key advantage over Yahoo/AV: /quote accepts comma-separated symbols in one call.
 * 15 symbols in one /quote request = 1 API call.
 *
 * Rate limit signaled by: HTTP 429, or JSON { "code": 429, "message": "..." }
 */

const TD_BASE = "https://api.twelvedata.com"

// ─── In-memory cache ──────────────────────────────────────────────────────────
interface CacheEntry { data: any; expiresAt: number }
const cache = new Map<string, CacheEntry>()

export function cacheGet(key: string): any | null {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { cache.delete(key); return null }
  return e.data
}
export function cacheGetStale(key: string): any | null {
  return cache.get(key)?.data ?? null
}
export function cacheSet(key: string, data: any, ttlSeconds: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 })
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

export interface TDResult {
  data: any | null
  rateLimited: boolean
  error: string | null
}

export async function tdFetch(
  path: string,
  params: Record<string, string>
): Promise<TDResult> {
  const apiKey = process.env.TWELVE_DATA_API_KEY
  if (!apiKey) {
    return { data: null, rateLimited: false, error: "TWELVE_DATA_API_KEY not set" }
  }

  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString()
  const url = `${TD_BASE}${path}?${qs}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal })

    if (res.status === 429) {
      console.warn("[td] 429 rate-limited")
      return { data: null, rateLimited: true, error: "Rate limited (429)" }
    }

    if (!res.ok) {
      return { data: null, rateLimited: false, error: `HTTP ${res.status}` }
    }

    const json = await res.json()

    // Twelve Data signals errors in the JSON body
    // { "code": 429, "message": "You have run out of API credits..." }
    // { "code": 400, "message": "..." } for bad symbol etc.
    if (json?.code === 429 || json?.status === "error" && json?.message?.includes("credits")) {
      console.warn("[td] rate limited via JSON:", json.message?.slice(0, 80))
      return { data: null, rateLimited: true, error: json.message ?? "Rate limited" }
    }

    if (json?.code >= 400 && json?.message) {
      console.warn("[td] API error:", json.message?.slice(0, 80))
      return { data: null, rateLimited: false, error: json.message }
    }

    return { data: json, rateLimited: false, error: null }
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? "Request timed out" : (err?.message ?? "Unknown error")
    return { data: null, rateLimited: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Quote batch fetch ────────────────────────────────────────────────────────
// Twelve Data /quote accepts comma-separated symbols: one HTTP call, N symbols.
// Returns either a single object (1 symbol) or object keyed by symbol (N symbols).

export interface TDQuote {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number
  week52High: number
  week52Low: number
}

export async function fetchQuotes(symbols: string[]): Promise<{
  quotes: Record<string, TDQuote>
  rateLimited: boolean
}> {
  const cacheKey = `td:quotes:${symbols.slice().sort().join(",")}`
  const cached = cacheGet(cacheKey)
  if (cached) return { quotes: cached, rateLimited: false }

  const { data, rateLimited, error } = await tdFetch("/quote", {
    symbol: symbols.join(","),
    interval: "1day",
  })

  if (rateLimited) {
    return { quotes: cacheGetStale(cacheKey) ?? {}, rateLimited: true }
  }
  if (error || !data) {
    return { quotes: cacheGetStale(cacheKey) ?? {}, rateLimited: false }
  }

  // Normalize: single symbol returns the object directly; multiple returns { SYM: {...}, ... }
  const raw: Record<string, any> = symbols.length === 1
    ? { [symbols[0]]: data }
    : data

  const quotes: Record<string, TDQuote> = {}
  for (const [sym, q] of Object.entries(raw)) {
    if (!q || (q as any).code >= 400) continue  // Symbol not found / error
    const qd = q as any
    const p = parseFloat(qd.close ?? qd.price ?? "0")
    const prev = parseFloat(qd.previous_close ?? "0")
    const change = parseFloat(qd.change ?? String(p - prev))
    const changePctRaw = qd.percent_change ?? qd.change_percent ?? "0"
    const changePct = parseFloat(String(changePctRaw).replace("%", ""))
    quotes[sym] = {
      symbol:     sym,
      name:       qd.name ?? sym,
      price:      p,
      change,
      changePct:  isNaN(changePct) ? 0 : changePct,
      open:       parseFloat(qd.open ?? "0"),
      high:       parseFloat(qd.high ?? "0"),
      low:        parseFloat(qd.low ?? "0"),
      prevClose:  prev,
      volume:     parseInt(qd.volume ?? "0", 10),
      week52High: parseFloat(qd["52_week"]?.high ?? qd.fifty_two_week?.high ?? "0"),
      week52Low:  parseFloat(qd["52_week"]?.low  ?? qd.fifty_two_week?.low  ?? "0"),
    }
  }

  // Cache 60s — prices change during trading hours
  cacheSet(cacheKey, quotes, 60)
  return { quotes, rateLimited: false }
}

// ─── Time series (daily bars) ─────────────────────────────────────────────────
// Used for sparklines (last 90 days) and return calculations (5 years).
// We fetch 5 years in one call and slice as needed.

export interface Bar { date: string; close: number }

export async function fetchTimeSeries(symbol: string): Promise<{
  bars: Bar[]
  rateLimited: boolean
}> {
  const cacheKey = `td:ts:${symbol}`
  const cached = cacheGet(cacheKey)
  if (cached) return { bars: cached, rateLimited: false }

  const { data, rateLimited, error } = await tdFetch("/time_series", {
    symbol,
    interval:    "1day",
    outputsize:  "5000",  // ~20 years of daily bars
    order:       "ASC",
  })

  if (rateLimited) return { bars: cacheGetStale(cacheKey) ?? [], rateLimited: true }
  if (error || !data) return { bars: cacheGetStale(cacheKey) ?? [], rateLimited: false }

  const rawValues: any[] = data?.values ?? []
  const bars: Bar[] = rawValues
    .map((v: any) => ({
      date:  v.datetime?.split(" ")[0] ?? v.datetime ?? "",
      close: parseFloat(v.close ?? "0"),
    }))
    .filter(b => b.date && b.close > 0)

  // Already ASC from API, but guarantee sort
  bars.sort((a, b) => a.date.localeCompare(b.date))

  // Cache 6 hours — daily bars only update once per trading day
  if (bars.length) cacheSet(cacheKey, bars, 6 * 3600)
  return { bars, rateLimited: false }
}

// ─── News ─────────────────────────────────────────────────────────────────────

export interface NewsItem {
  title: string; url: string; source: string; time: string; desc: string
}

export async function fetchNews(symbol: string, limit = 5): Promise<NewsItem[]> {
  const cacheKey = `td:news:${symbol}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const { data, rateLimited } = await tdFetch("/news", {
    symbol,
    outputsize: String(limit),
  })

  if (rateLimited || !data) return cacheGetStale(cacheKey) ?? []

  const items: NewsItem[] = (Array.isArray(data) ? data : data?.data ?? [])
    .slice(0, limit)
    .map((n: any) => ({
      title:  n.title ?? "",
      url:    n.url ?? n.link ?? "#",
      source: n.source ?? n.publisher ?? "Twelve Data",
      time:   n.datetime
        ? new Date(n.datetime).toISOString()
        : n.published_at ?? new Date().toISOString(),
      desc:   (n.description ?? n.summary ?? "").slice(0, 160),
    }))
    .filter((n: NewsItem) => n.title)

  if (items.length) cacheSet(cacheKey, items, 600)
  return items
}

// ─── Return calculations ──────────────────────────────────────────────────────

function findBase(bars: Bar[], targetDate: string): number | null {
  let base: number | null = null
  for (const b of bars) {
    if (b.date <= targetDate) base = b.close
    else break
  }
  return base
}

function retPct(bars: Bar[], price: number, targetDate: string): number | null {
  const base = findBase(bars, targetDate)
  if (!base || base <= 0) return null
  return ((price - base) / base) * 100
}

export function computeReturns(bars: Bar[], price: number) {
  if (!bars.length) return { w1: null, m1: null, ytd: null, y1: null, y5: null }
  const latest = bars[bars.length - 1].date
  const off = (n: number, u: "d" | "m" | "y") => {
    const dt = new Date(latest)
    if (u === "d") dt.setDate(dt.getDate() - n)
    if (u === "m") dt.setMonth(dt.getMonth() - n)
    if (u === "y") dt.setFullYear(dt.getFullYear() - n)
    return dt.toISOString().split("T")[0]
  }
  return {
    w1:  retPct(bars, price, off(7, "d")),
    m1:  retPct(bars, price, off(1, "m")),
    ytd: retPct(bars, price, latest.slice(0, 4) + "-01-01"),
    y1:  retPct(bars, price, off(1, "y")),
    y5:  retPct(bars, price, off(5, "y")),
  }
}
