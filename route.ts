/**
 * GET /api/fred
 *
 * FRED housing data + real estate news.
 * FRED is unchanged. News tries HousingWire RSS first, Yahoo Finance as fallback.
 * No dependency on Twelve Data — this route is self-contained.
 */
import { NextResponse } from "next/server"
import { cacheGet, cacheSet, cacheGetStale } from "@/lib/twelvedata"

const TTL_FRED = 3600   // 1hr — FRED data is monthly
const TTL_NEWS = 300    // 5min

async function fredFetch(seriesId: string, apiKey: string, limit = 120) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal })
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

async function fetchRealEstateNews(): Promise<any[]> {
  const key = "re:news"
  const hit = cacheGet(key)
  if (hit) return hit

  // 1. HousingWire RSS
  try {
    const res = await fetch("https://www.housingwire.com/feed/", {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml" },
      cache: "no-store",
    })
    const text = await res.text()
    const blocks = text.match(/<item[\s\S]*?<\/item>/gi) ?? []
    const items = blocks.slice(0, 8).map(b => {
      const title = b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? ""
      const link  = b.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "#"
      const pub   = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ""
      const desc  = b.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]
        ?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim().slice(0, 180) ?? ""
      return {
        title: title.replace(/&amp;/g, "&").replace(/&#8217;/g, "'"),
        url: link, source: "HousingWire",
        time: pub ? new Date(pub).toISOString() : "",
        desc,
      }
    }).filter(i => i.title)
    if (items.length) { cacheSet(key, items, TTL_NEWS); return items }
  } catch {}

  // 2. Yahoo Finance real estate news fallback (no API key needed)
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/search?q=real+estate+housing+market&newsCount=8&quotesCount=0",
      { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.yahoo.com/" }, cache: "no-store" }
    )
    const json = await res.json()
    const items = (json?.news ?? []).slice(0, 8).map((n: any) => ({
      title:  n.title ?? "",
      url:    n.link  ?? "#",
      source: n.publisher ?? "Yahoo Finance",
      time:   n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "",
      desc:   "",
    })).filter((n: any) => n.title)
    if (items.length) cacheSet(key, items, TTL_NEWS)
    return items
  } catch { return [] }
}

export async function GET() {
  const fredKey = process.env.FRED_API_KEY
  const news = await fetchRealEstateNews()

  if (!fredKey) {
    return NextResponse.json({
      error: "FRED_API_KEY not set — add it in Vercel Environment Variables for housing charts. Free key at fred.stlouisfed.org",
      caseShiller: null, mortgage: null, news, ts: Date.now(),
    })
  }

  const csCached = cacheGet("fred:cs")
  const mgCached = cacheGet("fred:mg")
  if (csCached && mgCached) {
    return NextResponse.json({ caseShiller: csCached, mortgage: mgCached, news, ts: Date.now(), cached: true })
  }

  try {
    const [caseShiller, mortgage] = await Promise.all([
      csCached ?? fredFetch("CSUSHPINSA",  fredKey, 120),
      mgCached ?? fredFetch("MORTGAGE30US", fredKey, 104),
    ])
    if (caseShiller.length) cacheSet("fred:cs", caseShiller, TTL_FRED)
    if (mortgage.length)    cacheSet("fred:mg", mortgage,    TTL_FRED)
    return NextResponse.json({ caseShiller, mortgage, news, ts: Date.now() })
  } catch (err: any) {
    return NextResponse.json({
      caseShiller: cacheGetStale("fred:cs"),
      mortgage:    cacheGetStale("fred:mg"),
      news,
      error: `FRED fetch failed: ${err.message}`,
      ts: Date.now(),
    })
  }
}
