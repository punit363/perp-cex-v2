import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiBase, formatScaled, icons, partsOf, previewPairs, wsUrl, type Market } from "./MarketDashboard";
import { MarketCandlestickChart } from "./MarketCandlestickChart";
import { mergeCandles, mergeTrades, tickerFromTrades, type StoredCandle, type TradeRecord } from "./marketData";

type Level = { price: string; quantity: string };
type Depth = { asks: Level[]; bids: Level[] };
type LiveTrade = TradeRecord;
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
  state: "HEALTHY" | "LIQUIDATING" | "BANKRUPT";
  mark_price?: string;
  equity?: string;
  maintenance_margin?: string;
  liquidation_price?: string | null;
};
type Liquidation = {
  liquidation_id: string;
  status: "LIQUIDATING" | "COMPLETED" | "BANKRUPT";
  total_filled: string;
  remaining_quantity: string;
  total_liquidation_fee: string;
  total_user_refund: string;
  total_shortfall_covered: string;
  total_uncovered_shortfall: string;
  attempts: number;
  created_at: string;
};
type AccountTab = "open" | "history" | "positions" | "liquidations";
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

function BookSide({ levels, side, onChoosePrice }: { levels: Level[]; side: "ask" | "bid"; onChoosePrice: (price: string) => void }) {
  const visible = side === "ask" ? levels.slice(0, 12).reverse() : levels.slice(0, 12);
  const maximum = Math.max(...visible.map((level) => Number(level.quantity)), 1);
  return <div className={`trade-book__side trade-book__side--${side}`}>
    {visible.length ? visible.map((level, index) => <button type="button" key={`${level.price}-${index}`} onClick={() => onChoosePrice(level.price)} title="Use this price in the limit order form"><span className="trade-book__bar" style={{ width: `${Math.min(100, Number(level.quantity) / maximum * 100)}%` }} /><span className="trade-book__price">{grouped(level.price)}</span><span>{grouped(level.quantity)}</span></button>) : <div className="trade-book__empty">No {side === "ask" ? "asks" : "bids"} available</div>}
  </div>;
}

function OrderBook({ depth, loading, error, current, trades, onChoosePrice, onRefresh }: { depth: Depth | null; loading: boolean; error: string; current: string | null; trades: LiveTrade[]; onChoosePrice: (price: string) => void; onRefresh: () => void }) {
  const [view, setView] = useState<"book" | "trades">("book");
  return <section className="trade-book" aria-label="Live order book">
    <div className="trade-book__header"><div className="trade-book__tabs" role="tablist" aria-label="Market activity"><button type="button" role="tab" aria-selected={view === "book"} className={view === "book" ? "is-active" : ""} onClick={() => setView("book")}>Book</button><button type="button" role="tab" aria-selected={view === "trades"} className={view === "trades" ? "is-active" : ""} onClick={() => setView("trades")}>Trades</button></div>{view === "book" && <button type="button" className="trade-icon-button" onClick={onRefresh} aria-label="Refresh order book" title="Refresh order book">↻</button>}</div>
    {view === "book" ? <>
      <div className="trade-book__columns"><span>PRICE</span><span>SIZE</span></div>
      {loading && !depth ? <div className="trade-book__loading">Loading order book…</div> : <>
        <BookSide levels={depth?.asks ?? []} side="ask" onChoosePrice={onChoosePrice} />
        <div className="trade-book__mid"><strong>{current ? grouped(current) : "—"}</strong><span>LAST PRICE</span></div>
        <BookSide levels={depth?.bids ?? []} side="bid" onChoosePrice={onChoosePrice} />
      </>}
      {error && <p className="trade-book__notice" role="status">{error}</p>}
    </> : <div className="trade-book__trades" role="tabpanel"><div className="trade-book__trade-head"><span>PRICE</span><span>SIZE</span><span>TIME</span></div>{trades.length ? trades.slice(0, 12).map((trade) => <div className="trade-book__trade" key={trade.trade_id}><span className={trade.taker_side === "BUY" ? "is-buy" : "is-sell"}>{grouped(trade.price)}</span><span>{grouped(trade.quantity)}</span><time>{new Date(trade.time).toLocaleTimeString()}</time></div>) : <div className="trade-book__empty-trades">Trades will appear here as they happen.</div>}</div>}
  </section>;
}

function OrderForm({ marketId, listed, halted, token, currentPrice, selectedPrice, onSignIn, onPlaced }: { marketId: string; listed: boolean; halted: boolean; token: string | null; currentPrice: string | null; selectedPrice: string | null; onSignIn: () => void; onPlaced: () => void }) {
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
    if (halted) { setError("Trading is halted for this market."); return; }
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
      {!token ? <button type="button" className={`trade-order__submit ${side === "SELL" ? "is-sell" : ""}`} disabled={!listed || halted} onClick={onSignIn}>{halted ? "Trading halted" : listed ? "Sign in to trade" : "Market not listed"}</button>
        : <button type="submit" className={`trade-order__submit ${side === "SELL" ? "is-sell" : ""}`} disabled={busy || !listed || halted}>{halted ? "Trading halted" : !listed ? "Market not listed" : busy ? "Submitting…" : `${side === "BUY" ? "Buy / Long" : "Sell / Short"} ${type.toLowerCase()}`}</button>}
    </form>
    <p className="trade-order__foot">Orders use simulated collateral. Review price, quantity, and leverage before submitting.</p>
  </section>;
}

function AccountPanel({ marketId, listed, token, refreshKey, onSignIn, onChanged }: { marketId: string; listed: boolean; token: string | null; refreshKey: number; onSignIn: () => void; onChanged: () => void }) {
  const pageSize = 3;
  const [tab, setTab] = useState<AccountTab>("open");
  const [page, setPage] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);
  const [canceling, setCanceling] = useState<string | null>(null);

  useEffect(() => { setPage(0); }, [marketId, tab]);

  useEffect(() => {
    if (!token || !listed) { setOrders([]); setPosition(null); setLiquidations([]); setError(""); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    const path = tab === "positions" ? `/market/position/${encodeURIComponent(marketId)}`
      : tab === "liquidations" ? `/market/${encodeURIComponent(marketId)}/liquidations`
      : `/order?market_id=${encodeURIComponent(marketId)}&view=${tab}`;
    api<{ engine_response?: { data?: Position }; orders?: Order[]; liquidations?: Liquidation[] }>(path, { headers: { token }, signal: controller.signal })
      .then((data) => { if (tab === "positions") setPosition(data.engine_response?.data ?? null); else if (tab === "liquidations") setLiquidations(data.liquidations ?? []); else setOrders(data.orders ?? []); })
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

  const lastPage = Math.max(0, Math.ceil(orders.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleOrders = orders.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return <section className="trade-account" aria-label="Your market activity">
    <div className="trade-account__header"><div className="trade-account__tabs" role="tablist" aria-label="Market account data">
      <button type="button" role="tab" aria-selected={tab === "open"} className={tab === "open" ? "is-active" : ""} onClick={() => setTab("open")}>Open orders</button>
      <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>Order history</button>
      <button type="button" role="tab" aria-selected={tab === "positions"} className={tab === "positions" ? "is-active" : ""} onClick={() => setTab("positions")}>Positions</button>
      <button type="button" role="tab" aria-selected={tab === "liquidations"} className={tab === "liquidations" ? "is-active" : ""} onClick={() => setTab("liquidations")}>Liquidations</button>
    </div><button type="button" className="trade-icon-button" onClick={() => setLocalRefresh((value) => value + 1)} disabled={!token || !listed} aria-label="Refresh account data" title="Refresh account data">↻</button></div>
    {!listed ? <div className="trade-account__empty">Account data appears for listed markets.</div>
      : !token ? <div className="trade-account__empty"><strong>Connect your account to see {tab === "positions" ? "positions" : tab === "liquidations" ? "liquidations" : tab === "open" ? "open orders" : "order history"}.</strong><button type="button" onClick={onSignIn}>Sign in <span aria-hidden="true">↗</span></button></div>
      : loading ? <div className="trade-account__empty">Loading {tab === "positions" ? "position" : tab === "liquidations" ? "liquidations" : "orders"}…</div>
      : error ? <div className="trade-account__empty is-error" role="alert">{error}</div>
      : tab === "positions" ? position ? <div className="trade-account__position"><div><span>TYPE</span><strong className={position.type === "LONG" ? "is-buy" : "is-sell"}>{position.type}</strong></div><div><span>STATUS</span><strong className={position.state === "HEALTHY" ? "is-buy" : "is-sell"}>{position.state}</strong></div><div><span>QUANTITY</span><strong>{grouped(position.quantity)}</strong></div><div><span>AVG ENTRY</span><strong>{grouped(position.avg_entry_price)}</strong></div><div><span>MARGIN</span><strong>{grouped(position.reserved_margin)}</strong></div><div><span>EQUITY</span><strong>{position.equity ? grouped(position.equity) : "—"}</strong></div><div><span>MAINTENANCE</span><strong>{position.maintenance_margin ? grouped(position.maintenance_margin) : "—"}</strong></div><div><span>LIQ. PRICE</span><strong>{position.liquidation_price ? grouped(position.liquidation_price) : "—"}</strong></div><div><span>UNREALIZED PNL</span><strong>{grouped(position.unrealized_pnl)}</strong></div></div>
        : <div className="trade-account__empty">No position in this market.</div>
      : tab === "liquidations" ? liquidations.length ? <div className="trade-account__table-wrap"><table><thead><tr><th>TIME</th><th>STATUS</th><th>FILLED</th><th>REMAINING</th><th>FEE</th><th>REFUND</th><th>INSURANCE / DEFICIT</th></tr></thead><tbody>{liquidations.slice(page * pageSize, (page + 1) * pageSize).map((item) => <tr key={item.liquidation_id}><td>{new Date(item.created_at).toLocaleString()}</td><td className={item.status === "COMPLETED" ? "is-buy" : "is-sell"}>{item.status}</td><td>{grouped(item.total_filled)}</td><td>{grouped(item.remaining_quantity)}</td><td>{grouped(item.total_liquidation_fee)}</td><td>{grouped(item.total_user_refund)}</td><td>{grouped(item.total_shortfall_covered)} / {grouped(item.total_uncovered_shortfall)}</td></tr>)}</tbody></table></div> : <div className="trade-account__empty">No liquidation history for this market.</div>
      : orders.length ? <div className="trade-account__table-wrap"><table><thead><tr><th>ORDER</th><th>SIDE</th><th>TYPE</th><th>PRICE</th><th>QTY / FILLED</th><th>LEVERAGE</th><th>STATUS</th><th>{tab === "open" ? "ACTION" : "UPDATED"}</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.order_id}><td title={order.order_id}>{order.order_id.slice(0, 13)}…</td><td className={order.side === "BUY" ? "is-buy" : "is-sell"}>{order.side}</td><td>{order.type}</td><td>{order.type === "MARKET" ? "Market" : formatScaled(order.price)}</td><td>{formatScaled(order.quantity)} / {formatScaled(order.filled)}</td><td>{formatScaled(order.leverage)}×</td><td>{order.status.replaceAll("_", " ")}</td><td>{tab === "open" ? <button type="button" className="trade-account__cancel" disabled={canceling === order.order_id} onClick={() => void cancelOrder(order.order_id)}>{canceling === order.order_id ? "Canceling…" : "Cancel"}</button> : new Date(order.updated_at).toLocaleString()}</td></tr>)}</tbody></table></div>
        : <div className="trade-account__empty">No {tab === "open" ? "open orders" : "order history"} for this market.</div>}
    {actionError && <p className="trade-account__error" role="alert">{actionError}</p>}
    {token && listed && tab !== "positions" && (tab === "liquidations" ? liquidations.length : orders.length) > 0 && <div className="trade-account__pager"><span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, tab === "liquidations" ? liquidations.length : orders.length)} of {tab === "liquidations" ? liquidations.length : orders.length}</span><div><button type="button" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Previous records">←</button><button type="button" onClick={() => setPage(Math.min(Math.max(0, Math.ceil((tab === "liquidations" ? liquidations.length : orders.length) / pageSize) - 1), page + 1))} disabled={page >= Math.ceil((tab === "liquidations" ? liquidations.length : orders.length) / pageSize) - 1} aria-label="Next records">→</button></div></div>}
  </section>;
}

export function MarketTradePage({ marketId, token, accountEventRevision, onSignIn, onBalanceRefresh }: { marketId: string; token: string | null; accountEventRevision: number; onSignIn: () => void; onBalanceRefresh: () => void }) {
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
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [candles, setCandles] = useState<StoredCandle[]>([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [candleError, setCandleError] = useState("");
  const [candleRefresh, setCandleRefresh] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [chosenPrice, setChosenPrice] = useState<string | null>(null);
  const [accountRefresh, setAccountRefresh] = useState(0);
  const bookUpdateVersion = useRef(0);

  useEffect(() => {
    bookUpdateVersion.current = 0;
    setMarket(null); setDepth(null); setTrades([]); setCandles([]); setCandleError(""); setHistoryError(""); setLastPrice(null); setChosenPrice(null); setFeed("offline"); setMarketError(""); setMarketLoading(true);
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
        setLastPrice(last);
      })
      .catch((cause) => { if (!controller.signal.aborted) setMarketError(cause instanceof Error ? cause.message : "Market unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setMarketLoading(false); });
    return () => controller.abort();
  }, [marketId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!market || preview) return;
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError("");
    api<{ trades: { trade_id: string; price: string; quantity: string; taker_side: "BUY" | "SELL"; created_at: string }[] }>(`/market/${encodeURIComponent(market.market_id)}/trades`, { signal: controller.signal })
      .then(({ trades: history }) => {
        if (controller.signal.aborted) return;
        const restored = history.map((trade) => ({
          trade_id: trade.trade_id,
          price: formatScaled(trade.price).replaceAll(",", ""),
          quantity: formatScaled(trade.quantity).replaceAll(",", ""),
          taker_side: trade.taker_side,
          time: new Date(trade.created_at).getTime(),
        })).filter((trade) => Number.isFinite(trade.time) && trade.price !== "—" && trade.quantity !== "—");
        setTrades((current) => mergeTrades(current, restored));
      })
      .catch((cause) => { if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : "Trade history unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [market, preview]);

  useEffect(() => {
    if (!market || preview) return;
    const controller = new AbortController();
    setCandleLoading(true); setCandleError("");
    api<{ candles: (Omit<StoredCandle, "start_ms"> & { start_ms: number })[] }>(`/market/${encodeURIComponent(market.market_id)}/candles`, { signal: controller.signal })
      .then(({ candles: stored }) => {
        if (controller.signal.aborted) return;
        const restored = stored.map((candle) => ({
          ...candle,
          open: formatScaled(candle.open).replaceAll(",", ""),
          high: formatScaled(candle.high).replaceAll(",", ""),
          low: formatScaled(candle.low).replaceAll(",", ""),
          close: formatScaled(candle.close).replaceAll(",", ""),
          base_volume: formatScaled(candle.base_volume).replaceAll(",", ""),
          quote_volume: formatScaled(candle.quote_volume).replaceAll(",", ""),
        })).filter((candle) => Number.isSafeInteger(candle.start_ms) && candle.open !== "—");
        setCandles((current) => mergeCandles(current, restored));
      })
      .catch((cause) => { if (!controller.signal.aborted) setCandleError(cause instanceof Error ? cause.message : "Candles unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setCandleLoading(false); });
    return () => controller.abort();
  }, [market, preview, candleRefresh]);

  useEffect(() => {
    if (!market || preview) return;
    const controller = new AbortController();
    const versionAtRequest = bookUpdateVersion.current;
    setDepthLoading(true); setDepthError("");
    api<{ engine_response: { data: Depth } }>(`/market/depth/${encodeURIComponent(market.market_id)}`, { signal: controller.signal })
      .then((data) => { if (bookUpdateVersion.current === versionAtRequest) setDepth(data.engine_response.data); })
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
        for (const type of ["BOOK", "TRADE", "TICKER", "CANDLE"]) socket.send(JSON.stringify({ action: "SUBSCRIBE", type, market_id: market.market_id }));
        setDepthRefresh((value) => value + 1);
        setCandleRefresh((value) => value + 1);
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (data.market_id !== market.market_id) return;
          if (data.event_type === "BOOK" && Array.isArray(data.bids) && Array.isArray(data.asks)) {
            bookUpdateVersion.current += 1;
            setDepth({ bids: data.bids as Level[], asks: data.asks as Level[] });
            setDepthError("");
          } else if (data.event_type === "TRADE" && typeof data.trade_id === "string" && typeof data.price === "string" && typeof data.quantity === "string" && (data.taker_side === "BUY" || data.taker_side === "SELL")) {
            const trade: LiveTrade = { trade_id: data.trade_id, price: data.price, quantity: data.quantity, taker_side: data.taker_side, time: typeof data.occurred_at_ms === "number" ? data.occurred_at_ms : Date.now() };
            setTrades((current) => mergeTrades(current, [trade]));
            setLastPrice(trade.price);
          } else if (data.event_type === "CANDLE" && typeof data.start_ms === "number" && typeof data.open === "string" && typeof data.high === "string" && typeof data.low === "string" && typeof data.close === "string" && typeof data.base_volume === "string" && typeof data.quote_volume === "string" && typeof data.trade_count === "number") {
            setCandles((current) => mergeCandles(current, [{
              start_ms: data.start_ms as number,
              open: data.open as string,
              high: data.high as string,
              low: data.low as string,
              close: data.close as string,
              base_volume: data.base_volume as string,
              quote_volume: data.quote_volume as string,
              trade_count: data.trade_count as number,
            }]));
          } else if (data.event_type === "TICKER") {
            const last = typeof data.last_traded_price === "string" ? data.last_traded_price : null;
            if (last) setLastPrice(last);
            if (typeof data.trading_halted === "boolean") {
              setMarket((current) => current ? { ...current, trading_halted: data.trading_halted as boolean } : current);
            }
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
  const ticker = tickerFromTrades(trades, now);
  const current = trades.at(-1)?.price ?? lastPrice;
  const icon = icons[label.base];

  const fmt = (value: number | null, maximumFractionDigits = 8) => value === null || !Number.isFinite(value) ? "—" : value.toLocaleString(undefined, { maximumFractionDigits });
  const changeSign = ticker?.change !== null && ticker?.change !== undefined && ticker.change > 0 ? "+" : "";
  const changeClass = ticker?.change === null || ticker?.change === undefined ? "" : ticker.change >= 0 ? "is-positive" : "is-negative";

  return <main className="trade-page">
    <div className="trade-page__inner">
      <div className="trade-market-head">
        <div className="trade-market-head__pair">{icon ? <img src={icon} alt="" width="44" height="44" /> : <span className="trade-market-head__fallback">↗</span>}<h1>{market?.slug.replaceAll("-", " / ") ?? (marketLoading ? "Loading market…" : "Market unavailable")}</h1><span className="trade-market-head__badge">{market?.trading_halted ? "HALTED" : "PERP"}</span></div>
        <div className={`trade-market-head__price ${changeClass}`}>{fmt(ticker?.price ?? null)}</div>
        <div className="trade-market-head__facts">
          <div><span>24H Change</span><strong className={changeClass}>{ticker?.change === null || ticker?.change === undefined ? "—" : `${changeSign}${fmt(ticker.change)}  ${changeSign}${fmt(ticker.changePercent, 2)}%`}</strong></div>
          <div><span>24H High</span><strong>{fmt(ticker?.high ?? null)}</strong></div>
          <div><span>24H Low</span><strong>{fmt(ticker?.low ?? null)}</strong></div>
          <div><span>24H Volume ({label.quote})</span><strong>{fmt(ticker?.volume ?? null, 2)}</strong></div>
        </div>
      </div>
      {(preview || marketError) && <div className="trade-page__notice" role="status">{preview ? "This pair is a visual preview and is not listed for trading yet. Live prices, depth, and orders appear for listed markets." : marketError}</div>}
      <div className="trade-workspace">
        <MarketCandlestickChart sourceCandles={candles} connected={feed === "connected"} loading={candleLoading} error={candleError} />
        <OrderBook depth={depth} loading={depthLoading} error={depthError} current={current} trades={trades.slice(-20).reverse()} onChoosePrice={setChosenPrice} onRefresh={() => setDepthRefresh((value) => value + 1)} />
        <OrderForm marketId={marketId} listed={listed} halted={Boolean(market?.trading_halted)} token={token} currentPrice={current} selectedPrice={chosenPrice} onSignIn={onSignIn} onPlaced={() => { setAccountRefresh((value) => value + 1); onBalanceRefresh(); }} />
        <AccountPanel marketId={marketId} listed={listed} token={token} refreshKey={accountRefresh + accountEventRevision} onSignIn={onSignIn} onChanged={() => { setAccountRefresh((value) => value + 1); onBalanceRefresh(); }} />
      </div>
    </div>
  </main>;
}
