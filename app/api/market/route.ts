import { NextResponse } from "next/server"

// Symbols for market overview tab
const SYMBOLS = ["^GSPC","^IXIC","^DJI","^RUT","^VIX","^TNX","BTC-USD","ETH-USD","CL=F"]

const NAMES: Record<string,string> = {
  "^GSPC":"S&P 500","^IXIC":"Nasdaq","^DJI":"Dow Jones","^RUT":"Russell 2000",
  "^VIX":"VIX (Fear Index)","^TNX":"10-Yr Treasury Yield",
  "BTC-USD":"Bitcoin","ETH-USD":"Ethereum","CL=F":"Crude Oil (WTI)",
}

async function fetchYahoo(symbols: string[]) {
  const fields = [
    "regularMarketPrice","regularMarketChange","regularMarketChangePercent",
    "regularMarketPreviousClose","regularMarketDayHigh","regularMarketDayLow",
    "fiftyTwoWeekHigh","fiftyTwoWeekLow","regularMarketTime"
  ].join(",")
  const syms = symbols.map(encodeURIComponent).join(",")
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}&fields=${fields}`
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://finance.yahoo.com/",
    },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Yahoo returned ${res.status}`)
  const json = await res.json()
  return json?.quoteResponse?.result ?? []
}

async function fetchSparkline(symbol: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.yahoo.com/" },
      cache: "no-store",
    })
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []
    const timestamps: number[] = result.timestamp ?? []
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? []
    return timestamps.map((t, i) => ({
      date: new Date(t * 1000).toISOString().split("T")[0],
      close: closes[i] ?? null,
    })).filter(d => d.close != null)
  } catch { return [] }
}

async function fetchNews() {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=%5EGSPC&newsCount=8&quotesCount=0`
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.yahoo.com/" },
      cache: "no-store",
    })
    const json = await res.json()
    return (json?.news ?? []).slice(0, 8).map((n: any) => ({
      title: n.title ?? "",
      url: n.link ?? "#",
      source: n.publisher ?? "Yahoo Finance",
      time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "",
    }))
  } catch { return [] }
}

export async function GET() {
  try {
    const [rawQuotes, news] = await Promise.all([
      fetchYahoo(SYMBOLS),
      fetchNews(),
    ])

    const quotes = rawQuotes.map((q: any) => ({
      symbol: q.symbol,
      name: NAMES[q.symbol] ?? q.shortName ?? q.symbol,
      price: q.regularMarketPrice ?? 0,
      change: q.regularMarketChange ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
      high: q.regularMarketDayHigh ?? 0,
      low: q.regularMarketDayLow ?? 0,
      week52High: q.fiftyTwoWeekHigh ?? 0,
      week52Low: q.fiftyTwoWeekLow ?? 0,
      time: q.regularMarketTime ?? 0,
    }))

    // Fetch sparklines for major indices in parallel
    const sparkSymbols = ["^GSPC","^IXIC","BTC-USD"]
    const sparkData = await Promise.all(sparkSymbols.map(s => fetchSparkline(s)))
    const sparks: Record<string, any[]> = {}
    sparkSymbols.forEach((s, i) => { sparks[s] = sparkData[i] })

    return NextResponse.json({ quotes, sparks, news, ts: Date.now() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
