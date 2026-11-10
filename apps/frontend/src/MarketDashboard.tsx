import { useEffect, useRef, useState } from "react";
import type { StoredCandle } from "./marketData";
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
  market_id: string;
  slug: string;
  imageUrl: string;
  mark_price: string | null;
  last_traded_price: string | null;
  trading_halted?: boolean;
};
type Quote = { mark_price?: string; last_traded_price?: string };
type ViewMarket = Market & { base: string; quote: string; preview: boolean };
type Filter = "All" | "Trends" | "Favorites" | "Top Gainers" | "Top Losers";
type Stats = {
  change: number | null;
  volume: number | null;
  trades: number | null;
  points: number[];
};

export const icons: Record<string, string> = {
  AAVE: aaveIcon,
  ADA: adaIcon,
  AVAX: avaxIcon,
  BCH: bchIcon,
  BTC: btcIcon,
  DOGE: dogeIcon,
  DOT: dotIcon,
  ETH: ethIcon,
  FIL: filIcon,
  GRT: grtIcon,
  LINK: linkIcon,
  LTC: ltcIcon,
  MATIC: maticIcon,
  OP: opIcon,
  SOL: solIcon,
  UNI: uniIcon,
  USD: usdIcon,
  USDC: usdcIcon,
  USDT: usdtIcon,
  XRP: xrpIcon,
};
export const previewPairs = [
  "BTC-USDT",
  "ETH-USDT",
  "SUI-USDT",
  "SOL-USDT",
  "DOGE-USDT",
  "LTC-USDT",
  "MATIC-USDT",
  "UNI-USDT",
  "ADA-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "XRP-USDT",
  "AAVE-ETH",
  "DOT-ETH",
  "GRT-ETH",
  "MATIC-ETH",
  "SOL-ETH",
  "USDC-USDT",
];
const names: Record<string, string> = {
  AAVE: "Aave",
  ADA: "Cardano",
  AVAX: "Avalanche",
  BCH: "Bitcoin Cash",
  BTC: "Bitcoin",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  ETH: "Ethereum",
  FIL: "Filecoin",
  GRT: "The Graph",
  LINK: "Chainlink",
  LTC: "Litecoin",
  MATIC: "Polygon",
  OP: "Optimism",
  SOL: "Solana",
  SUI: "Sui",
  UNI: "Uniswap",
  USDC: "USD Coin",
  USDT: "Tether",
  XRP: "XRP",
};
const local =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
export const apiBase = local ? "http://localhost:8000/api/v1" : "/api/v1";
export const wsUrl = local
  ? `ws://${location.hostname}:7001`
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

export function partsOf(slug: string) {
  const parts = slug.toUpperCase().split(/[-/_]/).filter(Boolean);
  return {
    base: parts[0] || slug.toUpperCase(),
    quote: parts.slice(1).join(" ") || "PERP",
  };
}

export function formatScaled(value: string) {
  try {
    const scaled = BigInt(value);
    const negative = scaled < 0n;
    const absolute = negative ? -scaled : scaled;
    const whole = (absolute / 100_000_000n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = (absolute % 100_000_000n)
      .toString()
      .padStart(8, "0")
      .replace(/0+$/, "");
    return `${negative ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "–";
  }
}

function CoinIcon({ base, size = 38 }: { base: string; size?: number }) {
  if (icons[base])
    return <img src={icons[base]} alt="" width={size} height={size} />;
  if (base === "SUI")
    return (
      <span className="quant-coin quant-coin--sui" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path
            d="M16 4C13.4 8.4 7.5 14.9 7.5 20.5a8.5 8.5 0 0 0 17 0C24.5 14.9 18.6 8.4 16 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M11 22c2-4 7-3 10-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  return (
    <span className="quant-coin" aria-hidden="true">
      {base.slice(0, 1)}
    </span>
  );
}

function asNumber(scaled: string) {
  const value = Number(formatScaled(scaled).replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}
function priceOf(market: ViewMarket, quote?: Quote) {
  const live = quote?.mark_price ?? quote?.last_traded_price;
  const stored = market.mark_price ?? market.last_traded_price;
  const value = live ? Number(live) : stored ? asNumber(stored) : null;
  return value && Number.isFinite(value) && value > 0 ? value : null;
}
function money(value: number | null) {
  if (value === null) return "—";
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function statsFor(candles: StoredCandle[], days: number): Stats {
  const recent = candles.filter(
    (candle) => candle.start_ms >= Date.now() - days * 86_400_000,
  );
  if (!recent.length)
    return { change: null, volume: null, trades: null, points: [] };
  const points = recent
    .map((row) => asNumber(row.close))
    .filter((value): value is number => value !== null && value > 0);
  const first = points[0],
    last = points.at(-1);
  const change =
    first && last && points.length > 1 ? ((last - first) / first) * 100 : null;
  const volume = recent.reduce(
    (total, row) => total + (asNumber(row.quote_volume) ?? 0),
    0,
  );
  const trades = recent.reduce((total, row) => total + row.trade_count, 0);
  return { change, volume, trades, points };
}

function Sparkline({
  values,
  tone,
  large = false,
}: {
  values: number[];
  tone: string;
  large?: boolean;
}) {
  if (values.length < 2)
    return (
      <div
        className={`quant-spark quant-spark--empty ${large ? "quant-spark--large" : ""}`}
      >
        <span>{large ? "Chart appears after trades" : "—"}</span>
      </div>
    );
  const points = values.slice(-48),
    minimum = Math.min(...points),
    spread = Math.max(...points) - minimum || 1;
  const line = points
    .map(
      (value, index) =>
        `${(index / (points.length - 1)) * 100},${83 - ((value - minimum) / spread) * 65}`,
    )
    .join(" ");
  return (
    <div
      className={`quant-spark quant-spark--${tone} ${large ? "quant-spark--large" : ""}`}
      aria-label="Recorded trade price history"
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon
          points={`0,100 ${line} 100,100`}
          fill="currentColor"
          opacity=".1"
        />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function Feature({
  market,
  price,
  stats,
  tone,
  onOpen,
}: {
  market: ViewMarket;
  price: number | null;
  stats: Stats;
  tone: string;
  onOpen: () => void;
}) {
  return (
    <article className={`quant-feature quant-feature--${tone}`}>
      <button
        type="button"
        className="quant-feature__body"
        onClick={onOpen}
        aria-label={`Open ${market.base}/${market.quote} trading market`}
      >
        <span className="quant-feature__identity">
          <span className="quant-feature__icon">
            <CoinIcon base={market.base} />
          </span>
          <span>
            <small>
              {market.base}/{market.quote}
            </small>
            <strong>{names[market.base] ?? market.base}</strong>
          </span>
        </span>
        <span className="quant-feature__label">Price</span>
        <span className="quant-feature__price">{money(price)}</span>
        <span
          className={`quant-feature__change ${stats.change === null ? "is-unknown" : stats.change >= 0 ? "is-positive" : "is-negative"}`}
        >
          <span>{stats.change === null || stats.change >= 0 ? "↗" : "↘"}</span>
          <strong>
            {stats.change === null
              ? "Awaiting change"
              : `${stats.change >= 0 ? "+" : ""}${stats.change.toFixed(2)}%`}
          </strong>
        </span>
      </button>
      <button
        type="button"
        className="quant-feature__more"
        onClick={onOpen}
        aria-label={`Open ${market.base}/${market.quote}`}
      >
        ⋮
      </button>
      <Sparkline values={stats.points} tone={tone} large />
    </article>
  );
}

export function MarketDashboard({
  signedIn,
  onBalances,
  onSignIn,
  onSelectMarket,
  onHome,
}: {
  balance: { available: string; reserved: string } | null;
  balanceLoading: boolean;
  signedIn: boolean;
  onBalances: () => void;
  onSignIn: () => void;
  onSelectMarket: (marketId: string) => void;
  onHome: () => void;
}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [feed, setFeed] = useState<
    "idle" | "connecting" | "connected" | "offline"
  >("idle");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [candles, setCandles] = useState<Record<string, StoredCandle[]>>({});
  const tickerTrack = useRef<HTMLDivElement>(null);
  const [tickerEnds, setTickerEnds] = useState({ start: true, end: false });
  const [quoteFilter, setQuoteFilter] = useState("All quotes");
  const [filter, setFilter] = useState<Filter>("All");
  const [days, setDays] = useState(7);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const marketIds = markets.map((market) => market.market_id).join("|");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    fetch(`${apiBase}/market`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Market list unavailable");
        const payload = (await response.json()) as {
          data?: { markets?: Market[] };
        };
        if (!Array.isArray(payload.data?.markets))
          throw new Error("Invalid market list");
        setMarkets(payload.data.markets);
        setQuotes({});
        setUpdatedAt(Date.now());
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setCandles({});
    markets.forEach((market) => {
      fetch(
        `${apiBase}/market/${encodeURIComponent(market.market_id)}/candles`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) return;
          const payload = (await response.json()) as {
            data?: { candles?: StoredCandle[] };
          };
          if (
            Array.isArray(payload.data?.candles) &&
            !controller.signal.aborted
          )
            setCandles((current) => ({
              ...current,
              [market.market_id]: payload.data!.candles!,
            }));
        })
        .catch(() => {});
    });
    return () => controller.abort();
  }, [marketIds]);

  useEffect(() => {
    if (!markets.length) {
      setFeed("idle");
      return;
    }
    let stopped = false,
      retry: ReturnType<typeof setTimeout> | undefined,
      socket: WebSocket | undefined;
    const ids = new Set(markets.map((market) => market.market_id));
    const connect = () => {
      setFeed("connecting");
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        if (stopped) return;
        setFeed("connected");
        ids.forEach((market_id) =>
          socket?.send(
            JSON.stringify({ action: "SUBSCRIBE", type: "TICKER", market_id }),
          ),
        );
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<
            string,
            unknown
          >;
          if (
            payload.event_type !== "TICKER" ||
            typeof payload.market_id !== "string" ||
            !ids.has(payload.market_id)
          )
            return;
          const id = payload.market_id,
            mark =
              typeof payload.mark_price === "string"
                ? payload.mark_price
                : undefined,
            trade =
              typeof payload.last_traded_price === "string"
                ? payload.last_traded_price
                : undefined;
          if (typeof payload.trading_halted === "boolean")
            setMarkets((current) =>
              current.map((market) =>
                market.market_id === id
                  ? {
                      ...market,
                      trading_halted: payload.trading_halted as boolean,
                    }
                  : market,
              ),
            );
          if (mark || trade) {
            setQuotes((current) => ({
              ...current,
              [id]: {
                ...current[id],
                mark_price: mark ?? current[id]?.mark_price,
                last_traded_price: trade ?? current[id]?.last_traded_price,
              },
            }));
            setUpdatedAt(Date.now());
          }
        } catch {
          /* Ignore non-ticker messages. */
        }
      };
      socket.onerror = () => setFeed("offline");
      socket.onclose = () => {
        if (!stopped) {
          setFeed("offline");
          retry = setTimeout(connect, 3500);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [marketIds]);

  const preview = !markets.length;
  const all: ViewMarket[] = (
    preview
      ? previewPairs.map((slug) => ({
          market_id: slug,
          slug,
          imageUrl: "",
          mark_price: null,
          last_traded_price: null,
        }))
      : markets
  ).map((market) => ({ ...market, ...partsOf(market.slug), preview }));
  const quoteOptions = [
    "All quotes",
    ...new Set(all.map((market) => market.quote)),
  ];
  const stats: Record<string, Stats> = Object.fromEntries(
    all.map((market) => [
      market.market_id,
      statsFor(candles[market.market_id] ?? [], days),
    ]),
  );
  const featured: ViewMarket[] = ["BTC", "ETH", "SUI", "SOL", "DOGE"]
    .map(
      (base) =>
        all.find((market) => market.base === base && market.quote === "USDT") ??
        all.find((market) => market.base === base),
    )
    .filter((value): value is ViewMarket => Boolean(value));
  for (const market of all) {
    if (featured.length >= 5) break;
    if (!featured.some((item) => item.market_id === market.market_id))
      featured.push(market);
  }
  let visible = all.filter(
    (market) =>
      quoteFilter === "All quotes" || market.quote === quoteFilter,
  );
  const updateTickerEnds = () => {
    const track = tickerTrack.current;
    if (!track) return;
    setTickerEnds({
      start: track.scrollLeft <= 2,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 2,
    });
  };
  const slideTicker = (direction: -1 | 1) => {
    const track = tickerTrack.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: "smooth" });
  };
  useEffect(() => {
    const track = tickerTrack.current;
    if (!track) return;
    const observer = new ResizeObserver(updateTickerEnds);
    observer.observe(track);
    updateTickerEnds();
    return () => observer.disconnect();
  }, [all.length]);
  if (filter === "Favorites")
    visible = visible.filter((market) => favorites.includes(market.market_id));
  if (filter === "Trends")
    visible = visible.filter(
      (market) => stats[market.market_id]?.change !== null,
    );
  if (filter === "Top Gainers")
    visible = visible
      .filter((market) => (stats[market.market_id]?.change ?? -Infinity) > 0)
      .sort(
        (a, b) =>
          (stats[b.market_id]?.change ?? 0) - (stats[a.market_id]?.change ?? 0),
      );
  if (filter === "Top Losers")
    visible = visible
      .filter((market) => (stats[market.market_id]?.change ?? Infinity) < 0)
      .sort(
        (a, b) =>
          (stats[a.market_id]?.change ?? 0) - (stats[b.market_id]?.change ?? 0),
      );
  const toggleFavorite = (id: string) =>
    setFavorites((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  return (
    <main className="quant-page">
      <div className="quant-shell">
        <header className="quant-header">
          <div className="quant-header__left">
            <button type="button" className="quant-wordmark" onClick={onHome}>
              APEX<span>EXCHANGE</span>
            </button>
            <span className="quant-header__divider" />
            <span className="quant-breadcrumb">
              ⌂ <span>Overview</span>
              <i>/</i>
              <strong>Markets</strong>
            </span>
          </div>
          <div className="quant-header__right">
            <span
              className={`quant-feed ${feed === "connected" ? "is-connected" : ""}`}
              title={
                feed === "connected"
                  ? "Live market feed connected"
                  : "Live market feed unavailable"
              }
            >
              <i /> {feed === "connected" ? "Live" : "Offline"}
            </span>
            <button
              type="button"
              className="quant-account"
              onClick={signedIn ? onBalances : onSignIn}
            >
              {signedIn ? "Your wallet" : "Sign in"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </header>
        <div className="quant-ticker" aria-label="Market prices">
          <span className="quant-ticker__label">
            MARKETS <i />
          </span>
          <button className="quant-ticker__nav" type="button" aria-label="Previous markets" onClick={() => slideTicker(-1)} disabled={tickerEnds.start}>‹</button>
          <div className="quant-ticker__track" ref={tickerTrack} onScroll={updateTickerEnds}>
          {all.map((market) => (
            <button
              type="button"
              key={market.market_id}
              onClick={() => onSelectMarket(market.market_id)}
            >
              <CoinIcon base={market.base} size={18} />
              <span>
                {market.base}/{market.quote}
              </span>
              <strong>
                {money(priceOf(market, quotes[market.market_id]))}
              </strong>
            </button>
          ))}
          </div>
          <button className="quant-ticker__nav" type="button" aria-label="Next markets" onClick={() => slideTicker(1)} disabled={tickerEnds.end}>›</button>
        </div>
        <section className="quant-content" aria-labelledby="quant-title">
          <div className="quant-intro">
            <span className="quant-update">
              <i />{" "}
              {updatedAt
                ? `Last update: ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Awaiting market update"}
            </span>
            <div className="quant-intro__main">
              <div>
                <h1 id="quant-title">
                  Live Crypto
                  <br />
                  <span>Updates</span>
                  <span className="quant-title-orbit" aria-hidden="true">
                    ✦
                  </span>
                </h1>
                <p>
                  Live prices and recorded activity across perpetual markets.
                </p>
              </div>
              <div className="quant-intro__controls">
                <label>
                  Quote
                  <select
                    value={quoteFilter}
                    onChange={(event) => setQuoteFilter(event.target.value)}
                  >
                    {quoteOptions.map((quote) => (
                      <option key={quote} value={quote}>
                        {quote}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sort
                  <select
                    value={filter}
                    onChange={(event) =>
                      setFilter(event.target.value as Filter)
                    }
                  >
                    {(
                      [
                        "All",
                        "Trends",
                        "Favorites",
                        "Top Gainers",
                        "Top Losers",
                      ] as Filter[]
                    ).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Period
                  <select
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                  >
                    <option value={1}>24H</option>
                    <option value={7}>7D</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          {preview && !loading && (
            <p className="quant-notice" role="status">
              {loadError
                ? "Market service unavailable. Preview pairs are shown without prices."
                : "No markets listed yet. Preview pairs are shown without prices."}
            </p>
          )}
          <div className="quant-feature-grid">
            {featured.map((market, index) => (
              <Feature
                key={market.market_id}
                market={market}
                price={priceOf(market, quotes[market.market_id])}
                stats={stats[market.market_id]!}
                tone={["amber", "violet", "cyan", "green", "rose"][index]!}
                onOpen={() => onSelectMarket(market.market_id)}
              />
            ))}
          </div>
          <section
            className="quant-overview"
            aria-labelledby="quant-overview-title"
          >
            <div className="quant-overview__heading">
              <div>
                <span className="quant-overview__eyebrow">
                  <span>◷</span> Live Updates
                </span>
                <h2 id="quant-overview-title">Market Overview</h2>
              </div>
              <div className="quant-tabs" role="group" aria-label="Market view">
                {(
                  [
                    "All",
                    "Trends",
                    "Favorites",
                    "Top Gainers",
                    "Top Losers",
                  ] as Filter[]
                ).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={filter === tab ? "is-active" : ""}
                    aria-pressed={filter === tab}
                    onClick={() => setFilter(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="quant-table-wrap">
              <table className="quant-table">
                <thead>
                  <tr>
                    <th scope="col">No</th>
                    <th scope="col">Coin name</th>
                    <th scope="col">Price</th>
                    <th scope="col">{days === 1 ? "24H" : "7D"} change</th>
                    <th scope="col">{days === 1 ? "24H" : "7D"} volume</th>
                    <th scope="col">Trades</th>
                    <th scope="col">Chart</th>
                    <th scope="col">
                      <span className="sr-only">Favorite</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((market, index) => {
                    const data = stats[market.market_id]!;
                    const change = data.change;
                    return (
                      <tr
                        key={market.market_id}
                        onClick={() => onSelectMarket(market.market_id)}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            onSelectMarket(market.market_id);
                          }
                        }}
                        tabIndex={0}
                        aria-label={`Open ${market.base}/${market.quote} market`}
                      >
                        <td className="quant-table__number">#{index + 1}</td>
                        <td>
                          <span className="quant-table__coin">
                            <CoinIcon base={market.base} size={24} />
                            <span>
                              <strong>
                                {names[market.base] ?? market.base}
                              </strong>
                              <small>
                                {market.base}/{market.quote}
                              </small>
                            </span>
                          </span>
                        </td>
                        <td className="quant-table__price">
                          {money(priceOf(market, quotes[market.market_id]))}
                        </td>
                        <td>
                          <span
                            className={`quant-delta ${change === null ? "is-unknown" : change >= 0 ? "is-positive" : "is-negative"}`}
                          >
                            {change === null
                              ? "—"
                              : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                          </span>
                        </td>
                        <td className="quant-table__metric">
                          {data.volume === null
                            ? "—"
                            : `$${data.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                        </td>
                        <td className="quant-table__metric">
                          {data.trades === null
                            ? "—"
                            : data.trades.toLocaleString("en-US")}
                        </td>
                        <td className="quant-table__chart">
                          <Sparkline
                            values={data.points}
                            tone={
                              change !== null && change < 0 ? "red" : "green"
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`quant-favorite ${favorites.includes(market.market_id) ? "is-active" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite(market.market_id);
                            }}
                            aria-label={`${favorites.includes(market.market_id) ? "Remove" : "Add"} ${market.base}/${market.quote} ${favorites.includes(market.market_id) ? "from" : "to"} favorites`}
                            aria-pressed={favorites.includes(market.market_id)}
                          >
                            ☆
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visible.length && (
                <div className="quant-empty">
                  {filter === "Favorites"
                    ? "No favorite markets yet. Star a pair to keep it here."
                    : "No markets match these filters."}
                </div>
              )}
            </div>
            <div className="quant-overview__foot">
              <span>
                {loading
                  ? "Loading markets…"
                  : `${visible.length} of ${all.length} markets`}
              </span>
              <button
                type="button"
                onClick={() => setRefreshKey((key) => key + 1)}
                disabled={loading}
              >
                Refresh markets <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
