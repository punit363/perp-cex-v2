import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { aggregateCandles, candleDuration, type StoredCandle } from "./marketData";

type ChartRange = "all" | "daily" | "weekly" | "monthly" | "yearly";
const choices: { value: ChartRange; label: string; duration: number | null }[] = [
  { value: "all", label: "All", duration: null },
  { value: "daily", label: "Daily", duration: 24 * 60 * 60_000 },
  { value: "weekly", label: "Weekly", duration: 7 * 24 * 60 * 60_000 },
  { value: "monthly", label: "Monthly", duration: 30 * 24 * 60 * 60_000 },
  { value: "yearly", label: "Yearly", duration: 365 * 24 * 60 * 60_000 },
];

function sameCandle(a: CandlestickData<UTCTimestamp>, b: CandlestickData<UTCTimestamp>) {
  return a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
}

export function MarketCandlestickChart({ sourceCandles, connected, loading, error, marketLabel, marketIcon, accentColor, lastPrice, changePercent, volume, illustrative, onMarkets }: { sourceCandles: StoredCandle[]; connected: boolean; loading: boolean; error: string; marketLabel: string; marketIcon?: string; accentColor: string; lastPrice: string | null; changePercent: number | null; volume: number | null; illustrative: boolean; onMarkets: () => void }) {
  const [range, setRange] = useState<ChartRange>("monthly");
  const [chartMode, setChartMode] = useState<"bars" | "candles" | "area">("area");
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bars = useRef<ISeriesApi<"Bar"> | null>(null);
  const area = useRef<ISeriesApi<"Area"> | null>(null);
  const previous = useRef<CandlestickData<UTCTimestamp>[]>([]);
  const previousRange = useRef<ChartRange | null>(null);
  const visibleSource = useMemo(() => {
    const duration = choices.find((choice) => choice.value === range)?.duration;
    if (!duration || !sourceCandles.length) return sourceCandles;
    const cutoff = sourceCandles.at(-1)!.start_ms - duration;
    return sourceCandles.filter((candle) => candle.start_ms >= cutoff);
  }, [sourceCandles, range]);
  const duration = candleDuration(visibleSource, "all");
  const candles = useMemo(() => aggregateCandles(visibleSource, duration), [visibleSource, duration]);
  const recordedHigh = sourceCandles.reduce<number | null>((max, candle) => {
    const value = Number(candle.high);
    return Number.isFinite(value) && value > 0 ? Math.max(max ?? value, value) : max;
  }, null);
  const formatMoney = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0e1014" }, textColor: "#747f93", fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 10, attributionLogo: true },
      grid: { vertLines: { color: "#1b2027" }, horzLines: { color: "#1b2027" } },
      rightPriceScale: { borderColor: "#20242c", scaleMargins: { top: 0.13, bottom: 0.14 } },
      timeScale: { borderColor: "#20242c", timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 9 },
      crosshair: { vertLine: { color: "#747f93" }, horzLine: { color: "#747f93" } },
    });
    chart.current = instance;
    series.current = instance.addSeries(CandlestickSeries, {
      upColor: "#53bd8b", downColor: "#d96379", borderVisible: false,
      wickUpColor: "#53bd8b", wickDownColor: "#d96379",
      priceLineVisible: true, visible: false,
    });
    bars.current = instance.addSeries(BarSeries, {
      upColor: "#53bd8b", downColor: "#d96379", openVisible: true,
      priceLineVisible: true, visible: false,
    });
    area.current = instance.addSeries(AreaSeries, {
      lineColor: accentColor, topColor: `${accentColor}40`, bottomColor: `${accentColor}05`, lineWidth: 2,
      lastValueVisible: true, priceLineVisible: true,
    });
    return () => { instance.remove(); chart.current = null; series.current = null; bars.current = null; area.current = null; previous.current = []; previousRange.current = null; };
  }, [accentColor]);

  useEffect(() => {
    if (!series.current || !chart.current) return;
    const old = previous.current;
    const last = candles.at(-1);
    const incremental = previousRange.current === range && last && candles.length >= old.length && candles.length <= old.length + 1
      && old.slice(0, -1).every((bar, index) => sameCandle(bar, candles[index]!))
      && (old.length === 0 || (candles.length === old.length ? old.at(-1)!.time === last.time : sameCandle(old.at(-1)!, candles.at(-2)!)));

    if (incremental && last) series.current.update(last);
    else { series.current.setData(candles); if (candles.length) chart.current.timeScale().fitContent(); }
    bars.current?.setData(candles);
    area.current?.setData(candles.map((bar) => ({ time: bar.time, value: bar.close })));
    previous.current = candles;
    previousRange.current = range;
  }, [candles, range, accentColor]);

  useEffect(() => {
    series.current?.applyOptions({ visible: chartMode === "candles" });
    bars.current?.applyOptions({ visible: chartMode === "bars" });
    area.current?.applyOptions({ visible: chartMode === "area" });
  }, [chartMode, accentColor]);

  return <section className="trade-chart" aria-label="Market price chart">
    <div className="trade-chart__intro">
      <div className="trade-chart__top">
        <button type="button" className="trade-chart__pair" onClick={onMarkets} aria-label={`Change market, current pair ${marketLabel}`}>
          <span className="trade-chart__pair-icon">{marketIcon ? <img src={marketIcon} alt="" width="38" height="38" /> : <span aria-hidden="true">₿</span>}<i aria-hidden="true">T</i></span>
          <span>{marketLabel}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="trade-chart__controls">
          <div className="trade-chart__modes" role="group" aria-label="Chart style">
            <button type="button" aria-label="Price bars" title="Price bars" aria-pressed={chartMode === "bars"} className={chartMode === "bars" ? "is-active" : ""} onClick={() => setChartMode("bars")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19V9m7 10V4m7 15v-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg></button>
            <button type="button" aria-label="Candlesticks" title="Candlesticks" aria-pressed={chartMode === "candles"} className={chartMode === "candles" ? "is-active" : ""} onClick={() => setChartMode("candles")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3v18m10-18v18M4.5 9h5v7h-5zm10-3h5v9h-5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg></button>
            <button type="button" aria-label="Line chart" title="Line chart" aria-pressed={chartMode === "area"} className={chartMode === "area" ? "is-active" : ""} onClick={() => setChartMode("area")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 19V5m0 14h18M6 15l4-4 4 2 5-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <div className="trade-chart__periods" role="group" aria-label="Chart date range">{choices.map((choice) => <button key={choice.value} type="button" aria-pressed={range === choice.value} className={range === choice.value ? "is-active" : ""} onClick={() => setRange(choice.value)}>{choice.label}</button>)}</div>
        </div>
      </div>
      <div className="trade-chart__headline">
        <div className="trade-chart__quote"><span>LAST TRADED PRICE</span><strong>{lastPrice ? `$${lastPrice}` : "—"}</strong><div className="trade-chart__change"><span className={changePercent === null ? "" : changePercent >= 0 ? "is-positive" : "is-negative"}>{changePercent === null ? "—" : `${changePercent >= 0 ? "▲" : "▼"} ${Math.abs(changePercent).toFixed(2)}%`}</span><span>24H change</span></div></div>
        <div className="trade-chart__stats">
          <div><span>Market cap <i title="Market cap is not supplied by this exchange">ⓘ</i></span><strong>—</strong></div>
          <div><span>Circulating supply <i title="Circulating supply is not supplied by this exchange">ⓘ</i></span><strong>—</strong></div>
          <div><span>24H volume <i title="Based on recorded trades in the last 24 hours">ⓘ</i></span><strong>{formatMoney(volume)}</strong></div>
          <div><span>All-time high <i title="Highest price in the available candle history">ⓘ</i></span><strong>{formatMoney(recordedHigh)}</strong></div>
        </div>
      </div>
      <span className={`trade-live-pill ${connected ? "" : "is-offline"}`}><i /> {connected ? "Live trades" : "Awaiting feed"}</span>
    </div>
    <div className="trade-chart__plot">
      <div ref={container} className="trade-chart__canvas" />
      {!candles.length && illustrative && <div className="trade-chart__preview" aria-label="Illustrative chart preview, not live market data"><svg viewBox="0 0 900 250" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="trade-preview-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={accentColor} stopOpacity=".25"/><stop offset=".55" stopColor={accentColor} stopOpacity=".09"/><stop offset="1" stopColor={accentColor} stopOpacity="0"/></linearGradient></defs><path d="M0 194 28 182 48 165 63 175 86 151 105 159 125 150 148 168 167 139 190 146 215 129 236 141 254 121 278 127 298 109 317 157 339 145 358 151 385 134 407 143 431 112 454 82 472 111 495 72 515 43 539 91 559 100 581 84 603 122 627 108 646 133 670 127 690 149 713 138 738 153 757 145 780 164 798 157 825 166 844 152 866 160 900 155 900 250 0 250Z" fill="url(#trade-preview-fill)"/><path d="M0 194 28 182 48 165 63 175 86 151 105 159 125 150 148 168 167 139 190 146 215 129 236 141 254 121 278 127 298 109 317 157 339 145 358 151 385 134 407 143 431 112 454 82 472 111 495 72 515 43 539 91 559 100 581 84 603 122 627 108 646 133 670 127 690 149 713 138 738 153 757 145 780 164 798 157 825 166 844 152 866 160 900 155" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></svg><span>ILLUSTRATIVE PREVIEW · LIVE CANDLES APPEAR WHEN TRADES MATCH</span></div>}
      {!candles.length && !illustrative && <div className="trade-chart__empty"><span className="trade-chart__empty-icon">⌁</span><strong>{loading ? "Loading trade history" : "No trades yet"}</strong><span>{error || "Candles appear when orders match in this market."}</span></div>}
    </div>
    <div className="trade-chart__footer"><span>Trade price · {choices.find((choice) => choice.value === range)?.label} view</span><span>{candles.length} candle{candles.length === 1 ? "" : "s"}</span></div>
  </section>;
}
