"use client"
import { useState, useEffect, useCallback, useMemo, Fragment } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts"
import {
  RefreshCw, TrendingUp, TrendingDown, ChevronDown, ExternalLink,
  BarChart2, Star, Home, Cpu, Clock, AlertTriangle
} from "lucide-react"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number | null, dec = 2) {
  if (v == null || isNaN(v)) return "N/A"
  return (v >= 0 ? "+" : "") + v.toFixed(dec) + "%"
}
function price(v: number) {
  if (!v) return "—"
  if (v > 1000) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return "$" + v.toFixed(2)
}
function cap(v: number | null) {
  if (!v) return "—"
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T"
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B"
  return "$" + (v / 1e6).toFixed(0) + "M"
}
function ago(iso: string) {
  if (!iso) return ""
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return Math.floor(s / 60) + "m ago"
  if (s < 86400) return Math.floor(s / 3600) + "h ago"
  return Math.floor(s / 86400) + "d ago"
}
function cls(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" ") }

// ─── Shared UI ────────────────────────────────────────────────────────────────

function ReturnBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-xs px-2 py-0.5 rounded neutral-bg font-mono">N/A</span>
  return (
    <span className={cls("text-xs px-2 py-0.5 rounded font-mono font-semibold", v >= 0 ? "up-bg" : "down-bg")}>
      {pct(v)}
    </span>
  )
}

function Spark({ data, up }: { data: { date: string; close: number }[]; up: boolean }) {
  if (!data?.length) return <div className="w-20 h-9" />
  return (
    <ResponsiveContainer width={80} height={36}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="close" stroke={up ? "#10b981" : "#ef4444"} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <YAxis domain={["auto", "auto"]} hide />
      </LineChart>
    </ResponsiveContainer>
  )
}

function NewsItem({ item }: { item: any }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="flex items-start gap-3 p-3 rounded-lg bg-[#0f1117] border border-[#1e2433] hover:border-[#2d3a50] transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 group-hover:text-white leading-snug line-clamp-2">{item.title}</p>
        <p className="text-xs text-slate-500 mt-1">{item.source} · {ago(item.time)}</p>
        {item.desc && <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.desc}</p>}
      </div>
      <ExternalLink size={11} className="text-slate-600 group-hover:text-slate-400 mt-0.5 shrink-0" />
    </a>
  )
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cls("skeleton", className)} />
}

function RefreshBar({ ts, onRefresh, loading }: { ts: number; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {ts > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock size={11} />
          {new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
        </span>
      )}
      <button onClick={onRefresh} disabled={loading}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#1e2433] bg-[#111318] text-slate-400 hover:text-slate-200 hover:border-[#2d3a50] transition-all disabled:opacity-50">
        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        {loading ? "Loading…" : "Refresh"}
      </button>
    </div>
  )
}

// ─── Tab 1: Market Overview ───────────────────────────────────────────────────

function buildSummary(quotes: any[]): string[] {
  const get = (sym: string) => quotes.find(q => q.symbol === sym)
  const sp = get("^GSPC"), nq = get("^IXIC"), vix = get("^VIX"), tnx = get("^TNX"), btc = get("BTC-USD")
  const lines: string[] = []

  if (sp) {
    const p = sp.changePct
    if (p > 0.5) lines.push(`U.S. stocks are rallying — the S&P 500 is up ${pct(p)} today, indicating broad market strength.`)
    else if (p < -0.5) lines.push(`U.S. stocks are selling off — the S&P 500 is down ${pct(p)} today.`)
    else lines.push(`The S&P 500 is essentially flat today (${pct(p)}), with no strong directional move.`)
  }
  if (sp && nq) {
    const diff = nq.changePct - sp.changePct
    if (diff > 0.4) lines.push(`Tech is outperforming — the Nasdaq is beating the S&P 500 by ${diff.toFixed(1)} percentage points.`)
    else if (diff < -0.4) lines.push(`Tech is lagging today — the Nasdaq is trailing the S&P 500 by ${Math.abs(diff).toFixed(1)} points.`)
    else lines.push(`Tech and the broad market are moving in sync today.`)
  }
  if (vix) {
    const v = vix.price
    if (v < 15) lines.push(`Volatility is low (VIX ${v.toFixed(1)}) — investors appear calm and confident.`)
    else if (v < 20) lines.push(`Volatility is moderate (VIX ${v.toFixed(1)}) — some caution but no panic.`)
    else if (v < 30) lines.push(`Volatility is elevated (VIX ${v.toFixed(1)}) — expect larger daily swings.`)
    else lines.push(`Volatility is very high (VIX ${v.toFixed(1)}) — significant fear in the market.`)
  }
  if (tnx) {
    const y = tnx.price
    lines.push(`The 10-year Treasury yield is at ${y.toFixed(2)}%${tnx.changePct > 0.5 ? " and rising, which can pressure stock valuations" : tnx.changePct < -0.5 ? " and falling, suggesting a flight to safety" : " — stable today"}.`)
  }
  if (btc) {
    if (btc.changePct > 2) lines.push(`Bitcoin is up ${pct(btc.changePct)} — crypto is joining the risk-on move.`)
    else if (btc.changePct < -2) lines.push(`Bitcoin is down ${pct(btc.changePct)} — crypto weakness signals risk-off sentiment.`)
  }
  return lines
}

function MarketOverview() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const res = await fetch("/api/market")
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const indices = data?.quotes?.filter((q: any) => ["^GSPC","^IXIC","^DJI","^RUT"].includes(q.symbol)) ?? []
  const macros  = data?.quotes?.filter((q: any) => ["^VIX","^TNX"].includes(q.symbol)) ?? []
  const crypto  = data?.quotes?.filter((q: any) => ["BTC-USD","ETH-USD"].includes(q.symbol)) ?? []
  const oil     = data?.quotes?.find((q: any) => q.symbol === "CL=F")
  const summary = data ? buildSummary(data.quotes) : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Market Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">Live indices, bonds, crypto & commodities</p>
        </div>
        <RefreshBar ts={data?.ts ?? 0} onRefresh={load} loading={loading} />
      </div>

      {error && (
        <div className="card p-4 flex items-center gap-3 border-red-900/40">
          <AlertTriangle size={16} className="text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Summary */}
      {loading && !data ? (
        <div className="card p-5 space-y-2"><Skeleton className="h-4 w-48 mb-3" />{[1,2,3].map(i=><Skeleton key={i} className="h-3 w-full" />)}</div>
      ) : summary.length > 0 && (
        <div className="card p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            {summary.some((_, i) => i === 0 && data?.quotes?.find((q:any)=>q.symbol==="^GSPC")?.changePct > 0)
              ? <TrendingUp size={13} className="up" /> : <TrendingDown size={13} className="down" />}
            Today's Market Snapshot
          </p>
          <div className="space-y-2">
            {summary.map((s, i) => (
              <p key={i} className="text-sm text-slate-300 leading-relaxed pl-3 border-l-2 border-[#1e2433]">{s}</p>
            ))}
          </div>
        </div>
      )}

      {/* Indices */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Major Indices</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading && !data ? [1,2,3,4].map(i=>(
            <div key={i} className="card p-4"><Skeleton className="h-3 w-20 mb-2" /><Skeleton className="h-7 w-28 mb-1" /><Skeleton className="h-3 w-16" /></div>
          )) : indices.map((q: any) => {
            const up = q.changePct >= 0
            const spark = data?.sparks?.[q.symbol] ?? []
            return (
              <div key={q.symbol} className="card p-4">
                <p className="text-xs text-slate-500 mb-1">{q.name}</p>
                <p className="text-xl font-bold font-mono text-slate-100">{q.price?.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className={cls("text-xs font-mono font-semibold", up ? "up" : "down")}>{pct(q.changePct)}</span>
                  {spark.length > 2 && <Spark data={spark} up={up} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Macro + Crypto + Oil */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {loading && !data ? [1,2,3,4,5].map(i=>(
          <div key={i} className="card p-4"><Skeleton className="h-3 w-16 mb-2" /><Skeleton className="h-6 w-20" /></div>
        )) : (
          <>
            {macros.map((q: any) => (
              <div key={q.symbol} className="card p-4">
                <p className="text-xs text-slate-500 mb-1">{q.name}</p>
                <p className="text-lg font-bold font-mono text-slate-100">
                  {q.symbol === "^TNX" ? q.price?.toFixed(2) + "%" : q.price?.toFixed(2)}
                </p>
                <span className={cls("text-xs font-mono", q.changePct >= 0 ? "up" : "down")}>{pct(q.changePct)}</span>
              </div>
            ))}
            {crypto.map((q: any) => {
              const spark = data?.sparks?.[q.symbol] ?? []
              const up = q.changePct >= 0
              return (
                <div key={q.symbol} className="card p-4">
                  <p className="text-xs text-slate-500 mb-1">{q.name}</p>
                  <p className="text-lg font-bold font-mono text-slate-100">{price(q.price)}</p>
                  <div className="flex items-center justify-between">
                    <span className={cls("text-xs font-mono", up ? "up" : "down")}>{pct(q.changePct)}</span>
                    {spark.length > 2 && <Spark data={spark} up={up} />}
                  </div>
                </div>
              )
            })}
            {oil && (
              <div className="card p-4">
                <p className="text-xs text-slate-500 mb-1">{oil.name}</p>
                <p className="text-lg font-bold font-mono text-slate-100">{price(oil.price)}</p>
                <span className={cls("text-xs font-mono", oil.changePct >= 0 ? "up" : "down")}>{pct(oil.changePct)}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* News */}
      {(data?.news?.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Market News</p>
          <div className="grid md:grid-cols-2 gap-2">
            {data.news.map((n: any, i: number) => <NewsItem key={i} item={n} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stock Table (shared by My Stocks, Watchlist, Tech & AI) ─────────────────

type SortKey = "price" | "changePct" | "w1" | "m1" | "ytd" | "y1" | "y5"

function StockTable({ stocks, showHighlights = false }: { stocks: any[]; showHighlights?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("ytd")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc")
  const [filter, setFilter] = useState("")

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const filtered = useMemo(() => {
    const f = filter.toLowerCase()
    return !f ? stocks : stocks.filter(s =>
      s.symbol.toLowerCase().includes(f) || s.name.toLowerCase().includes(f)
    )
  }, [stocks, filter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortKey === "price" || sortKey === "changePct" ? (a[sortKey] ?? -Infinity) : (a.returns?.[sortKey] ?? -Infinity)
      const bv = sortKey === "price" || sortKey === "changePct" ? (b[sortKey] ?? -Infinity) : (b.returns?.[sortKey] ?? -Infinity)
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [filtered, sortKey, sortDir])

  const best = showHighlights && stocks.length ? stocks.reduce((a,b) => (a.returns?.ytd ?? -Infinity) >= (b.returns?.ytd ?? -Infinity) ? a : b) : null
  const worst = showHighlights && stocks.length ? stocks.reduce((a,b) => (a.returns?.ytd ?? Infinity) <= (b.returns?.ytd ?? Infinity) ? a : b) : null

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="px-3 py-3 text-left">
      <button onClick={() => handleSort(k)} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-300 uppercase tracking-wider whitespace-nowrap">
        {label}
        {sortKey === k && <span className="text-blue-400">{sortDir === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  )

  return (
    <div className="space-y-4">
      {showHighlights && best && worst && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-3 flex items-center gap-3 border-l-2 border-emerald-700">
            <TrendingUp size={16} className="up shrink-0" />
            <div><p className="text-xs text-slate-500">Best YTD</p><p className="font-bold text-slate-100">{best.symbol}</p><ReturnBadge v={best.returns?.ytd} /></div>
          </div>
          <div className="card p-3 flex items-center gap-3 border-l-2 border-red-800">
            <TrendingDown size={16} className="down shrink-0" />
            <div><p className="text-xs text-slate-500">Worst YTD</p><p className="font-bold text-slate-100">{worst.symbol}</p><ReturnBadge v={worst.returns?.ytd} /></div>
          </div>
        </div>
      )}

      {stocks.length > 4 && (
        <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by symbol or name…"
          className="w-full max-w-xs px-3 py-2 text-sm bg-[#111318] border border-[#1e2433] rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="border-b border-[#1e2433] bg-[#0d0f15]">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Symbol</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Chart</th>
                <Th label="Price" k="price" />
                <Th label="1D" k="changePct" />
                <Th label="1W" k="w1" />
                <Th label="1M" k="m1" />
                <Th label="YTD" k="ytd" />
                <Th label="1Y" k="y1" />
                <Th label="5Y" k="y5" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const up = s.changePct >= 0
                const isExp = expanded === s.symbol
                return (
                  <Fragment key={s.symbol}>
                    <tr onClick={() => setExpanded(isExp ? null : s.symbol)}
                      className={cls("border-b border-[#13161f] cursor-pointer transition-colors",
                        i % 2 === 0 ? "bg-[#0c0e13]" : "bg-[#0a0b0f]",
                        isExp ? "bg-[#111318]" : "hover:bg-[#111318]"
                      )}>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronDown size={13} className={cls("text-slate-600 transition-transform duration-150", isExp && "rotate-180 text-blue-400")} />
                          <div>
                            <p className="text-sm font-bold text-slate-100">{s.symbol}</p>
                            <p className="text-xs text-slate-500 truncate max-w-[110px]">{s.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-1 w-20">
                        <Spark data={s.spark ?? []} up={up} />
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm font-semibold font-mono text-slate-100">{price(s.price)}</p>
                        <p className={cls("text-xs font-mono", up ? "up" : "down")}>{pct(s.changePct)}</p>
                      </td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.w1} /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.m1} /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.ytd} /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.y1} /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.y5} /></td>
                    </tr>
                    {isExp && (
                      <tr className="bg-[#0d0f15]">
                        <td colSpan={9} className="p-0">
                          <StockDetail stock={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && <p className="py-10 text-center text-slate-500 text-sm">No results for "{filter}"</p>}
      </div>
    </div>
  )
}

function StockDetail({ stock: s }: { stock: any }) {
  return (
    <div className="px-4 pb-5 pt-3 space-y-4 border-t border-[#1e2433]">
      {/* Price chart */}
      {s.spark?.length > 4 && (
        <div className="bg-[#0a0b0f] rounded-lg p-3 border border-[#1e2433]">
          <p className="text-xs text-slate-500 mb-2">Price — Last 3 Months</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={s.spark}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13161f" />
              <XAxis dataKey="date" tickFormatter={d => d.slice(5)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={["auto","auto"]} tickFormatter={v => "$" + (v >= 1000 ? (v/1000).toFixed(1)+"k" : v.toFixed(0))} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={46} />
              <Tooltip contentStyle={{ background: "#111318", border: "1px solid #1e2433", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => ["$" + v.toFixed(2), s.symbol]} labelFormatter={l => l} />
              <Line type="monotone" dataKey="close" stroke={s.changePct >= 0 ? "#10b981" : "#ef4444"} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {[
          { label: "Day High", value: price(s.high) },
          { label: "Day Low", value: price(s.low) },
          { label: "52W High", value: price(s.week52High) },
          { label: "52W Low", value: price(s.week52Low) },
          { label: "Market Cap", value: cap(s.marketCap) },
          { label: "P/E Ratio", value: s.pe ? s.pe.toFixed(1) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0a0b0f] border border-[#1e2433] rounded-lg p-2.5">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-sm font-semibold font-mono text-slate-200 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* About */}
      {s.desc && (
        <div className="bg-[#0a0b0f] border border-[#1e2433] rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">About {s.name}</p>
          <p className="text-sm text-slate-300 leading-relaxed">{s.desc}</p>
          {s.sector && <span className="mt-2 inline-block text-xs px-2 py-0.5 rounded bg-[#1a1f2e] text-slate-400">{s.sector}</span>}
        </div>
      )}

      {/* News */}
      {s.news?.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">{s.symbol} News</p>
          <div className="space-y-2">
            {s.news.map((n: any, i: number) => <NewsItem key={i} item={n} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stock Tab (My Stocks / Watchlist / Tech) ─────────────────────────────────

const GROUPS: Record<string, string[]> = {
  "AI Leaders": ["NVDA","PLTR","TEM"],
  "Semiconductors": ["AMD","AVGO","INTC","SMCI"],
  "Big Tech": ["MSFT","GOOGL","META","AMZN","TSLA"],
  "Enterprise Software": ["ADBE","CRM","ORCL"],
}

function StocksTab({ symbols, title, subtitle, showHighlights = false, showGroups = false }: {
  symbols: string[]; title: string; subtitle: string; showHighlights?: boolean; showGroups?: boolean
}) {
  const [stocks, setStocks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [ts, setTs] = useState(0)
  const [activeGroup, setActiveGroup] = useState("All")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const res = await fetch(`/api/stocks?symbols=${symbols.join(",")}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setStocks(json.data)
      setTs(json.ts)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [symbols.join(",")])

  useEffect(() => { load() }, [load])

  const bySymbol = useMemo(() => Object.fromEntries(stocks.map(s => [s.symbol, s])), [stocks])

  const displayed = showGroups && activeGroup !== "All"
    ? (GROUPS[activeGroup] ?? []).map(sym => bySymbol[sym]).filter(Boolean)
    : stocks

  // Tech summary
  const groupAvgs = showGroups ? Object.entries(GROUPS).map(([g, syms]) => {
    const members = syms.map(s => bySymbol[s]).filter(Boolean)
    const avg = members.length ? members.reduce((a,b) => a + b.changePct, 0) / members.length : 0
    return { g, avg }
  }) : []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-100">{title}</h1><p className="text-xs text-slate-500 mt-0.5">{subtitle}</p></div>
        <RefreshBar ts={ts} onRefresh={load} loading={loading} />
      </div>

      {error && <div className="card p-4 flex items-center gap-3"><AlertTriangle size={16} className="text-red-400" /><p className="text-sm text-red-400">{error}</p></div>}

      {/* Tech summary banner */}
      {showGroups && stocks.length > 0 && (
        <div className="card p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sector Performance Today</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {groupAvgs.map(({ g, avg }) => (
              <div key={g} className="text-center">
                <p className="text-xs text-slate-500 truncate">{g}</p>
                <p className={cls("text-base font-bold font-mono mt-0.5", avg >= 0 ? "up" : "down")}>{pct(avg)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group filter tabs */}
      {showGroups && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["All", ...Object.keys(GROUPS)].map(g => (
            <button key={g} onClick={() => setActiveGroup(g)}
              className={cls("px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border transition-all",
                activeGroup === g ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-[#111318] text-slate-500 border-[#1e2433] hover:text-slate-300"
              )}>
              {g}
            </button>
          ))}
        </div>
      )}

      {loading && !stocks.length ? (
        <div className="card overflow-hidden">
          {symbols.map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[#13161f]">
              <Skeleton className="h-9 w-9 rounded" />
              <Skeleton className="h-4 w-32 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : <StockTable stocks={displayed} showHighlights={showHighlights} />}
    </div>
  )
}

// ─── Tab 4: Real Estate ───────────────────────────────────────────────────────

function RealEstate() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/fred")
      setData(await res.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const cs = data?.caseShiller ?? []
  const mg = data?.mortgage ?? []
  const latest = cs.length ? cs[cs.length - 1] : null
  const latestMg = mg.length ? mg[mg.length - 1] : null
  const yoy = cs.length >= 13 ? ((cs[cs.length-1].value - cs[cs.length-13].value) / cs[cs.length-13].value) * 100 : null
  const rate = latestMg?.value ?? null

  const summary = {
    buyers: rate && rate > 7
      ? `Affordability is severely strained — mortgage rates near ${rate?.toFixed(2)}% are keeping monthly payments near historic highs. Stress-test your budget carefully.`
      : rate && rate > 6
      ? `Rates near ${rate?.toFixed(2)}% remain elevated. Buying power is limited — get pre-approved early and budget conservatively.`
      : `Mortgage rates have eased somewhat, improving affordability for buyers who've been waiting on the sidelines.`,
    sellers: yoy && yoy > 3
      ? `Home prices are still appreciating (~${yoy.toFixed(1)}% YoY). Limited inventory continues to give sellers pricing power.`
      : yoy && yoy < 0
      ? `Prices are softening (${yoy.toFixed(1)}% YoY). Price competitively and expect longer listing times.`
      : `Prices are broadly stable. Sellers remain in a decent position but should price based on recent comps.`,
    investors: `Residential real estate faces a challenging environment with rates still elevated. Focus on cash flow over appreciation-driven strategies in the current rate environment.`,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-100">Real Estate</h1><p className="text-xs text-slate-500 mt-0.5">Case-Shiller index, mortgage rates & housing news</p></div>
        <RefreshBar ts={data?.ts ?? 0} onRefresh={load} loading={loading} />
      </div>

      {data?.error && (
        <div className="card p-4 border-amber-900/40">
          <p className="text-sm text-amber-400 font-medium mb-1">⚠ FRED API Key Required for Charts</p>
          <p className="text-xs text-slate-400">{data.error}</p>
          <p className="text-xs text-slate-500 mt-2">
            Get a free key at{" "}
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">fred.stlouisfed.org</a>
            , then add <code className="bg-[#1a1f2e] px-1 rounded">FRED_API_KEY</code> in your Vercel project's Environment Variables.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "30-Yr Mortgage Rate", value: rate ? rate.toFixed(2) + "%" : "—", sub: "Freddie Mac weekly avg" },
          { label: "Case-Shiller Index", value: latest ? latest.value.toFixed(1) : "—", sub: "Jan 2000 = 100 baseline" },
          { label: "Year-over-Year", value: yoy != null ? pct(yoy, 1) : "—", sub: "Home price change", up: yoy != null ? yoy >= 0 : null },
        ].map(({ label, value, sub, up }) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={cls("text-2xl font-bold font-mono mt-1", up === true ? "up" : up === false ? "down" : "text-slate-100")}>{value}</p>
            <p className="text-xs text-slate-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Case-Shiller chart */}
      {cs.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-200 mb-1">Case-Shiller U.S. National Home Price Index</p>
          <p className="text-xs text-slate-500 mb-4">A rising index means home prices are going up. Above 200 means prices have more than doubled since January 2000.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cs}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13161f" />
              <XAxis dataKey="date" tickFormatter={d => d.slice(0,7)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(cs.length / 8)} />
              <YAxis domain={["auto","auto"]} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={38} />
              <Tooltip contentStyle={{ background: "#111318", border: "1px solid #1e2433", borderRadius: 8, fontSize: 11 }}
                labelFormatter={l => new Date(l).toLocaleDateString("en-US",{month:"long",year:"numeric"})}
                formatter={(v: number) => [v.toFixed(2), "Index"]} />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Mortgage rate chart */}
      {mg.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-200 mb-1">30-Year Fixed Mortgage Rate</p>
          <p className="text-xs text-slate-500 mb-4">Higher rates mean less purchasing power for buyers — the most important metric for housing affordability.</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13161f" />
              <XAxis dataKey="date" tickFormatter={d => d.slice(0,7)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(mg.length / 8)} />
              <YAxis domain={["auto","auto"]} tickFormatter={v => v.toFixed(1) + "%"} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
              <Tooltip contentStyle={{ background: "#111318", border: "1px solid #1e2433", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [v.toFixed(2) + "%", "Rate"]} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* What it means */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">What This Means For You</p>
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { title: "🏠 For Buyers", text: summary.buyers, border: "border-l-2 border-blue-800" },
            { title: "📋 For Sellers", text: summary.sellers, border: "border-l-2 border-emerald-800" },
            { title: "📈 For Investors", text: summary.investors, border: "border-l-2 border-purple-800" },
          ].map(({ title, text, border }) => (
            <div key={title} className={cls("card p-4", border)}>
              <p className="text-sm font-semibold text-slate-200 mb-2">{title}</p>
              <p className="text-sm text-slate-400 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* News */}
      {(data?.news?.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Real Estate News</p>
          <div className="grid md:grid-cols-2 gap-2">
            {data.news.map((n: any, i: number) => <NewsItem key={i} item={n} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const MY_STOCKS   = ["AMZN","TEM","INTC","VOO","QQQM","VST","TSLA","SMCI"]
const WATCHLIST   = ["PLTR","NVDA"]
const TECH_STOCKS = ["NVDA","MSFT","GOOGL","META","AMZN","PLTR","AMD","SMCI","TSLA","ADBE","CRM","ORCL","AVGO","INTC","TEM"]

type Tab = "overview" | "stocks" | "watchlist" | "realestate" | "tech"

const TABS: { id: Tab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { id: "overview",   label: "Market Overview", shortLabel: "Overview",  icon: <BarChart2 size={14} /> },
  { id: "stocks",     label: "My Stocks",        shortLabel: "My Stocks", icon: <TrendingUp size={14} /> },
  { id: "watchlist",  label: "Watch List",       shortLabel: "Watchlist", icon: <Star size={14} /> },
  { id: "realestate", label: "Real Estate",      shortLabel: "Real Est.", icon: <Home size={14} /> },
  { id: "tech",       label: "Tech & AI",        shortLabel: "Tech & AI", icon: <Cpu size={14} /> },
]

export default function App() {
  const [tab, setTab] = useState<Tab>("overview")

  return (
    <div className="min-h-screen bg-[#0a0b0f]">
      {/* Nav */}
      <div className="sticky top-0 z-30 bg-[#0a0b0f] border-b border-[#1e2433]">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center">
            <div className="flex items-center gap-2 pr-5 py-3 border-r border-[#1e2433] mr-1">
              <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
                <BarChart2 size={13} className="text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-300 hidden sm:block">Markets</span>
            </div>
            <nav className="flex overflow-x-auto">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cls("flex items-center gap-2 px-3 sm:px-4 py-4 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                    tab === t.id ? "border-blue-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"
                  )}>
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.shortLabel}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {tab === "overview"   && <MarketOverview />}
        {tab === "stocks"     && <StocksTab symbols={MY_STOCKS} title="My Stocks" subtitle="Live prices and multi-period returns — click any row to expand" showHighlights />}
        {tab === "watchlist"  && <StocksTab symbols={WATCHLIST} title="Watch List" subtitle="Stocks on your radar" />}
        {tab === "realestate" && <RealEstate />}
        {tab === "tech"       && <StocksTab symbols={TECH_STOCKS} title="Tech & AI" subtitle="Major U.S. tech and AI companies — grouped by sector" showGroups />}
      </div>
    </div>
  )
}
