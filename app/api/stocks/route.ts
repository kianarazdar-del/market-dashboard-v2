import { NextRequest, NextResponse } from "next/server"

const NAMES: Record<string,string> = {
  AMZN:"Amazon", TEM:"Tempus AI", INTC:"Intel", VOO:"Vanguard S&P 500 ETF",
  QQQM:"Invesco Nasdaq-100 ETF", VST:"Vistra Corp", TSLA:"Tesla",
  SMCI:"Super Micro Computer", PLTR:"Palantir", NVDA:"NVIDIA",
  MSFT:"Microsoft", GOOGL:"Alphabet (Google)", META:"Meta Platforms",
  AMD:"Advanced Micro Devices", ADBE:"Adobe", CRM:"Salesforce",
  ORCL:"Oracle", AVGO:"Broadcom",
}

const DESCRIPTIONS: Record<string,string> = {
  AMZN:"World's largest e-commerce company and cloud provider (AWS). Advertising is a major and fast-growing profit driver.",
  TEM:"Applies AI to healthcare — particularly oncology and genomics — helping doctors make better treatment decisions.",
  INTC:"Largest U.S. chip company by revenue. Undergoing a major transformation to rebuild its manufacturing competitiveness.",
  VOO:"Tracks the S&P 500 — 500 large U.S. companies. One of the world's lowest-cost index funds.",
  QQQM:"Tracks the Nasdaq-100 — 100 largest non-financial Nasdaq companies. Heavy tech exposure.",
  VST:"Major U.S. power generator with nuclear and natural gas assets. Increasingly viewed as an AI data center power play.",
  TSLA:"World's leading EV maker, plus energy storage and solar. CEO Elon Musk's actions significantly move the stock.",
  SMCI:"Makes high-performance servers for AI and data center workloads. Tightly tied to the GPU/AI build-out.",
  PLTR:"AI-powered data analytics platforms for government and enterprise. AIP is its key commercial growth product.",
  NVDA:"Designs GPUs that power AI training. The H100 and Blackwell chips made NVIDIA the defining AI infrastructure company.",
  MSFT:"Cloud (Azure), Office 365, and deep OpenAI partnership. Copilot AI is being embedded across all products.",
  GOOGL:"Google parent — search dominates revenue, but Google Cloud is growing fast. Racing to integrate AI everywhere.",
  META:"Facebook, Instagram, WhatsApp. Investing heavily in AI ad targeting and the metaverse via Reality Labs.",
  AMD:"CPUs and GPUs competing with Intel and NVIDIA. MI300X AI accelerators are gaining enterprise traction.",
  ADBE:"Creative software (Photoshop, Premiere, Acrobat). Firefly AI is being integrated across Creative Cloud.",
  CRM:"World's leading CRM platform. Einstein AI and Agentforce are central to automating enterprise workflows.",
  ORCL:"Enterprise databases, cloud infra, and business apps. OCI growing fast, partly driven by AI workload demand.",
  AVGO:"Diversified semiconductor company — networking, storage, wireless chips. Added major software business via VMware.",
}

// Cache TTLs
const TTL_QUOTES   = 60   // seconds
const TTL_HISTORY  = 300  // seconds — weekly/daily history changes slowly
const TTL_NEWS     = 300  // seconds

// ── Fetch all quotes in ONE batch request ────────────────────────────────────
async function fetchQuotesBatch(symbols: string[]) {
  const syms = symbols.map(encodeURIComponent).join(",")
  const fields = [
    "regularMarketPrice","regularMarketChange","regularMarketChangePercent",
    "regularMarketDayHigh","regularMarketDayLow",
    "fiftyTwoWeekHigh","fiftyTwoWeekLow","marketCap","trailingPE",
    "regularMarketVolume","sector","shortName",
  ].join(",")
  return yahooFetch(`/v7/finance/quote?symbols=${syms}&fields=${fields}`)
}

// ── Fetch history for one symbol (weekly 5y + daily 3mo in parallel) ─────────
async function fetchHistory(sym: string) {
  const cacheKey = `history:${sym}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const [r5y, r3m] = await Promise.all([
    yahooFetch(`/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=5y`),
    yahooFetch(`/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=3mo`),
  ])

  const weekly = r5y.data ? parseBars(r5y.data) : []
  const daily  = r3m.data ? parseBars(r3m.data) : []
  const result = { weekly, daily }

  // Only cache if we actually got data
  if (weekly.length || daily.length) cacheSet(cacheKey, result, TTL_HISTORY)
  return result
}

// ── Fetch news for all symbols in batch (one request per symbol is unavoidable) ──
// BUT: we cap to 3 news items and skip symbols with cached news
async function fetchNewsBatch(symbols: string[]) {
  const newsMap: Record<string, any[]> = {}

  // Only fetch news for symbols not already cached
  const needed = symbols.filter(sym => !cacheGet(`news:${sym}`))

  // Stagger requests slightly to avoid burst — fetch sequentially in small groups
  for (let i = 0; i < needed.length; i += 3) {
    const batch = needed.slice(i, i + 3)
    await Promise.all(batch.map(async sym => {
      const { data, rateLimited } = await yahooFetch(
        `/v1/finance/search?q=${encodeURIComponent(sym)}&newsCount=4&quotesCount=0`
      )
      if (!rateLimited && data) {
        const news = (data?.news ?? []).slice(0, 4).map((n: any) => ({
          title: n.title ?? "",
          url: n.link ?? "#",
          source: n.publisher ?? "Yahoo Finance",
          time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "",
        }))
        cacheSet(`news:${sym}`, news, TTL_NEWS)
      }
    }))
  }

  // Return all — from cache or empty
  symbols.forEach(sym => {
    newsMap[sym] = cacheGet(`news:${sym}`) ?? cacheGetStale(`news:${sym}`) ?? []
  })
  return newsMap
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? ""
  const symbols = raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
  if (!symbols.length) return NextResponse.json({ error: "no symbols" }, { status: 400 })

  const cacheKey = `stocks:${symbols.sort().join(",")}`

  // ── 1. Full cache hit — return immediately ────────────────────────────────
  const cached = cacheGet(cacheKey)
  if (cached) {
    return NextResponse.json({ data: cached, ts: Date.now(), cached: true })
  }

  // ── 2. Fetch quotes (single batch) ───────────────────────────────────────
  const { data: quoteData, rateLimited } = await fetchQuotesBatch(symbols)

  // ── 3. Handle 429 — serve stale ──────────────────────────────────────────
  if (rateLimited) {
    const stale = cacheGetStale(cacheKey)
    return NextResponse.json({
      data: stale ?? [],
      ts: Date.now(),
      rateLimited: true,
      warning: "Live data temporarily unavailable — showing most recent cached data.",
    })
  }

  const rawQuotes: any[] = quoteData?.quoteResponse?.result ?? []
  const quoteMap: Record<string,any> = {}
  rawQuotes.forEach((q: any) => { quoteMap[q.symbol] = q })

  // ── 4. Fetch history for all symbols in parallel ──────────────────────────
  const histories = await Promise.all(symbols.map(sym => fetchHistory(sym)))
  const histMap: Record<string,any> = {}
  symbols.forEach((sym, i) => { histMap[sym] = histories[i] })

  // ── 5. Fetch news (cached per-symbol, batched in groups of 3) ────────────
  const newsMap = await fetchNewsBatch(symbols)

  // ── 6. Assemble result ────────────────────────────────────────────────────
  const results = symbols.map(sym => {
    const q = quoteMap[sym] ?? {}
    const price = q.regularMarketPrice ?? 0
    const { weekly, daily } = histMap[sym] ?? { weekly: [], daily: [] }
    return {
      symbol: sym,
      name: NAMES[sym] ?? q.shortName ?? sym,
      desc: DESCRIPTIONS[sym] ?? "",
      price,
      change: q.regularMarketChange ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
      high: q.regularMarketDayHigh ?? 0,
      low: q.regularMarketDayLow ?? 0,
      week52High: q.fiftyTwoWeekHigh ?? 0,
      week52Low: q.fiftyTwoWeekLow ?? 0,
      marketCap: q.marketCap ?? null,
      pe: q.trailingPE ?? null,
      volume: q.regularMarketVolume ?? null,
      sector: q.sector ?? null,
      returns: computeReturns(weekly, price),
      spark: daily,
      news: newsMap[sym] ?? [],
    }
  })

  // ── 7. Cache the full assembled result ───────────────────────────────────
  cacheSet(cacheKey, results, TTL_QUOTES)

  return NextResponse.json({ data: results, ts: Date.now(), cached: false })
}
