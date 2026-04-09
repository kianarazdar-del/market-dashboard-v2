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

async function fetchQuotes(symbols: string[]) {
  const syms = symbols.map(encodeURIComponent).join(",")
  const fields = "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,regularMarketDayHigh,regularMarketDayLow,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketCap,trailingPE,regularMarketVolume,sector"
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}&fields=${fields}`
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://finance.yahoo.com/",
    },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Yahoo ${res.status}`)
  const json = await res.json()
  return json?.quoteResponse?.result ?? []
}

// Fetch weekly bars for return calculations + daily bars for sparkline
async function fetchHistory(symbol: string) {
  try {
    // 5y weekly for returns
    const url5y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1wk&range=5y`
    const url3m = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`
    const hdrs = {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://finance.yahoo.com/",
    }
    const [r5y, r3m] = await Promise.all([
      fetch(url5y, { headers: hdrs, cache: "no-store" }),
      fetch(url3m, { headers: hdrs, cache: "no-store" }),
    ])
    const [j5y, j3m] = await Promise.all([r5y.json(), r3m.json()])

    const parseBars = (json: any) => {
      const result = json?.chart?.result?.[0]
      if (!result) return []
      const ts: number[] = result.timestamp ?? []
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? []
      return ts.map((t, i) => ({
        date: new Date(t * 1000).toISOString().split("T")[0],
        close: closes[i] ?? null,
      })).filter(d => d.close != null && d.close > 0)
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    return { weekly: parseBars(j5y), daily: parseBars(j3m) }
  } catch { return { weekly: [], daily: [] } }
}

// Compute return % from sorted bar array
function ret(bars: any[], currentPrice: number, targetDate: string): number | null {
  let base = null
  for (const b of bars) {
    if (b.date <= targetDate) base = b.close
    else break
  }
  if (!base || base <= 0) return null
  return ((currentPrice - base) / base) * 100
}

function computeReturns(bars: any[], price: number) {
  if (!bars.length) return { w1: null, m1: null, ytd: null, y1: null, y5: null }
  const latest = bars[bars.length - 1].date
  const d = (n: number, unit: "d"|"m"|"y") => {
    const dt = new Date(latest)
    if (unit === "d") dt.setDate(dt.getDate() - n)
    if (unit === "m") dt.setMonth(dt.getMonth() - n)
    if (unit === "y") dt.setFullYear(dt.getFullYear() - n)
    return dt.toISOString().split("T")[0]
  }
  const ytdDate = latest.substring(0, 4) + "-01-01"
  return {
    w1:  ret(bars, price, d(7, "d")),
    m1:  ret(bars, price, d(1, "m")),
    ytd: ret(bars, price, ytdDate),
    y1:  ret(bars, price, d(1, "y")),
    y5:  ret(bars, price, d(5, "y")),
  }
}

async function fetchNews(symbol: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=5&quotesCount=0`
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.yahoo.com/" },
      cache: "no-store",
    })
    const json = await res.json()
    return (json?.news ?? []).slice(0, 5).map((n: any) => ({
      title: n.title ?? "",
      url: n.link ?? "#",
      source: n.publisher ?? "Yahoo Finance",
      time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "",
    }))
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? ""
  const symbols = raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
  if (!symbols.length) return NextResponse.json({ error: "no symbols" }, { status: 400 })

  try {
    const rawQuotes = await fetchQuotes(symbols)
    const quoteMap: Record<string, any> = {}
    rawQuotes.forEach((q: any) => { quoteMap[q.symbol] = q })

    const results = await Promise.all(symbols.map(async sym => {
      const q = quoteMap[sym] ?? {}
      const price = q.regularMarketPrice ?? 0
      const { weekly, daily } = await fetchHistory(sym)
      const returns = computeReturns(weekly, price)
      const news = await fetchNews(sym)
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
        returns,
        spark: daily,
        news,
      }
    }))

    return NextResponse.json({ data: results, ts: Date.now() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
