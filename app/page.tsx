"use client"
import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts"
import {
  RefreshCw, TrendingUp, TrendingDown, ChevronDown, ExternalLink,
  BarChart2, Star, Home, Cpu, Clock, AlertTriangle, WifiOff
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
  if (v >= 1e9)  return "$" + (v / 1e9).toFixed(2) + "B"
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

function Spark({ data, up }: { data: { date: string; close: number }[] | undefined; up: boolean }) {
  if (!data?.length) return <div className="w-20 h-9" />
  return (
    <ResponsiveContainer width={80} height={36}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="close" stroke={up ? "#10b981" : "#ef4444"} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <YAxis domain={["auto","auto"]} hide />
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

// Rate-limit warning banner — shown when Yahoo is throttling
function RateLimitBanner({ warning }: { warning: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-950/30 border border-amber-800/40">
      <WifiOff size={15} className="text-amber-400 mt-0.5 shrink-0" />
      <p className="text-sm text-amber-300">{warning}</p>
    </div>
  )
}

// Generic error banner with optional retry
function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-950/30 border border-red-800/40">
      <AlertTriangle size={15} className="text-red-400 shrink-0" />
      <p className="text-sm text-red-300 flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-red-400 hover:text-red-200 underline whitespace-nowrap">
          Retry
        </button>
      )}
    </div>
  )
}

function RefreshBar({ ts, onRefresh, loading, cached }: { ts: number; onRefresh: () => void; loading: boolean; cached?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {ts > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock size={11} />
          {new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
          {cached && <span className="text-slate-600">(cached)</span>}
        </span>
      )}
      <button onClick={onRefresh} disabled={loading}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#1e2433] bg-[#111318] text-slate-400 hover:text-slate-200 hover:border-[#2d3a50] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        {loading ? "Loading…" : "Refresh"}
      </button>
    </div>
  )
}

// ─── Custom hook: fetch with debounced refresh + stale-while-loading ──────────
function useTabData<T>(fetchFn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)  // true on first load
  const [error, setError] = useState<string | null>(null)
  const [ts, setTs] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const inFlight = useRef(false)
  const lastFetch = useRef(0)
  const DEBOUNCE_MS = 10_000 // minimum 10s between refreshes

  const load = useCallback(async (force = false) => {
    // Debounce: ignore if called too recently (unless forced)
    if (!force && Date.now() - lastFetch.current < DEBOUNCE_MS) return
    // Prevent simultaneous requests
    if (inFlight.current) return

    inFlight.current = true
    lastFetch.current = Date.now()
    // Don't blank out existing data while refreshing
    setLoading(prev => data === null ? true : prev)
    setError(null)
    setWarning(null)

    try {
      const result = await fetchFn()
      setData(result)
      setTs(Date.now())
      setLoading(false)
      // Check for rate-limit warning in response
      const r = result as any
      if (r?.warning) setWarning(r.warning)
      if (r?.rateLimited) setWarning("Live data temporarily rate-limited — showing most recent cached data.")
      setCached(!!(r as any)?.cached)
    } catch (e: any) {
      setError(e?.message ?? "Failed to load data")
      setLoading(false)
    } finally {
      inFlight.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, ts, warning, cached, refresh: () => load(true), loadOnce: () => load(false) }
}

// ─── Tab 1: Market Overview ───────────────────────────────────────────────────

function buildSummary(quotes: any[]): string[] {
  if (!quotes?.length) return []
  const get = (sym: string) => quotes.find((q: any) => q.symbol === sym)
  const sp = get("^GSPC"), nq = get("^IXIC"), vix = get("^VIX"), tnx = get("^TNX"), btc = get("BTC-USD")
  const lines: string[] = []
  if (sp) {
    const p = sp.changePct
    if (p > 0.5)       lines.push(`U.S. stocks are rallying — the S&P 500 is up ${pct(p)} today, indicating broad market strength.`)
    else if (p < -0.5) lines.push(`U.S. stocks are selling off — the S&P 500 is down ${pct(p)} today.`)
    else               lines.push(`The S&P 500 is essentially flat today (${pct(p)}), with no strong directional move.`)
  }
  if (sp && nq) {
    const diff = nq.changePct - sp.changePct
    if (diff > 0.4)       lines.push(`Tech is outperforming — the Nasdaq is beating the S&P 500 by ${diff.toFixed(1)} percentage points.`)
    else if (diff < -0.4) lines.push(`Tech is lagging today — the Nasdaq is trailing the S&P 500 by ${Math.abs(diff).toFixed(1)} points.`)
    else                  lines.push(`Tech and the broad market are moving in sync today.`)
  }
  if (vix) {
    const v = vix.price
    if (v < 15)      lines.push(`Volatility is low (VIX ${v.toFixed(1)}) — investors appear calm and confident.`)
    else if (v < 20) lines.push(`Volatility is moderate (VIX ${v.toFixed(1)}) — some caution but no panic.`)
    else if (v < 30) lines.push(`Volatility is elevated (VIX ${v.toFixed(1)}) — expect larger daily swings.`)
    else             lines.push(`Volatility is very high (VIX ${v.toFixed(1)}) — significant fear in the market.`)
  }
  if (tnx) lines.push(`The 10-year Treasury yield is at ${tnx.price.toFixed(2)}%${tnx.changePct > 0.5 ? " and rising, which can pressure stock valuations" : tnx.changePct < -0.5 ? " and falling, suggesting a flight to safety" : " — stable today"}.`)
  if (btc) {
    if (btc.changePct > 2)       lines.push(`Bitcoin is up ${pct(btc.changePct)} — crypto is joining the risk-on move.`)
    else if (btc.changePct < -2) lines.push(`Bitcoin is down ${pct(btc.changePct)} — crypto weakness signals risk-off sentiment.`)
  }
  return lines
}

function MarketOverview() {
  const { data, loading, error, ts, warning, cached, refresh, loadOnce } = useTabData<any>(
    () => fetch("/api/market").then(r => r.json())
  )
  useEffect(() => { loadOnce() }, [loadOnce])

  const quotes  = data?.quotes  ?? []
  const sparks  = data?.sparks  ?? {}
  const news    = data?.news    ?? []
  const indices = quotes.filter((q: any) => ["^GSPC","^IXIC","^DJI","^RUT"].includes(q.symbol))
  const macros  = quotes.filter((q: any) => ["^VIX","^TNX"].includes(q.symbol))
  const crypto  = quotes.filter((q: any) => ["BTC-USD","ETH-USD"].includes(q.symbol))
  const oil     = quotes.find( (q: any) => q.symbol === "CL=F")
  const summary = buildSummary(quotes)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Market Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">Live indices, bonds, crypto & commodities</p>
        </div>
        <RefreshBar ts={ts} onRefresh={refresh} loading={loading && !!data} cached={cached} />
      </div>

      {warning && <RateLimitBanner warning={warning} />}
      {error   && <ErrorBanner message={error} onRetry={refresh} />}

      {/* Summary */}
      {loading && !data ? (
        <div className="card p-5 space-y-2">
          <Skeleton className="h-4 w-48 mb-3" />
          {[1,2,3].map(i => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      ) : summary.length > 0 && (
        <div className="card p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            {quotes.find((q:any) => q.symbol === "^GSPC")?.changePct >= 0
              ? <TrendingUp size={13} className="up" />
              : <TrendingDown size={13} className="down" />}
            Today's Market Snapshot
          </p>
          <div className="space-y-2">
            {summary.map((s, i) => (
              <p key={i} className="text-sm text-slate-300 leading-relaxed pl-3 border-l-2 border-[#1e2433]">{s}</p>
            ))}
          </div>
        </div>
      )}

      {/* Major Indices */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Major Indices</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading && !data ? [1,2,3,4].map(i => (
            <div key={i} className="card p-4"><Skeleton className="h-3 w-20 mb-2" /><Skeleton className="h-7 w-28 mb-1" /><Skeleton className="h-3 w-16" /></div>
          )) : indices.map((q: any) => {
            const up = q.changePct >= 0
            return (
              <div key={q.symbol} className="card p-4">
                <p className="text-xs text-slate-500 mb-1">{q.name}</p>
                <p className="text-xl font-bold font-mono text-slate-100">
                  {q.price?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className={cls("text-xs font-mono font-semibold", up ? "up" : "down")}>{pct(q.changePct)}</span>
                  {sparks[q.symbol]?.length > 2 && <Spark data={sparks[q.symbol]} up={up} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Macro + Crypto + Oil */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {loading && !data ? [1,2,3,4,5].map(i => (
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
            {crypto.map((q: any) => (
              <div key={q.symbol} className="card p-4">
                <p className="text-xs text-slate-500 mb-1">{q.name}</p>
                <p className="text-lg font-bold font-mono text-slate-100">{price(q.price)}</p>
                <div className="flex items-center justify-between">
                  <span className={cls("text-xs font-mono", q.changePct >= 0 ? "up" : "down")}>{pct(q.changePct)}</span>
                  {sparks[q.symbol]?.length > 2 && <Spark data={sparks[q.symbol]} up={q.changePct >= 0} />}
                </div>
              </div>
            ))}
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

      {news.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Market News</p>
          <div className="grid md:grid-cols-2 gap-2">
            {news.map((n: any, i: number) => <NewsItem key={i} item={n} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stock Detail (expanded row) ──────────────────────────────────────────────

function StockDetail({ s }: { s: any }) {
  return (
    <div className="px-4 pb-5 pt-3 space-y-4 border-t border-[#1e2433]">
      {s.spark?.length > 4 && (
        <div className="bg-[#0a0b0f] rounded-lg p-3 border border-[#1e2433]">
          <p className="text-xs text-slate-500 mb-2">Price — Last 3 Months</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={s.spark}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13161f" />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={["auto","auto"]} tickFormatter={(v: number) => "$" + (v >= 1000 ? (v/1000).toFixed(1) + "k" : v.toFixed(0))} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={46} />
              <Tooltip contentStyle={{ background: "#111318", border: "1px solid #1e2433", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => ["$" + v.toFixed(2), s.symbol]} />
              <Line type="monotone" dataKey="close" stroke={s.changePct >= 0 ? "#10b981" : "#ef4444"} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {[
          { label: "Day High",   value: price(s.high) },
          { label: "Day Low",    value: price(s.low) },
          { label: "52W High",   value: price(s.week52High) },
          { label: "52W Low",    value: price(s.week52Low) },
          { label: "Market Cap", value: cap(s.marketCap) },
          { label: "P/E Ratio",  value: s.pe ? s.pe.toFixed(1) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0a0b0f] border border-[#1e2433] rounded-lg p-2.5">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-sm font-semibold font-mono text-slate-200 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {s.desc && (
        <div className="bg-[#0a0b0f] border border-[#1e2433] rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">About {s.name}</p>
          <p className="text-sm text-slate-300 leading-relaxed">{s.desc}</p>
          {s.sector && <span className="mt-2 inline-block text-xs px-2 py-0.5 rounded bg-[#1a1f2e] text-slate-400">{s.sector}</span>}
        </div>
      )}

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

// ─── Stock Table (reused by My Stocks / Watchlist / Tech) ────────────────────

type SortKey = "price" | "changePct" | "w1" | "m1" | "ytd" | "y1" | "y5"

function StockTable({ stocks, showHighlights = false }: { stocks: any[]; showHighlights?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortKey,  setSortKey]  = useState<SortKey>("ytd")
  const [sortDir,  setSortDir]  = useState<"asc"|"desc">("desc")
  const [filter,   setFilter]   = useState("")

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
      const av = (sortKey === "price" || sortKey === "changePct") ? (a[sortKey] ?? -Infinity) : (a.returns?.[sortKey] ?? -Infinity)
      const bv = (sortKey === "price" || sortKey === "changePct") ? (b[sortKey] ?? -Infinity) : (b.returns?.[sortKey] ?? -Infinity)
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [filtered, sortKey, sortDir])

  const best  = showHighlights && stocks.length ? stocks.reduce((a,b) => (a.returns?.ytd ?? -Infinity) >= (b.returns?.ytd ?? -Infinity) ? a : b) : null
  const worst = showHighlights && stocks.length ? stocks.reduce((a,b) => (a.returns?.ytd ?? Infinity)  <= (b.returns?.ytd ?? Infinity)  ? a : b) : null

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
                <Th label="Price"  k="price"    />
                <Th label="1D"     k="changePct" />
                <Th label="1W"     k="w1"        />
                <Th label="1M"     k="m1"        />
                <Th label="YTD"    k="ytd"       />
                <Th label="1Y"     k="y1"        />
                <Th label="5Y"     k="y5"        />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const up    = s.changePct >= 0
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
                      <td className="px-1 py-1 w-20"><Spark data={s.spark} up={up} /></td>
                      <td className="px-3 py-3">
                        <p className="text-sm font-semibold font-mono text-slate-100">{price(s.price)}</p>
                        <p className={cls("text-xs font-mono", up ? "up" : "down")}>{pct(s.changePct)}</p>
                      </td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.w1}  /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.m1}  /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.ytd} /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.y1}  /></td>
                      <td className="px-3 py-3"><ReturnBadge v={s.returns?.y5}  /></td>
                    </tr>
                    {isExp && (
                      <tr className="bg-[#0d0f15]">
                        <td colSpan={9} className="p-0"><StockDetail s={s} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && (
          <p className="py-10 text-center text-slate-500 text-sm">
            {filter ? `No results for "${filter}"` : "No data available"}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Stocks Tab (My Stocks / Watchlist / Tech & AI) ───────────────────────────

const GROUPS: Record<string, string[]> = {
  "AI Leaders":          ["NVDA","PLTR","TEM"],
  "Semiconductors":      ["AMD","AVGO","INTC","SMCI"],
  "Big Tech":            ["MSFT","GOOGL","META","AMZN","TSLA"],
  "Enterprise Software": ["ADBE","CRM","ORCL"],
}

function StocksTab({ symbols, title, subtitle, showHighlights = false, showGroups = false }: {
  symbols: string[]; title: string; subtitle: string; showHighlights?: boolean; showGroups?: boolean
}) {
  const symbolsKey = symbols.join(",")
  const { data, loading, error, ts, warning, cached, refresh, loadOnce } = useTabData<any>(
    () => fetch(`/api/stocks?symbols=${symbolsKey}`).then(r => r.json()),
    [symbolsKey]
  )
  useEffect(() => { loadOnce() }, [loadOnce])

  const stocks: any[] = data?.data ?? []
  const [activeGroup, setActiveGroup] = useState("All")

  const bySymbol = useMemo(() => Object.fromEntries(stocks.map(s => [s.symbol, s])), [stocks])

  const displayed = showGroups && activeGroup !== "All"
    ? (GROUPS[activeGroup] ?? []).map(sym => bySymbol[sym]).filter(Boolean)
    : stocks

  const groupAvgs = showGroups ? Object.entries(GROUPS).map(([g, syms]) => {
    const members = syms.map(s => bySymbol[s]).filter(Boolean)
    const avg = members.length ? members.reduce((a,b) => a + b.changePct, 0) / members.length : 0
    return { g, avg }
  }) : []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">{title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <RefreshBar ts={ts} onRefresh={refresh} loading={loading && stocks.length > 0} cached={cached} />
      </div>

      {warning && <RateLimitBanner warning={warning} />}
      {error   && <ErrorBanner message={error} onRetry={refresh} />}

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

      {showGroups && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["All", ...Object.keys(GROUPS)].map(g => (
            <button key={g} onClick={() => setActiveGroup(g)}
              className={cls("px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border transition-all",
                activeGroup === g
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                  : "bg-[#111318] text-slate-500 border-[#1e2433] hover:text-slate-300"
              )}>
              {g}
            </button>
          ))}
        </div>
      )}

      {loading && !stocks.length ? (
        <div className="card overflow-hidden">
          {symbols.slice(0, 6).map((_, i) => (
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
  const { data, loading, error, ts, cached, refresh, loadOnce } = useTabData<any>(
    () => fetch("/api/fred").then(r => r.json())
  )
  useEffect(() => { loadOnce() }, [loadOnce])

  const cs  = data?.caseShiller ?? []
  const mg  = data?.mortgage    ?? []
  const news = data?.news       ?? []

  const latest   = cs.length ? cs[cs.length - 1] : null
  const latestMg = mg.length ? mg[mg.length - 1] : null
  const yoy      = cs.length >= 13 ? ((cs[cs.length-1].value - cs[cs.length-13].value) / cs[cs.length-13].value) * 100 : null
  const rate     = latestMg?.value ?? null

  const summary = {
    buyers: rate && rate > 7
      ? `Affordability is severely strained — mortgage rates near ${rate.toFixed(2)}% keep monthly payments near historic highs. Stress-test your budget carefully.`
      : rate && rate > 6
      ? `Rates near ${rate.toFixed(2)}% remain elevated. Buying power is limited — get pre-approved early and budget conservatively.`
      : `Mortgage rates have eased, improving affordability for buyers who've been waiting on the sidelines.`,
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
        <div>
          <h1 className="text-xl font-bold text-slate-100">Real Estate</h1>
          <p className="text-xs text-slate-500 mt-0.5">Case-Shiller index, mortgage rates & housing news</p>
        </div>
        <RefreshBar ts={ts} onRefresh={refresh} loading={loading && !!data} cached={cached} />
      </div>

      {data?.error && (
        <div className="card p-4 border-amber-900/40 bg-amber-950/10">
          <p className="text-sm text-amber-400 font-medium mb-1">⚠ FRED API Key Required for Housing Charts</p>
          <p className="text-xs text-slate-400">{data.error}</p>
          <p className="text-xs text-slate-500 mt-2">
            Get a free key at{" "}
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">fred.stlouisfed.org</a>
            , then add <code className="bg-[#1a1f2e] px-1 rounded">FRED_API_KEY</code> in Vercel → Settings → Environment Variables.
          </p>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {loading && !data ? [1,2,3].map(i => <div key={i} className="card p-4"><Skeleton className="h-3 w-24 mb-2" /><Skeleton className="h-8 w-28" /></div>) : (
          <>
            {[
              { label: "30-Yr Mortgage Rate", value: rate ? rate.toFixed(2) + "%" : "—", sub: "Freddie Mac weekly avg", up: null },
              { label: "Case-Shiller Index",  value: latest ? latest.value.toFixed(1) : "—", sub: "Jan 2000 = 100 baseline", up: null },
              { label: "Year-over-Year",      value: yoy != null ? pct(yoy, 1) : "—", sub: "Home price change YoY", up: yoy != null ? yoy >= 0 : null },
            ].map(({ label, value, sub, up }) => (
              <div key={label} className="card p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className={cls("text-2xl font-bold font-mono mt-1", up === true ? "up" : up === false ? "down" : "text-slate-100")}>{value}</p>
                <p className="text-xs text-slate-600 mt-0.5">{sub}</p>
              </div>
            ))}
          </>
        )}
      </div>

      {cs.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-200 mb-1">Case-Shiller U.S. National Home Price Index</p>
          <p className="text-xs text-slate-500 mb-4">A rising index means home prices are going up. Above 200 means prices have more than doubled since January 2000.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cs}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13161f" />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0,7)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(cs.length / 8)} />
              <YAxis domain={["auto","auto"]} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={38} />
              <Tooltip contentStyle={{ background: "#111318", border: "1px solid #1e2433", borderRadius: 8, fontSize: 11 }}
                labelFormatter={(l: string) => new Date(l).toLocaleDateString("en-US",{month:"long",year:"numeric"})}
                formatter={(v: number) => [v.toFixed(2), "Index"]} />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {mg.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-200 mb-1">30-Year Fixed Mortgage Rate</p>
          <p className="text-xs text-slate-500 mb-4">Higher rates mean less purchasing power — the most important metric for housing affordability.</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13161f" />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0,7)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(mg.length / 8)} />
              <YAxis domain={["auto","auto"]} tickFormatter={(v: number) => v.toFixed(1) + "%"} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
              <Tooltip contentStyle={{ background: "#111318", border: "1px solid #1e2433", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [v.toFixed(2) + "%", "Rate"]} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">What This Means For You</p>
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { title: "🏠 For Buyers",    text: summary.buyers,    border: "border-l-2 border-blue-800" },
            { title: "📋 For Sellers",   text: summary.sellers,   border: "border-l-2 border-emerald-800" },
            { title: "📈 For Investors", text: summary.investors, border: "border-l-2 border-purple-800" },
          ].map(({ title, text, border }) => (
            <div key={title} className={cls("card p-4", border)}>
              <p className="text-sm font-semibold text-slate-200 mb-2">{title}</p>
              <p className="text-sm text-slate-400 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {news.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Real Estate News</p>
          <div className="grid md:grid-cols-2 gap-2">
            {news.map((n: any, i: number) => <NewsItem key={i} item={n} />)}
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

const TABS: { id: Tab; label: string; short: string; icon: React.ReactNode }[] = [
  { id: "overview",   label: "Market Overview", short: "Overview",  icon: <BarChart2 size={14} /> },
  { id: "stocks",     label: "My Stocks",        short: "My Stocks", icon: <TrendingUp size={14} /> },
  { id: "watchlist",  label: "Watch List",       short: "Watchlist", icon: <Star size={14} /> },
  { id: "realestate", label: "Real Estate",      short: "Real Est.", icon: <Home size={14} /> },
  { id: "tech",       label: "Tech & AI",        short: "Tech & AI", icon: <Cpu size={14} /> },
]

export default function App() {
  const [tab, setTab] = useState<Tab>("overview")
  // Track which tabs have been visited so we only mount them once
  const [visited, setVisited] = useState<Set<Tab>>(new Set<Tab>(["overview"]))

  const handleTabChange = (id: Tab) => {
    setTab(id)
    setVisited(prev => new Set<Tab>(Array.from(prev).concat(id)))
  }

  return (
    <div className="min-h-screen bg-[#0a0b0f]">
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
                <button key={t.id} onClick={() => handleTabChange(t.id)}
                  className={cls("flex items-center gap-2 px-3 sm:px-4 py-4 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                    tab === t.id
                      ? "border-blue-500 text-white"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  )}>
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.short}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/*
          Tabs are only mounted when first visited (lazy), then kept mounted
          but hidden — so data stays fresh without re-fetching on every tab switch.
        */}
        <div className={tab === "overview"   ? "" : "hidden"}>{visited.has("overview")   && <MarketOverview />}</div>
        <div className={tab === "stocks"     ? "" : "hidden"}>{visited.has("stocks")     && <StocksTab symbols={MY_STOCKS}   title="My Stocks"  subtitle="Live prices and multi-period returns — click any row to expand" showHighlights />}</div>
        <div className={tab === "watchlist"  ? "" : "hidden"}>{visited.has("watchlist")  && <StocksTab symbols={WATCHLIST}   title="Watch List" subtitle="Stocks on your radar" />}</div>
        <div className={tab === "realestate" ? "" : "hidden"}>{visited.has("realestate") && <RealEstate />}</div>
        <div className={tab === "tech"       ? "" : "hidden"}>{visited.has("tech")       && <StocksTab symbols={TECH_STOCKS} title="Tech & AI"  subtitle="Major U.S. tech and AI companies — grouped by sector" showGroups />}</div>
      </div>
    </div>
  )
}
