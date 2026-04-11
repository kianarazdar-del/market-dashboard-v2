import { NextResponse } from "next/server"

const TTL_FRED = 3600  // FRED data is published monthly — 1hr cache is fine
const TTL_NEWS = 300

async function fredFetch(seriesId: string, apiKey: string, limit = 120) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal })
    if (!res.ok) throw new Error(`FRED ${res.status}`)
    const json = await res.json()
    return (json?.observations ?? [])
      .filter((o: any) => o.value !== ".")
      .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }))
      .reverse()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRealEstateNews() {
  const cacheKey = "re:news"
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  // Try HousingWire RSS
  try {
    const res = await fetch("https://www.housingwire.com/feed/", {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml" },
      cache: "no-store",
    })
    const text = await res.text()
    const items = text.match(/<item[\s\S]*?<\/item>/gi) ?? []
    const parsed = items.slice(0, 8).map(block => {
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? ""
      const link  = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "#"
      const pub   = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ""
      const desc  = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]
        ?.replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&#\d+;/g,"").trim().slice(0,180) ?? ""
      return {
        title: title.replace(/&amp;/g,"&").replace(/&#8217;/g,"'"),
        url: link, source: "HousingWire",
        time: pub ? new Date(pub).toISOString() : "",
        desc,
      }
    }).filter(i => i.title)
    if (parsed.length) {
      cacheSet(cacheKey, parsed, TTL_NEWS)
      return parsed
    }
  } catch {}

  // Fallback: Yahoo Finance real estate news
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/search?q=real+estate+housing+market&newsCount=8&quotesCount=0",
      { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.yahoo.com/" }, cache: "no-store" }
    )
    const json = await res.json()
    const items = (json?.news ?? []).slice(0, 8).map((n: any) => ({
      title: n.title ?? "", url: n.link ?? "#",
      source: n.publisher ?? "Yahoo Finance",
      time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "",
      desc: "",
    }))
    if (items.length) cacheSet(cacheKey, items, TTL_NEWS)
    return items
  } catch { return [] }
}

export async function GET() {
  const apiKey = process.env.FRED_API_KEY

  // Always fetch news (has its own cache)
  const news = await fetchRealEstateNews()

  if (!apiKey) {
    return NextResponse.json({
      error: "FRED_API_KEY not set — add it in Vercel Environment Variables for housing charts",
      caseShiller: null, mortgage: null, news, ts: Date.now(),
    })
  }

  // Check FRED cache
  const csCached = cacheGet("fred:cs")
  const mgCached = cacheGet("fred:mg")
  if (csCached && mgCached) {
    return NextResponse.json({ caseShiller: csCached, mortgage: mgCached, news, ts: Date.now(), cached: true })
  }

  // Fetch FRED data (not Yahoo — no 429 concern here)
  try {
    const [caseShiller, mortgage] = await Promise.all([
      csCached ?? fredFetch("CSUSHPINSA", apiKey, 120),
      mgCached ?? fredFetch("MORTGAGE30US", apiKey, 104),
    ])
    if (caseShiller.length) cacheSet("fred:cs", caseShiller, TTL_FRED)
    if (mortgage.length)    cacheSet("fred:mg", mortgage,    TTL_FRED)
    return NextResponse.json({ caseShiller, mortgage, news, ts: Date.now() })
  } catch (err: any) {
    // Return stale FRED data if available
    return NextResponse.json({
      caseShiller: cacheGetStale("fred:cs"),
      mortgage: cacheGetStale("fred:mg"),
      news,
      error: `FRED fetch failed: ${err.message}`,
      ts: Date.now(),
    })
  }
}
