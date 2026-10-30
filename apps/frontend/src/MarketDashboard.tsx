import { useEffect, useState } from "react";
import aaveIcon from "../public/icons/aave_coin.png";
import adaIcon from "../public/icons/ada_coin.png";
import avaxIcon from "../public/icons/avax_coin.png";
import bchIcon from "../public/icons/bch_coin.png";
import btcIcon from "../public/icons/btc_coin.png";
import dogeIcon from "../public/icons/doge_coin.png";
import dotIcon from "../public/icons/dot_coin.png";
import ethIcon from "../public/icons/eth_coin.png";
import filIcon from "../public/icons/fil_coin.png";
import grtIcon from "../public/icons/grt_coin.png";
import linkIcon from "../public/icons/link_coin.png";
import ltcIcon from "../public/icons/ltc_coin.png";
import maticIcon from "../public/icons/matic_coin.png";
import opIcon from "../public/icons/op_coin.png";
import solIcon from "../public/icons/sol_coin.png";
import uniIcon from "../public/icons/uni_coin.png";
import usdIcon from "../public/icons/usd_coin.png";
import usdcIcon from "../public/icons/usdc_coin.png";
import usdtIcon from "../public/icons/usdt_coin.png";
import xrpIcon from "../public/icons/xrp_coin.png";

export type Market = {
  id: string;
  slug: string;
  imageUrl: string;
  mark_price: string | null;
  last_traded_price: string | null;
};
type Balance = { available: string; reserved: string };
type Quote = { mark_price?: string; last_traded_price?: string };
type MarketCardData = Market & { base: string; quote: string; preview: boolean };

export const icons: Record<string, string> = {
  AAVE: aaveIcon, ADA: adaIcon, AVAX: avaxIcon, BCH: bchIcon, BTC: btcIcon,
  DOGE: dogeIcon, DOT: dotIcon, ETH: ethIcon, FIL: filIcon, GRT: grtIcon,
  LINK: linkIcon, LTC: ltcIcon, MATIC: maticIcon, OP: opIcon, SOL: solIcon,
  UNI: uniIcon, USD: usdIcon, USDC: usdcIcon, USDT: usdtIcon, XRP: xrpIcon,
};
export const previewPairs = [
  "AAVE-ETH", "DOT-ETH", "GRT-ETH", "MATIC-ETH", "SOL-ETH",
  "ADA-USDT", "BCH-USDT", "BTC-USDT", "DOGE-USDT", "ETH-USDT",
];
const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
export const apiBase = local ? "http://localhost:8000/api/v1" : "/api/v1";
export const wsUrl = local
  ? `ws://${location.hostname}:7000`
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

export function partsOf(slug: string) {
  const parts = slug.toUpperCase().split(/[-/_]/).filter(Boolean);
  return { base: parts[0] || slug.toUpperCase(), quote: parts.slice(1).join(" ") || "PERP" };
}

export function formatScaled(value: string) {
  try {
    const scaled = BigInt(value);
    const negative = scaled < 0n;
    const absolute = negative ? -scaled : scaled;
    const whole = (absolute / 100_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = (absolute % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
    return `${negative ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "—";
  }
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="market-card__chart market-card__chart--empty"><span>LIVE HISTORY PENDING</span></div>;
  }
  const minimum = Math.min(...values);
  const span = Math.max(...values) - minimum || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${70 - ((value - minimum) / span) * 52}`).join(" ");
  const rising = values.at(-1)! >= values[0]!;
  return (
    <div className={`market-card__chart ${rising ? "is-rising" : "is-falling"}`} aria-label="Recent live price movement">
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function MarketCard({ market, live, history, onSelect }: { market: MarketCardData; live?: Quote; history: number[]; onSelect: () => void }) {
  const price = live?.last_traded_price ?? live?.mark_price
    ?? (market.last_traded_price ? formatScaled(market.last_traded_price) : null)
    ?? (market.mark_price ? formatScaled(market.mark_price) : null);
  const source = live?.last_traded_price || market.last_traded_price ? "LAST TRADE" : "MARK PRICE";
  return (
    <button type="button" className="market-card" onClick={onSelect} aria-label={`Open ${market.base} ${market.quote} market`}>
      <div className="market-card__top">
        <div className="market-card__pair"><strong>{market.base}</strong><span>{market.quote}</span></div>
        <img src={icons[market.base] || market.imageUrl || usdIcon} alt="" width="36" height="36" />
      </div>
      <div className="market-card__price">{price ? <>{price}<small>{market.quote === "PERP" ? "USD" : market.quote}</small></> : "—"}</div>
      <span className={`market-card__badge ${price ? "has-price" : ""}`}>{price ? source : market.preview ? "PREVIEW PAIR" : "AWAITING PRICE"}</span>
      <Sparkline values={history} />
    </button>
  );
}

export function MarketDashboard({ balance, balanceLoading, signedIn, onBalances, onSignIn, onSelectMarket }: {
  balance: Balance | null;
  balanceLoading: boolean;
  signedIn: boolean;
  onBalances: () => void;
  onSignIn: () => void;
  onSelectMarket: (marketId: string) => void;
}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [feedState, setFeedState] = useState<"idle" | "connecting" | "connected" | "offline">("idle");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [history, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    fetch(`${apiBase}/market`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Market list unavailable");
        const payload = await response.json() as { data?: { markets?: Market[] } };
        if (!Array.isArray(payload.data?.markets)) throw new Error("Invalid market list");
        setMarkets(payload.data.markets);
        setQuotes({});
        setHistory({});
      })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (markets.length === 0) {
      setFeedState("idle");
      return;
    }
    setFeedState("connecting");
    const socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      setFeedState("connected");
      for (const market of markets) {
        socket.send(JSON.stringify({ action: "SUBSCRIBE", type: "TICKER", market_id: market.id }));
      }
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (typeof payload.market_id !== "string" || !markets.some((market) => market.id === payload.market_id)) return;
        const mark = typeof payload.mark_price === "string" ? payload.mark_price : undefined;
        const trade = typeof payload.last_traded_price === "string" ? payload.last_traded_price : undefined;
        if (!mark && !trade) return;
        const marketId = payload.market_id;
        setQuotes((current) => ({ ...current, [marketId]: { ...current[marketId], mark_price: mark ?? current[marketId]?.mark_price, last_traded_price: trade ?? current[marketId]?.last_traded_price } }));
        const point = Number(trade ?? mark);
        if (Number.isFinite(point)) setHistory((current) => ({ ...current, [marketId]: [...(current[marketId] ?? []), point].slice(-24) }));
      } catch { /* The service also sends connection and subscription acknowledgements. */ }
    };
    socket.onerror = () => setFeedState("offline");
    socket.onclose = () => setFeedState("offline");
    return () => socket.close();
  }, [markets]);

  const preview = markets.length === 0;
  const cards: MarketCardData[] = (preview
    ? previewPairs.map((slug) => ({ id: slug, slug, imageUrl: "", mark_price: null, last_traded_price: null }))
    : markets
  ).map((market) => ({ ...market, ...partsOf(market.slug), preview }));
  const groups = Array.from(new Set(cards.map((market) => market.quote))).sort((a, b) => {
    const priority = (value: string) => value === "ETH" ? 0 : value === "USDT" ? 1 : 2;
    return priority(a) - priority(b) || a.localeCompare(b);
  });
  const liveQuoteCount = Object.keys(quotes).length;

  return (
    <main className="markets-page">
      <div className="markets-page__inner">
        <div className="overview-grid">
          <section className="overview-card overview-card--balance" aria-label="Account collateral">
            <span className="overview-card__label">{signedIn ? "AVAILABLE COLLATERAL" : "YOUR TRADING ACCOUNT"}</span>
            <strong className="overview-card__value">{signedIn ? balanceLoading ? "Loading…" : balance ? `$${balance.available}` : "—" : "Ready when you are"}</strong>
            <p>{signedIn ? balance ? `Reserved collateral: $${balance.reserved}` : "Open balances to view your collateral." : "Sign in to view your collateral and trading activity."}</p>
            <button type="button" onClick={signedIn ? onBalances : onSignIn}>{signedIn ? "Manage wallet balance" : "Connect account"} <span aria-hidden="true">↗</span></button>
          </section>
          <section className="overview-card overview-card--status" aria-label="Market connection">
            <span className="overview-card__label">MARKET CONNECTION</span>
            <div className="overview-card__stats">
              <div><strong>{loading ? "—" : markets.length}</strong><span>Listed markets</span></div>
              <div><strong>{liveQuoteCount}</strong><span>Live quotes received</span></div>
            </div>
            <div className="overview-card__status"><span className={feedState === "connected" ? "status-dot is-online" : "status-dot"} />{feedState === "connected" ? "Live market feed connected" : feedState === "connecting" ? "Connecting to market feed" : "Live market feed unavailable"}</div>
          </section>
        </div>

        <div className="markets-heading">
          <div><h1>Markets</h1><p>{preview ? "Browse the layout while live market listings are unavailable." : "Explore listed perpetual markets and live prices."}</p></div>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} aria-label="Refresh markets" title="Refresh markets"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.2-5.5M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
        {preview && !loading && <p className="market-preview-note" role="status">{loadError ? "The market service could not be reached. Showing preview pairs with no price data." : "No markets are listed yet. Showing preview pairs with no price data."}</p>}
        {groups.map((quote) => (
          <section className="market-group" key={quote} aria-label={`${quote} markets`}>
            <div className="market-group__heading"><img src={icons[quote] || usdIcon} alt="" width="30" height="30" /><h2>{quote} MARKETS</h2><span>{cards.filter((market) => market.quote === quote).length} PAIRS</span></div>
            <div className="market-grid">{cards.filter((market) => market.quote === quote).map((market) => <MarketCard key={market.id} market={market} live={quotes[market.id]} history={history[market.id] ?? []} onSelect={() => onSelectMarket(market.id)} />)}</div>
          </section>
        ))}
      </div>
    </main>
  );
}
