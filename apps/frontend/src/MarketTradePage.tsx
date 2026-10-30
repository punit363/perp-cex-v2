import { useEffect, useState, type FormEvent } from "react";
import { apiBase, formatScaled, icons, partsOf, previewPairs, wsUrl, type Market } from "./MarketDashboard";

type Level = { price: string; quantity: string };
type Depth = { asks: Level[]; bids: Level[] };
type PricePoint = { price: string; time: number };
type LiveTrade = { trade_id: string; price: string; quantity: string; taker_side: "BUY" | "SELL"; time: number };
type Order = {
  order_id: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
  price: string;
  quantity: string;
  filled: string;
  leverage: string;
  created_at: string;
  updated_at: string;
};
type Position = {
  market_id: string;
  type: "LONG" | "SHORT";
  quantity: string;
  reserved_margin: string;
  avg_entry_price: string;
  unrealized_pnl: string;
  funding_accrued: string;
};
type AccountTab = "open" | "history" | "positions";
type Envelope<T> = { status?: string; message?: string; data?: T };

const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, options);
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || payload?.status === "FAILURE" || !payload?.data) {
    throw new Error(payload?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

function grouped(value: string) {
  const [whole, fraction] = value.split(".");
  if (!whole) return value;
  const base = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${base}.${fraction}` : base;
}

function validPositive(value: string) {
  return decimal.test(value) && Number(value) > 0 && Number.isFinite(Number(value));
}

function PriceChart({ points, current, connected }: { points: PricePoint[]; current: string | null; connected: boolean }) {
  const samples = points.map((point) => ({ ...point, numeric: Number(point.price) })).filter((point) => Number.isFinite(point.numeric)).slice(-80);
  const values = samples.map((point) => point.numeric);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 0;
  const padding = Math.max((high - low) * .14, high * .001, .00000001);
  const minimum = low - padding;
  const maximum = high + padding;
  const coords = samples.map((point, index) => ({ x: 14 + index / Math.max(samples.length - 1, 1) * 756, y: 296 - (point.numeric - minimum) / (maximum - minimum) * 258 }));
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const area = coords.length > 1 ? `${line} L${coords.at(-1)!.x.toFixed(2)} 320 L${coords[0]!.x.toFixed(2)} 320 Z` : "";
  const last = coords.at(-1);

  return (
    <section className="trade-chart" aria-label="Live price chart">
      <div className="trade-panel__heading"><div><span className="trade-panel__eyebrow">PRICE ACTION</span><h2>Price chart</h2></div><span className={`trade-live-pill ${connected ? "" : "is-offline"}`}><i /> {connected ? "LIVE SESSION" : "AWAITING FEED"}</span></div>
      <div className="trade-chart__summary"><strong>{current ? grouped(current) : "—"}</strong><span>Chart updates received during this session</span></div>
      <div className="trade-chart__plot">
        <svg viewBox="0 0 800 320" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="price-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#58c887" stopOpacity=".22" /><stop offset="1" stopColor="#58c887" stopOpacity="0" /></linearGradient></defs>
          {[38, 103, 168, 233, 296].map((y) => <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="#263037" strokeWidth="1" />)}
          {[14, 203, 392, 581, 770].map((x) => <line key={x} x1={x} x2={x} y1="0" y2="320" stroke="#20292e" strokeWidth="1" />)}
          {area && <path d={area} fill="url(#price-area)" />}
          {line && <path d={line} fill="none" stroke="#5ecb8b" strokeWidth="2.6" vectorEffect="non-scaling-stroke" />}
          {last && <circle cx={last.x} cy={last.y} r="5" fill="#76d99f" stroke="#183927" strokeWidth="5" />}
        </svg>
        {samples.length < 2 && <div className="trade-chart__empty"><span className="trade-chart__empty-icon">⌁</span><strong>Waiting for live price movement</strong><span>The chart builds as market updates arrive.</span></div>}
      </div>
      <div className="trade-chart__footer"><span>{samples.length ? new Date(samples[0]!.time).toLocaleTimeString() : "Session start"}</span><span>{samples.length} update{samples.length === 1 ? "" : "s"}</span><span>{samples.length ? new Date(samples.at(-1)!.time).toLocaleTimeString() : "Live"}</span></div>
    </section>
  );
}

function BookSide({ levels, side, onChoosePrice }: { levels: Level[]; side: "ask" | "bid"; onChoosePrice: (price: string) => void }) {
  const visible = side === "ask" ? levels.slice(0, 8).reverse() : levels.slice(0, 8);
  const maximum = Math.max(...visible.map((level) => Number(level.quantity)), 1);
  return <div className={`trade-book__side trade-book__side--${side}`}>
    {visible.length ? visible.map((level, index) => <button type="button" key={`${level.price}-${index}`} onClick={() => onChoosePrice(level.price)} title="Use this price in the limit order form"><span className="trade-book__bar" style={{ width: `${Math.min(100, Number(level.quantity) / maximum * 100)}%` }} /><span className="trade-book__price">{grouped(level.price)}</span><span>{grouped(level.quantity)}</span></button>) : <div className="trade-book__empty">No {side === "ask" ? "asks" : "bids"} available</div>}
  </div>;
}

function OrderBook({ depth, loading, error, current, onChoosePrice, onRefresh }: { depth: Depth | null; loading: boolean; error: string; current: string | null; onChoosePrice: (price: string) => void; onRefresh: () => void }) {
  return <section className="trade-book" aria-label="Live order book">
    <div className="trade-panel__heading"><div><span className="trade-panel__eyebrow">MARKET DEPTH</span><h2>Order book</h2></div><button type="button" className="trade-icon-button" onClick={onRefresh} aria-label="Refresh order book" title="Refresh order book">↻</button></div>
    <div className="trade-book__columns"><span>PRICE</span><span>SIZE</span></div>
    {loading && !depth ? <div className="trade-book__loading">Loading order book…</div> : <>
      <BookSide levels={depth?.asks ?? []} side="ask" onChoosePrice={onChoosePrice} />
      <div className="trade-book__mid"><strong>{current ? grouped(current) : "—"}</strong><span>LAST PRICE</span></div>
      <BookSide levels={depth?.bids ?? []} side="bid" onChoosePrice={onChoosePrice} />
    </>}
    {error && <p className="trade-book__notice" role="status">{error}</p>}
  </section>;
}

function OrderForm({ marketId, listed, token, currentPrice, selectedPrice, onSignIn, onPlaced }: { marketId: string; listed: boolean; token: string | null; currentPrice: string | null; selectedPrice: string | null; onSignIn: () => void; onPlaced: () => void }) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => { if (currentPrice) setPrice((value) => value || currentPrice); }, [currentPrice]);
  useEffect(() => { if (selectedPrice) { setType("LIMIT"); setPrice(selectedPrice); } }, [selectedPrice]);
  useEffect(() => { setPrice(""); setQuantity(""); setBudget(""); setError(""); setSuccess(""); }, [marketId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!listed) { setError("This preview pair is not listed for trading."); return; }
    if (!token) { onSignIn(); return; }
    if (!validPositive(quantity) || !validPositive(leverage)) { setError("Enter a positive quantity and leverage with up to 8 decimal places."); return; }
    const orderPrice = type === "LIMIT" ? price : side === "BUY" ? budget : "0";
    if ((type === "LIMIT" || side === "BUY") && !validPositive(orderPrice)) { setError(type === "LIMIT" ? "Enter a valid limit price." : "Enter a valid maximum spend."); return; }
    setBusy(true);
    try {
      await api<{ engine_response: unknown }>("/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ market_id: marketId, side, type, price: orderPrice, quantity, leverage }),
      });
      setSuccess("Order submitted to the matching engine.");
      setQuantity("");
      setBudget("");
      onPlaced();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place order.");
    } finally { setBusy(false); }
  }

  const estimate = type === "LIMIT" && validPositive(price) && validPositive(quantity) && validPositive(leverage)
    ? Number(price) * Number(quantity) / Number(leverage)
    : null;

  return <section className="trade-order" aria-label="Place order">
    <div className="trade-panel__heading"><div><span className="trade-panel__eyebrow">TRADE EXECUTION</span><h2>Place order</h2></div></div>
    <div className="trade-order__sides" role="group" aria-label="Order side"><button type="button" className={side === "BUY" ? "is-buy" : ""} onClick={() => setSide("BUY")}>Buy / Long</button><button type="button" className={side === "SELL" ? "is-sell" : ""} onClick={() => setSide("SELL")}>Sell / Short</button></div>
    <div className="trade-order__types" role="group" aria-label="Order type"><button type="button" aria-pressed={type === "LIMIT"} className={type === "LIMIT" ? "is-active" : ""} onClick={() => setType("LIMIT")}>Limit</button><button type="button" aria-pressed={type === "MARKET"} className={type === "MARKET" ? "is-active" : ""} onClick={() => setType("MARKET")}>Market</button></div>
    <form onSubmit={submit}>
      {type === "LIMIT" && <label>Limit price<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" required /><span>PRICE</span></label>}
      {type === "MARKET" && side === "BUY" && <label>Maximum spend<input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" required /><span>BUDGET</span></label>}
      <label>Quantity<input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" required /><span>UNITS</span></label>
      <label>Leverage<input value={leverage} onChange={(event) => setLeverage(event.target.value)} inputMode="decimal" placeholder="1" autoComplete="off" required /><span>×</span></label>
      <div className="trade-order__estimate"><span>Est. initial margin</span><strong>{estimate !== null && Number.isFinite(estimate) ? `≈ ${estimate.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"}</strong></div>
      {type === "MARKET" && <p className="trade-order__hint">{side === "BUY" ? "The engine spends up to your maximum amount across available asks." : "The engine matches your quantity against available bids."}</p>}
      {error && <p className="trade-order__message is-error" role="alert">{error}</p>}
      {success && <p className="trade-order__message is-success" role="status">{success}</p>}
      {!token ? <button type="button" className={`trade-order__submit ${side === "SELL" ? "is-sell" : ""}`} disabled={!listed} onClick={onSignIn}>{listed ? "Sign in to trade" : "Market not listed"}</button>
        : <button type="submit" className={`trade-order__submit ${side === "SELL" ? "is-sell" : ""}`} disabled={busy || !listed}>{!listed ? "Market not listed" : busy ? "Submitting…" : `${side === "BUY" ? "Buy / Long" : "Sell / Short"} ${type.toLowerCase()}`}</button>}
    </form>
    <p className="trade-order__foot">Orders use simulated collateral. Review price, quantity, and leverage before submitting.</p>
  </section>;
}

function AccountPanel({ marketId, listed, token, refreshKey, onSignIn, onChanged }: { marketId: string; listed: boolean; token: string | null; refreshKey: number; onSignIn: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<AccountTab>("open");
  const [orders, setOrders] = useState<Order[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);
  const [canceling, setCanceling] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !listed) { setOrders([]); setPosition(null); setError(""); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    const path = tab === "positions"
      ? `/market/position/${encodeURIComponent(marketId)}`
      : `/order?market_id=${encodeURIComponent(marketId)}&view=${tab}`;
    api<{ engine_response?: { data?: Position }; orders?: Order[] }>(path, { headers: { token }, signal: controller.signal })
      .then((data) => { if (tab === "positions") setPosition(data.engine_response?.data ?? null); else setOrders(data.orders ?? []); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Account data unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [marketId, listed, token, tab, refreshKey, localRefresh]);

  async function cancelOrder(orderId: string) {
    if (!token) return;
    setCanceling(orderId); setActionError("");
    try {
      await api<{ engine_response: unknown }>("/order", { method: "DELETE", headers: { "Content-Type": "application/json", token }, body: JSON.stringify({ order_id: orderId, market_id: marketId }) });
      onChanged();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not cancel order."); }
    finally { setCanceling(null); }
  }

  return <section className="trade-account" aria-label="Your market activity">
    <div className="trade-account__header"><div className="trade-account__tabs" role="tablist" aria-label="Market account data">
      <button type="button" role="tab" aria-selected={tab === "open"} className={tab === "open" ? "is-active" : ""} onClick={() => setTab("open")}>Open orders</button>
      <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>Order history</button>
      <button type="button" role="tab" aria-selected={tab === "positions"} className={tab === "positions" ? "is-active" : ""} onClick={() => setTab("positions")}>Positions</button>
    </div><button type="button" className="trade-icon-button" onClick={() => setLocalRefresh((value) => value + 1)} disabled={!token || !listed} aria-label="Refresh account data" title="Refresh account data">↻</button></div>
    {!listed ? <div className="trade-account__empty">Account data appears for listed markets.</div>
      : !token ? <div className="trade-account__empty"><strong>Connect your account to see {tab === "positions" ? "positions" : tab === "open" ? "open orders" : "order history"}.</strong><button type="button" onClick={onSignIn}>Sign in <span aria-hidden="true">↗</span></button></div>
      : loading ? <div className="trade-account__empty">Loading {tab === "positions" ? "position" : "orders"}…</div>
      : error ? <div className="trade-account__empty is-error" role="alert">{error}</div>
      : tab === "positions" ? position ? <div className="trade-account__position"><div><span>TYPE</span><strong className={position.type === "LONG" ? "is-buy" : "is-sell"}>{position.type}</strong></div><div><span>QUANTITY</span><strong>{grouped(position.quantity)}</strong></div><div><span>AVG ENTRY</span><strong>{grouped(position.avg_entry_price)}</strong></div><div><span>MARGIN</span><strong>{grouped(position.reserved_margin)}</strong></div><div><span>UNREALIZED PNL</span><strong>{grouped(position.unrealized_pnl)}</strong></div><div><span>FUNDING</span><strong>{grouped(position.funding_accrued)}</strong></div></div>
        : <div className="trade-account__empty">No position in this market.</div>
      : orders.length ? <div className="trade-account__table-wrap"><table><thead><tr><th>ORDER</th><th>SIDE</th><th>TYPE</th><th>PRICE</th><th>QTY / FILLED</th><th>LEVERAGE</th><th>STATUS</th><th>{tab === "open" ? "ACTION" : "UPDATED"}</th></tr></thead><tbody>{orders.map((order) => <tr key={order.order_id}><td title={order.order_id}>{order.order_id.slice(0, 13)}…</td><td className={order.side === "BUY" ? "is-buy" : "is-sell"}>{order.side}</td><td>{order.type}</td><td>{order.type === "MARKET" ? "Market" : formatScaled(order.price)}</td><td>{formatScaled(order.quantity)} / {formatScaled(order.filled)}</td><td>{formatScaled(order.leverage)}×</td><td>{order.status.replaceAll("_", " ")}</td><td>{tab === "open" ? <button type="button" className="trade-account__cancel" disabled={canceling === order.order_id} onClick={() => void cancelOrder(order.order_id)}>{canceling === order.order_id ? "Canceling…" : "Cancel"}</button> : new Date(order.updated_at).toLocaleString()}</td></tr>)}</tbody></table></div>
        : <div className="trade-account__empty">No {tab === "open" ? "open orders" : "order history"} for this market.</div>}
    {actionError && <p className="trade-account__error" role="alert">{actionError}</p>}
    {token && listed && <p className="trade-account__foot">Open orders and history come from the database and may update shortly after an engine response. Showing the latest 50.</p>}
  </section>;
}

export function MarketTradePage({ marketId, token, onBack, onSignIn, onBalanceRefresh }: { marketId: string; token: string | null; onBack: () => void; onSignIn: () => void; onBalanceRefresh: () => void }) {
  const [market, setMarket] = useState<Market | null>(null);
  const [preview, setPreview] = useState(false);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [depth, setDepth] = useState<Depth | null>(null);
  const [depthLoading, setDepthLoading] = useState(false);
  const [depthError, setDepthError] = useState("");
  const [depthRefresh, setDepthRefresh] = useState(0);
  const [feed, setFeed] = useState<"connecting" | "connected" | "offline">("offline");
  const [lastPrice, setLastPrice] = useState<string | null>(null);
  const [markPrice, setMarkPrice] = useState<string | null>(null);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [chosenPrice, setChosenPrice] = useState<string | null>(null);
  const [accountRefresh, setAccountRefresh] = useState(0);

  useEffect(() => {
    setMarket(null); setDepth(null); setPoints([]); setTrades([]); setLastPrice(null); setMarkPrice(null); setChosenPrice(null); setFeed("offline"); setMarketError(""); setMarketLoading(true);
    if (previewPairs.includes(marketId)) {
      setMarket({ market_id: marketId, slug: marketId, imageUrl: "", mark_price: null, last_traded_price: null });
      setPreview(true); setMarketLoading(false); return;
    }
    setPreview(false);
    const controller = new AbortController();
    api<{ market: Market }>(`/market/${encodeURIComponent(marketId)}`, { signal: controller.signal })
      .then(({ market }) => {
        setMarket(market);
        const last = market.last_traded_price ? formatScaled(market.last_traded_price).replaceAll(",", "") : null;
        const mark = market.mark_price ? formatScaled(market.mark_price).replaceAll(",", "") : null;
        setLastPrice(last); setMarkPrice(mark);
      })
      .catch((cause) => { if (!controller.signal.aborted) setMarketError(cause instanceof Error ? cause.message : "Market unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setMarketLoading(false); });
    return () => controller.abort();
  }, [marketId]);

  useEffect(() => {
    if (!market || preview) return;
    const controller = new AbortController();
    setDepthLoading(true); setDepthError("");
    api<{ engine_response: { data: Depth } }>(`/market/depth/${encodeURIComponent(market.market_id)}`, { signal: controller.signal })
      .then((data) => setDepth(data.engine_response.data))
      .catch((cause) => { if (!controller.signal.aborted) setDepthError(cause instanceof Error ? cause.message : "Order book unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setDepthLoading(false); });
    return () => controller.abort();
  }, [market, preview, depthRefresh]);

  useEffect(() => {
    if (!market || preview) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket;
    const connect = () => {
      if (stopped) return;
      setFeed("connecting");
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        if (stopped) return;
        setFeed("connected");
        for (const type of ["BOOK", "TRADE", "TICKER"]) socket.send(JSON.stringify({ action: "SUBSCRIBE", type, market_id: market.market_id }));
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (data.market_id !== market.market_id) return;
          if (Array.isArray(data.bids) && Array.isArray(data.asks)) {
            setDepth({ bids: data.bids as Level[], asks: data.asks as Level[] });
          } else if (typeof data.trade_id === "string" && typeof data.price === "string" && typeof data.quantity === "string") {
            const trade = { trade_id: data.trade_id, price: data.price, quantity: data.quantity, taker_side: data.taker_side === "SELL" ? "SELL" as const : "BUY" as const, time: Date.now() };
            setTrades((current) => [trade, ...current].slice(0, 20));
            setLastPrice(trade.price);
            setPoints((current) => [...current, { price: trade.price, time: trade.time }].slice(-80));
          } else {
            const mark = typeof data.mark_price === "string" ? data.mark_price : null;
            const last = typeof data.last_traded_price === "string" ? data.last_traded_price : null;
            if (mark) setMarkPrice(mark);
            if (last) setLastPrice(last);
            if (mark || last) setPoints((current) => [...current, { price: last ?? mark!, time: Date.now() }].slice(-80));
          }
        } catch { /* Ignore the WebSocket greeting and subscription acknowledgements. */ }
      };
      socket.onerror = () => setFeed("offline");
      socket.onclose = () => { if (!stopped) { setFeed("offline"); retry = setTimeout(connect, 3500); } };
    };
    connect();
    return () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(); };
  }, [market, preview]);

  const label = market ? partsOf(market.slug) : { base: "MARKET", quote: "" };
  const listed = Boolean(market && !preview);
  const current = lastPrice ?? markPrice;
  const icon = icons[label.base];

  return <main className="trade-page">
    <div className="trade-page__inner">
      <div className="trade-page__breadcrumb"><button type="button" onClick={onBack}>Markets</button><span>›</span><strong>{market?.slug ?? "Market"}</strong></div>
      <div className="trade-market-head">
        <div className="trade-market-head__pair">{icon ? <img src={icon} alt="" width="48" height="48" /> : <span className="trade-market-head__fallback">↗</span>}<div><span>PERPETUAL MARKET</span><h1>{market?.slug.replaceAll("-", " / ") ?? (marketLoading ? "Loading market…" : "Market unavailable")}</h1></div></div>
        <div className="trade-market-head__facts"><div><span>LAST PRICE</span><strong>{lastPrice ? grouped(lastPrice) : "—"}</strong></div><div><span>MARK PRICE</span><strong>{markPrice ? grouped(markPrice) : "—"}</strong></div><div><span>MARKET FEED</span><strong className={feed === "connected" ? "is-connected" : ""}>{preview ? "Preview" : feed === "connected" ? "Live" : feed === "connecting" ? "Connecting" : "Offline"}</strong></div></div>
      </div>
      {(preview || marketError) && <div className="trade-page__notice" role="status">{preview ? "This pair is a visual preview and is not listed for trading yet. Live prices, depth, and orders appear for listed markets." : marketError}</div>}
      <div className="trade-layout">
        <PriceChart points={points} current={current} connected={feed === "connected"} />
        <OrderBook depth={depth} loading={depthLoading} error={depthError} current={current} onChoosePrice={setChosenPrice} onRefresh={() => setDepthRefresh((value) => value + 1)} />
        <OrderForm marketId={marketId} listed={listed} token={token} currentPrice={current} selectedPrice={chosenPrice} onSignIn={onSignIn} onPlaced={() => { setAccountRefresh((value) => value + 1); onBalanceRefresh(); }} />
      </div>
      <div className="trade-lower"><div className="trade-lower__activity"><AccountPanel marketId={marketId} listed={listed} token={token} refreshKey={accountRefresh} onSignIn={onSignIn} onChanged={() => { setAccountRefresh((value) => value + 1); onBalanceRefresh(); }} /></div><section className="trade-tape" aria-label="Recent live trades"><div className="trade-panel__heading"><div><span className="trade-panel__eyebrow">LIVE SESSION</span><h2>Recent trades</h2></div></div>{trades.length ? <div className="trade-tape__rows">{trades.map((trade) => <div key={trade.trade_id}><span className={trade.taker_side === "BUY" ? "is-buy" : "is-sell"}>{grouped(trade.price)}</span><span>{grouped(trade.quantity)}</span><time>{new Date(trade.time).toLocaleTimeString()}</time></div>)}</div> : <div className="trade-tape__empty">Trades will appear here as they happen.</div>}</section></div>
    </div>
  </main>;
}
