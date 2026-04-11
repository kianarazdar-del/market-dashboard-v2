import { NextResponse } from "next/server"

const SYMBOLS      = ["^GSPC","^IXIC","^DJI","^RUT","^VIX","^TNX","BTC-USD","ETH-USD","CL=F"]
const SPARK_SYMS   = ["^GSPC","^IXIC","BTC-USD"]
const TTL_QUOTES   = 60
const TTL_SPARKS   = 300
const TTL_NEWS     = 300
const KEY_QUOTES   = "market:quotes"
const KEY_SPARKS   = "market:sparks"
const KEY_NEWS     = "market:news"

const NAMES: Record<string,string> = {
  "^GSPC":"S&P 500","^IXIC":"Nasdaq","^DJI":"Dow Jones","^RUT":"Russell 2000",
  "^VIX":"VIX (Fear Index)","^TNX":"10-Yr Treasury Yield",
  "BTC-USD":"Bitcoin","ETH-USD":"Ethereum","CL=F":"Crude Oil (WTI)",
}

async function fetchQuotes() {
  const fields = [
    "regularMarketPrice","regularMarketChange","regularMarketChangePercent",
    "regularMarketPreviousClose","regularMarketDayHigh","regularMarketDayLow",
    "fiftyTwoWeekHigh","fiftyTwoWeekLow","regularMarketTime",
  ].join(",")
  const syms = SYMBOLS.map(encodeURIComponent).join(",")
  const { data, rateLimited, error } = await yahooFetch(
    `/v7/finance/quote?symbols=${syms}&fields=${fields}`
  )
  if (rateLimited) return { quotes: null, rateLimited: true }
  if (error || !data) return { quotes: null, rateLimited: false }
  const quotes = (data?.quoteResponse?.result ?? []).map((q: any) => ({
    symbol:    q.symbol,
    name:      NAMES[q.symbol] ?? q.shortName ?? q.symbol,
    price:     q.regularMarketPrice ?? 0,
    change:    q.regularMarketChange ?? 0,
    changePct: q.regularMarketChangePercent ?? 0,
    high:      q.regularMarketDayHigh ?? 0,
    low:       q.regularMarketDayLow ?? 0,
    week52High: q.fiftyTwoWeekHigh ?? 0,
    week52Low:  q.fiftyTwoWeekLow ?? 0,
    time:       q.regularMarketTime ?? 0,
  }))
  return { quotes, rateLimited: false }
}

async function fetchSparks(): Promise<Record<string,any[]>> {
  const sparks: Record<string,any[]> = {}
  await Promise.all(
    SPARK_SYMS.map(async sym => {
      const { data, rateLimited } = await yahooFetch(
        `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo`
      )
      sparks[sym] = (!rateLimited && data) ? parseBars(data) : []
    })
  )
  return sparks
}

async function fetchNews() {
  const { data, rateLimited } = await yahooFetch(
    `/v1/finance/search?q=%5EGSPC&newsCount=8&quotesCount=0`
  )
  if (rateLimited || !data) return []
  return (data?.news ?? []).slice(0, 8).map((n: any) => ({
    title:  n.title ?? "",
    url:    n.link ?? "#",
    source: n.publisher ?? "Yahoo Finance",
    time:   n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "",
  }))
}

export async function GET() {
  // ── 1. Full cache hit ────────────────────────────────────────────────────
  const cQ = cacheGet(KEY_QUOTES)
  const cS = cacheGet(KEY_SPARKS)
  const cN = cacheGet(KEY_NEWS)
  if (cQ && cS && cN) {
    return NextResponse.json({ quotes: cQ, sparks: cS, news: cN, ts: Date.now(), cached: true })
  }

  // ── 2. Fetch quotes + news in parallel ───────────────────────────────────
  const [{ quotes, rateLimited }, newsFetch] = await Promise.all([
    fetchQuotes(),
    cN ? Promise.resolve(cN) : fetchNews(),
  ])

  // ── 3. 429 — serve stale ─────────────────────────────────────────────────
  if (rateLimited) {
    return NextResponse.json({
      quotes:      cacheGetStale(KEY_QUOTES) ?? [],
      sparks:      cacheGetStale(KEY_SPARKS) ?? {},
      news:        cacheGetStale(KEY_NEWS)   ?? [],
      ts:          Date.now(),
      rateLimited: true,
      warning:     "Live data temporarily rate-limited — showing most recent cached data.",
    })
  }

  // ── 4. Fetch sparks (only once quotes confirmed OK) ──────────────────────
  const sparks = cS ?? await fetchSparks()

  // ── 5. Cache everything ──────────────────────────────────────────────────
  if (quotes)        cacheSet(KEY_QUOTES, quotes,    TTL_QUOTES)
  if (sparks)        cacheSet(KEY_SPARKS, sparks,    TTL_SPARKS)
  if (newsFetch?.length) cacheSet(KEY_NEWS, newsFetch, TTL_NEWS)

  return NextResponse.json({
    quotes: quotes ?? [],
    sparks: sparks ?? {},
    news:   newsFetch ?? [],
    ts:     Date.now(),
    cached: false,
  })
}
