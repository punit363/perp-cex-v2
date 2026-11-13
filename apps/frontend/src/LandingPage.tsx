import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import {
  apiBase,
  formatScaled,
  icons,
  partsOf,
  previewPairs,
  wsUrl,
  type Market,
} from "./MarketDashboard";

type LandingMarket = Market & { base: string; quote: string; preview: boolean };
type LandingQuote = { mark_price?: string; last_traded_price?: string };
type LandingPageProps = {
  signedIn: boolean;
  username: string | null;
  onMarkets: () => void;
  onMarket: (marketId: string) => void;
  onSignIn: () => void;
  onSignUp: () => void;
  onBalances: () => void;
};

const featuredBases = ["BTC", "ETH", "SOL", "DOGE", "LINK", "AVAX"];

function formatPrice(market: LandingMarket, quote?: LandingQuote) {
  const live = quote?.mark_price ?? quote?.last_traded_price;
  const stored = market.mark_price ?? market.last_traded_price;
  const value = live
    ? Number(live)
    : stored
      ? Number(formatScaled(stored).replaceAll(",", ""))
      : NaN;
  if (!Number.isFinite(value) || value <= 0) return "Price pending";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 2 : 6 })}`;
}

function useLandingMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [quotes, setQuotes] = useState<Record<string, LandingQuote>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/market`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: { markets?: Market[] };
        };
        if (Array.isArray(payload.data?.markets) && !controller.signal.aborted)
          setMarkets(payload.data.markets);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const marketIds = markets.map((market) => market.market_id).join("|");
  useEffect(() => {
    if (!markets.length) return;
    const socket = new WebSocket(wsUrl);
    const ids = new Set(markets.map((market) => market.market_id));
    socket.onopen = () =>
      ids.forEach((market_id) =>
        socket.send(
          JSON.stringify({ action: "SUBSCRIBE", type: "TICKER", market_id })
        )
      );
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
        const marketId = payload.market_id;
        const mark =
          typeof payload.mark_price === "string"
            ? payload.mark_price
            : undefined;
        const trade =
          typeof payload.last_traded_price === "string"
            ? payload.last_traded_price
            : undefined;
        if (mark || trade)
          setQuotes((current) => ({
            ...current,
            [marketId]: {
              mark_price: mark ?? current[marketId]?.mark_price,
              last_traded_price: trade ?? current[marketId]?.last_traded_price,
            },
          }));
      } catch {
        /* Ignore non-ticker messages. */
      }
    };
    return () => socket.close();
  }, [marketIds]);

  const preview = markets.length === 0;
  const choices = preview
    ? previewPairs.map((slug) => ({
        market_id: slug,
        slug,
        imageUrl: "",
        mark_price: null,
        last_traded_price: null,
      }))
    : markets;
  const withParts: LandingMarket[] = choices.map((market) => ({
    ...market,
    ...partsOf(market.slug),
    preview,
  }));
  const featured = featuredBases
    .map(
      (base) =>
        withParts.find(
          (market) => market.base === base && market.quote === "USDT"
        ) ?? withParts.find((market) => market.base === base)
    )
    .filter((market): market is LandingMarket => Boolean(market));
  for (const market of withParts) {
    if (featured.length >= 6) break;
    if (!featured.some((item) => item.market_id === market.market_id))
      featured.push(market);
  }
  return { markets: featured, quotes };
}

type Candle = {
  x: number;
  open: number;
  close: number;
  high: number;
  low: number;
};
const chartCandles: Candle[] = Array.from({ length: 58 }, (_, index) => {
  const base =
    54 +
    Math.sin(index * 0.19) * 13 +
    Math.sin(index * 0.51) * 5 +
    (index > 37 ? (index - 37) * 0.7 : 0);
  const open = base + Math.sin(index * 1.71) * 4;
  const close = base + Math.cos(index * 1.23) * 4;
  return {
    x: 14 + index * 12.9,
    open,
    close,
    high: Math.min(open, close) - 3 - (index % 3),
    low: Math.max(open, close) + 4 + (index % 4),
  };
});

function ChartArtwork({ crop = false }: { crop?: boolean }) {
  const average = chartCandles
    .map(
      (candle, index) =>
        `${candle.x},${candle.close * 0.7 + 17 + Math.sin(index * 0.15) * 5}`
    )
    .join(" ");
  return (
    <div
      className={`landing-chart-art ${crop ? "landing-chart-art--crop" : ""}`}
      role="img"
      aria-label="Illustrative candlestick chart preview, not live market data"
    >
      <svg viewBox="0 0 780 230" preserveAspectRatio="none" aria-hidden="true">
        {[42, 86, 130, 174, 218].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="780"
            y2={y}
            className="landing-chart-art__grid"
          />
        ))}
        {[78, 156, 234, 312, 390, 468, 546, 624, 702].map((x) => (
          <line
            key={x}
            x1={x}
            y1="0"
            x2={x}
            y2="230"
            className="landing-chart-art__grid"
          />
        ))}
        <polyline points={average} className="landing-chart-art__average" />
        {chartCandles.map((candle, index) => {
          const up = candle.close < candle.open;
          const top = Math.min(candle.open, candle.close),
            height = Math.max(2, Math.abs(candle.close - candle.open));
          return (
            <g key={index} className={up ? "is-up" : "is-down"}>
              <line
                x1={candle.x}
                x2={candle.x}
                y1={candle.high}
                y2={candle.low}
              />
              <rect
                x={candle.x - 3.1}
                y={top}
                width="6.2"
                height={height}
                rx=".6"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ExchangePreview({
  variant = "full",
}: {
  variant?: "full" | "chart" | "order";
}) {
  return (
    <div
      className={`landing-preview landing-preview--${variant}`}
      aria-label="Illustrative APEX trading interface preview"
    >
      {variant === "full" && (
        <div className="landing-preview__browser">
          <span className="landing-preview__lights">
            <i />
            <i />
            <i />
          </span>
          <span className="landing-preview__address">
            pex.exchange / trading desk
          </span>
          <span className="landing-preview__browser-end">
            ◯ &nbsp; ↗ &nbsp; ▫
          </span>
        </div>
      )}
      <div className="landing-preview__appbar">
        <span className="landing-preview__brand">
          <b>∧</b> PEX
        </span>
        <span>Markets</span>
        <span>Perpetuals</span>
        <span>Balances</span>
        <small>PRODUCT PREVIEW · ILLUSTRATIVE</small>
      </div>
      <div className="landing-preview__pair">
        <span className="landing-preview__coin">₿</span>
        <strong>BTC / USDT</strong>
        <span>Perpetual market</span>
        <i />
        <span>Mark price</span>
        <b>-</b>
        <span>24h change</span>
        <b>-</b>
        <span>Funding</span>
        <b>-</b>
      </div>
      <div className="landing-preview__workspace">
        {variant !== "order" && (
          <div className="landing-preview__watchlist">
            <div className="landing-preview__search">
              ⌕ &nbsp; Search markets
            </div>
            <div className="landing-preview__watch-head">
              PAIR <span>MARK</span>
            </div>
            {[
              "BTC / USDT",
              "ETH / USDT",
              "SOL / USDT",
              "DOGE / USDT",
              "LINK / USDT",
              "AVAX / USDT",
            ].map((pair, index) => (
              <div className="landing-preview__watch-row" key={pair}>
                <span>{pair}</span>
                <small>{index % 2 ? "↗" : "↘"}</small>
              </div>
            ))}
          </div>
        )}
        {variant !== "order" && (
          <div className="landing-preview__chart">
            <div className="landing-preview__tabs">
              <strong>Chart</strong>
              <span>Trades</span>
              <span>1m</span>
              <span>5m</span>
              <span>15m</span>
              <span>1h</span>
            </div>
            <ChartArtwork crop={variant === "chart"} />
            <div className="landing-preview__volume">
              {chartCandles.slice(0, 52).map((candle, index) => (
                <i
                  key={index}
                  className={candle.close < candle.open ? "is-up" : "is-down"}
                  style={{ height: `${10 + ((index * 19) % 37)}%` }}
                />
              ))}
            </div>
          </div>
        )}
        <div className="landing-preview__depth">
          <div className="landing-preview__tabs">
            <strong>Order book</strong>
            <span>Trades</span>
          </div>
          <div className="landing-preview__depth-head">
            <span>PRICE</span>
            <span>SIZE</span>
          </div>
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={`ask-${index}`}
              className="landing-preview__depth-row is-ask"
            >
              <i style={{ width: `${25 + ((index * 11) % 68)}%` }} />
              <span>-</span>
              <span>-</span>
            </div>
          ))}
          <div className="landing-preview__spread">MARK PRICE &nbsp; -</div>
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={`bid-${index}`}
              className="landing-preview__depth-row is-bid"
            >
              <i style={{ width: `${32 + ((index * 13) % 62)}%` }} />
              <span>-</span>
              <span>-</span>
            </div>
          ))}
        </div>
        {variant === "order" && (
          <div className="landing-preview__ticket">
            <div className="landing-preview__tabs">
              <strong>Place order</strong>
              <span>Market</span>
            </div>
            <div className="landing-preview__side">
              <b>Buy / Long</b>
              <span>Sell / Short</span>
            </div>
            <label>
              Order type <strong>Limit</strong>
            </label>
            <label>
              Price <strong>USDT</strong>
            </label>
            <label>
              Quantity <strong>BTC</strong>
            </label>
            <div className="landing-preview__ticket-slider">
              <i />
            </div>
            <button type="button" tabIndex={-1}>
              Preview order ticket
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MarketTile({
  market,
  quote,
  onOpen,
}: {
  market: LandingMarket;
  quote?: LandingQuote;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="landing-market-tile"
      onClick={onOpen}
      aria-label={`Explore ${market.base}/${market.quote} market`}
    >
      <span className="landing-market-tile__icon">
        {icons[market.base] ? (
          <img src={icons[market.base]} alt="" />
        ) : (
          market.base.slice(0, 1)
        )}
      </span>
      <span className="landing-market-tile__copy">
        <strong>
          {market.base}
          <span> / {market.quote}</span>
        </strong>
        <small>{formatPrice(market, quote)}</small>
      </span>
      <span className="landing-market-tile__arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

export function LandingPage({
  signedIn,
  username,
  onMarkets,
  onMarket,
  onSignIn,
  onSignUp,
  onBalances,
}: LandingPageProps) {
  const root = useRef<HTMLElement>(null);
  const { markets, quotes } = useLandingMarkets();
  const [marketTab, setMarketTab] = useState<"All" | "USDT" | "ETH">("All");
  const visibleMarkets = useMemo(
    () =>
      markets.filter(
        (market) => marketTab === "All" || market.quote === marketTab
      ),
    [markets, marketTab]
  );

  useEffect(() => {
    if (
      !root.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      syncTouch: false,
    });
    const update = () => ScrollTrigger.update();
    const raf = (time: number) => lenis.raf(time * 1000);
    lenis.on("scroll", update);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    const desktopMotion = gsap.matchMedia();
    const context = gsap.context(() => {
      gsap.fromTo(
        ".landing-hero__eyebrow, .landing-hero__title, .landing-hero__actions, .landing-hero__aside",
        { y: 27, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.9,
          ease: "power3.out",
          stagger: 0.11,
          delay: 0.12,
          clearProps: "all",
        }
      );
      gsap.fromTo(
        ".landing-hero__field",
        { scale: 1.07, opacity: 0.25 },
        {
          scale: 1,
          opacity: 1,
          duration: 1.7,
          ease: "power2.out",
          clearProps: "all",
        }
      );
      desktopMotion.add("(min-width: 901px)", () => {
        gsap.to(".landing-hero__dots", {
          yPercent: 10,
          ease: "none",
          scrollTrigger: {
            trigger: ".landing-hero",
            start: "top top",
            end: "bottom top",
            scrub: 0.7,
          },
        });
        gsap.fromTo(
          ".landing-platform__frame .landing-preview",
          { y: 58, scale: 0.965 },
          {
            y: -18,
            scale: 1,
            ease: "none",
            scrollTrigger: {
              trigger: ".landing-platform__frame",
              start: "top 88%",
              end: "bottom 26%",
              scrub: 0.65,
            },
          }
        );
        gsap.utils
          .toArray<HTMLElement>(".landing-product__art .landing-preview")
          .forEach((preview, index) => {
            gsap.to(preview, {
              y: index % 2 ? -20 : -34,
              ease: "none",
              scrollTrigger: {
                trigger: preview.closest(".landing-product"),
                start: "top bottom",
                end: "bottom top",
                scrub: 0.6,
              },
            });
          });
      });
      gsap.utils
        .toArray<HTMLElement>("[data-landing-reveal]")
        .forEach((element) => {
          gsap.fromTo(
            element,
            { y: 36, autoAlpha: 0 },
            {
              y: 0,
              autoAlpha: 1,
              duration: 0.8,
              ease: "power2.out",
              clearProps: "all",
              scrollTrigger: { trigger: element, start: "top 86%", once: true },
            }
          );
        });
    }, root);
    const refresh = () => ScrollTrigger.refresh();
    document.fonts.ready.then(refresh).catch(() => {});
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      context.revert();
      desktopMotion.revert();
      lenis.off("scroll", update);
      gsap.ticker.remove(raf);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return (
    <main ref={root} className="landing-v2">
      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-hero__field" aria-hidden="true">
          <div className="landing-hero__dots" />
          <div className="landing-hero__marker landing-hero__marker--one">
            <span>MARKET DEPTH</span>
            <strong>LIVE</strong>
          </div>
          <div className="landing-hero__marker landing-hero__marker--two">
            <span>PERPETUAL DESK</span>
            <strong>PEX</strong>
          </div>
        </div>
        <header className="landing-nav">
          <button
            type="button"
            className="landing-nav__brand"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <span className="landing-nav__mark">∧</span>
            <span>
              PEX <small>EXCHANGE</small>
            </span>
          </button>
          <div className="landing-nav__account">
            {signedIn ? (
              <button
                type="button"
                className="landing-nav__signin"
                onClick={onBalances}
              >
                {username ?? "Account"}
              </button>
            ) : (
              <button
                type="button"
                className="landing-nav__signin"
                onClick={onSignIn}
              >
                Sign in
              </button>
            )}
            <button
              type="button"
              className="landing-nav__signup"
              onClick={signedIn ? onMarkets : onSignUp}
            >
              {signedIn ? "Trade now" : "Sign up"}
            </button>
          </div>
        </header>
        <div className="landing-hero__content">
          <div className="landing-hero__main">
            <span className="landing-hero__eyebrow">
              <b>TRADE SMARTER.</b> MOVE WITH THE MARKET
            </span>
            <h1 id="landing-hero-title" className="landing-hero__title">
              Money
              <br />
              Matter
            </h1>
            <div className="landing-hero__actions">
              <button
                type="button"
                className="landing-pill landing-pill--green"
                onClick={onMarkets}
              >
                Explore markets <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
          <p className="landing-hero__aside">
            A focused perpetual exchange for watching live depth, placing
            orders, and tracking positions{" "}
            <strong>from one trading desk.</strong>
          </p>
        </div>
        <div className="landing-hero__scroll" aria-hidden="true">
          SCROLL TO EXPLORE <span>↓</span>
        </div>
      </section>

      <section
        className="landing-markets"
        id="markets"
        aria-labelledby="landing-markets-title"
      >
        <div className="landing-section-head" data-landing-reveal>
          <span className="landing-kicker">
            <b>01 /</b> MARKETS IN MOTION
          </span>
          <h2 id="landing-markets-title">
            Stay ahead across
            <br />
            the crypto market.
          </h2>
          <p>
            Scan the pairs available on PEX, then open the market that matters
            to you.
          </p>
        </div>
        <div
          className="landing-markets__tabs"
          role="group"
          aria-label="Market quote filter"
          data-landing-reveal
        >
          {(["All", "USDT", "ETH"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={marketTab === tab}
              className={marketTab === tab ? "is-active" : ""}
              onClick={() => setMarketTab(tab)}
            >
              {tab === "All" ? "All markets" : `${tab} pairs`}
            </button>
          ))}
        </div>
        <div className="landing-markets__rail" data-landing-reveal>
          <div className="landing-markets__row">
            {visibleMarkets.length ? (
              visibleMarkets.map((market) => (
                <MarketTile
                  key={market.market_id}
                  market={market}
                  quote={quotes[market.market_id]}
                  onOpen={() =>
                    market.preview ? onMarkets() : onMarket(market.market_id)
                  }
                />
              ))
            ) : (
              <span className="landing-markets__empty">
                No pairs in this quote group yet.
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="landing-pill landing-pill--green landing-markets__cta"
          onClick={onMarkets}
        >
          View all markets <span aria-hidden="true">↗</span>
        </button>
      </section>

      <section
        className="landing-platform"
        id="platform"
        aria-labelledby="landing-platform-title"
      >
        <div className="landing-section-head" data-landing-reveal>
          <span className="landing-kicker">
            <b>02 /</b> THE TRADING DESK
          </span>
          <h2 id="landing-platform-title">
            Everything connected in
            <br />
            one focused platform.
          </h2>
          <p>
            Market context, execution, and account activity sit within reach.
          </p>
        </div>
        <div className="landing-platform__frame" data-landing-reveal>
          <ExchangePreview />
        </div>
        <div className="landing-platform__benefits" data-landing-reveal>
          <div>
            <span>01 / MARKET CONTEXT</span>
            <p>Follow mark prices, candles, and the order book together.</p>
          </div>
          <div>
            <span>02 / ORDER ENTRY</span>
            <p>Place limit or market orders from the same workspace.</p>
          </div>
          <div>
            <span>03 / ACCOUNT ACTIVITY</span>
            <p>Review open orders, fills, balances, and positions.</p>
          </div>
        </div>
      </section>

      <section
        className="landing-products"
        id="products"
        aria-labelledby="landing-products-title"
      >
        <div className="landing-products__heading" data-landing-reveal>
          <span className="landing-kicker">
            <b>03 /</b> OUR PRODUCT
          </span>
          <h2 id="landing-products-title">
            Built for modern
            <br />
            trading.
          </h2>
        </div>
        <div className="landing-products__grid">
          <article className="landing-product" data-landing-reveal>
            <div className="landing-product__art landing-product__art--chart">
              <ExchangePreview variant="chart" />
            </div>
            <div className="landing-product__copy">
              <div>
                <span>PERPETUAL MARKETS</span>
                <h3>
                  Read the market before
                  <br />
                  you make your move.
                </h3>
              </div>
              <button type="button" onClick={onMarkets}>
                Explore markets <span aria-hidden="true">↗</span>
              </button>
            </div>
          </article>
          <article className="landing-product" data-landing-reveal>
            <div className="landing-product__art landing-product__art--order">
              <ExchangePreview variant="order" />
            </div>
            <div className="landing-product__copy">
              <div>
                <span>ORDER EXECUTION</span>
                <h3>
                  Move from price discovery
                  <br />
                  to your next order.
                </h3>
              </div>
              <button type="button" onClick={onMarkets}>
                Open trading desk <span aria-hidden="true">↗</span>
              </button>
            </div>
          </article>
        </div>
      </section>

      <section
        className="landing-capabilities"
        id="capabilities"
        aria-labelledby="landing-capabilities-title"
      >
        <div className="landing-capabilities__intro" data-landing-reveal>
          <span className="landing-kicker">
            <b>04 /</b> BUILT FOR THE FLOW
          </span>
          <h2 id="landing-capabilities-title">
            Everything you need
            <br />
            to stay in the market.
          </h2>
        </div>
        <div className="landing-capabilities__grid" data-landing-reveal>
          <div>
            <span>MARKETS</span>
            <strong>Live depth</strong>
            <p>See bids and asks as they change.</p>
          </div>
          <div>
            <span>EXECUTION</span>
            <strong>Two order types</strong>
            <p>Choose limit or market entry.</p>
          </div>
          <div>
            <span>RISK</span>
            <strong>Position view</strong>
            <p>Track margin and unrealized P&amp;L.</p>
          </div>
          <div>
            <span>ACCOUNT</span>
            <strong>One desk</strong>
            <p>Keep balances and activity close.</p>
          </div>
        </div>
      </section>

      <section
        className="landing-convert"
        aria-label="Start trading"
        data-landing-reveal
      >
        <div>
          <span className="landing-kicker">
            <b>05 /</b> YOUR NEXT MOVE
          </span>
          <h2>
            Enter the market
            <br />
            with a clearer view.
          </h2>
          <p>Explore the desk, then connect your account when you are ready.</p>
        </div>
        <button
          type="button"
          className="landing-pill landing-pill--green"
          onClick={signedIn ? onMarkets : onSignUp}
        >
          {signedIn ? "Explore markets" : "Create an account"}
          <span aria-hidden="true">↗</span>
        </button>
      </section>

      <footer className="landing-footer">
        <span>∧ PEX EXCHANGE</span>
        <span>Simulated perpetual trading environment</span>
        <button type="button" onClick={onMarkets}>
          Markets ↗
        </button>
      </footer>
    </main>
  );
}
