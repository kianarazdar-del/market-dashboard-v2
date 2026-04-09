import { NextResponse } from "next/server"

async function fredFetch(seriesId: string, apiKey: string, limit = 120) {
  const obs = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`,
    { cache: "no-store" }
  )
  const json = await obs.json()
  return (json?.observations ?? [])
    .filter((o: any) => o.value !== ".")
    .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }))
    .reverse()
}

async function fetchRealEstateNews() {
  // Try HousingWire RSS, fall back to Yahoo Finance real estate search
  try {
    const res = await fetch("https://www.housingwire.com/feed/", {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml" },
      cache: "no-store",
    })
    const text = await res.text()
    const items = text.match(/<item[\s\S]*?<\/item>/gi) ?? []
    const parsed = items.slice(0, 8).map(block => {
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? ""
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "#"
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ""
      const desc = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]
        ?.replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&#\d+;/g,"").trim().slice(0, 180) ?? ""
      return { title: title.replace(/&amp;/g,"&").replace(/&#8217;/g,"'"), url: link, source: "HousingWire", time: pubDate ? new Date(pubDate).toISOString() : "", desc }
    }).filter(i => i.title)
    if (parsed.length) return parsed
  } catch {}
  // Fallback
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/search?q=real+estate+housing+market&newsCount=8&quotesCount=0",
      { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.yahoo.com/" }, cache: "no-store" }
    )
    const json = await res.json()
    return (json?.news ?? []).slice(0, 8).map((n: any) => ({
      title: n.title ?? "", url: n.link ?? "#", source: n.publisher ?? "Yahoo Finance",
      time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : "", desc: "",
    }))
  } catch { return [] }
}

export async function GET() {
  const apiKey = process.env.FRED_API_KEY
  if (!apiKey) {
    // Still return news even without API key
    const news = await fetchRealEstateNews()
    return NextResponse.json({
      error: "FRED_API_KEY not set — add it in Vercel environment variables for housing charts",
      caseShiller: null, mortgage: null, news, ts: Date.now()
    })
  }
  try {
    const [caseShiller, mortgage, news] = await Promise.all([
      fredFetch("CSUSHPINSA", apiKey, 120),
      fredFetch("MORTGAGE30US", apiKey, 104),
      fetchRealEstateNews(),
    ])
    return NextResponse.json({ caseShiller, mortgage, news, ts: Date.now() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
