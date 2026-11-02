import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, LineSeries, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { aggregateCandles, candleDuration, type CandleInterval, type StoredCandle } from "./marketData";

const choices: { value: CandleInterval; label: string }[] = [
  { value: "all", label: "All" },
  { value: "3m", label: "3m" },
  { value: "1m", label: "1m" },
  { value: "1h", label: "1h" },
  { value: "1d", label: "1d" },
];

function sameCandle(a: CandlestickData<UTCTimestamp>, b: CandlestickData<UTCTimestamp>) {
  return a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
}

export function MarketCandlestickChart({ sourceCandles, connected, loading, error }: { sourceCandles: StoredCandle[]; connected: boolean; loading: boolean; error: string }) {
  const [interval, setInterval] = useState<CandleInterval>("all");
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const flatLine = useRef<ISeriesApi<"Line"> | null>(null);
  const previous = useRef<CandlestickData<UTCTimestamp>[]>([]);
  const previousInterval = useRef<CandleInterval | null>(null);
  const duration = candleDuration(sourceCandles, interval);
  const candles = useMemo(() => aggregateCandles(sourceCandles, duration), [sourceCandles, duration]);

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#111419" }, textColor: "#81909f", fontFamily: "Inter, ui-sans-serif, sans-serif", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: "#20262d" }, horzLines: { color: "#20262d" } },
      rightPriceScale: { borderColor: "#2a333a", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#2a333a", timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 9 },
      crosshair: { vertLine: { color: "#526359" }, horzLine: { color: "#526359" } },
    });
    chart.current = instance;
    series.current = instance.addSeries(CandlestickSeries, {
      upColor: "#59c987", downColor: "#e4717c", borderVisible: false,
      wickUpColor: "#76d9a0", wickDownColor: "#ee8b94",
      priceLineVisible: true,
    });
    flatLine.current = instance.addSeries(LineSeries, {
      color: "#77d9a0", lineWidth: 2, pointMarkersVisible: true, pointMarkersRadius: 3,
      lastValueVisible: false, priceLineVisible: false,
    });
    return () => { instance.remove(); chart.current = null; series.current = null; flatLine.current = null; previous.current = []; previousInterval.current = null; };
  }, []);

  useEffect(() => {
    if (!series.current || !chart.current) return;
    const old = previous.current;
    const last = candles.at(-1);
    const incremental = previousInterval.current === interval && last && candles.length >= old.length && candles.length <= old.length + 1
      && old.slice(0, -1).every((bar, index) => sameCandle(bar, candles[index]!))
      && (old.length === 0 || (candles.length === old.length ? old.at(-1)!.time === last.time : sameCandle(old.at(-1)!, candles.at(-2)!)));

    if (incremental && last) series.current.update(last);
    else { series.current.setData(candles); if (candles.length) chart.current.timeScale().fitContent(); }
    const flat = candles.length > 0 && candles.every((bar) => bar.open === bar.high && bar.open === bar.low && bar.open === bar.close && bar.open === candles[0]!.open);
    flatLine.current?.setData(flat ? candles.map((bar) => ({ time: bar.time, value: bar.close })) : []);
    previous.current = candles;
    previousInterval.current = interval;
  }, [candles, interval]);

  return <section className="trade-chart" aria-label="Market candlestick chart">
    <div className="trade-chart__toolbar">
      <div className="trade-chart__periods" role="group" aria-label="Candle interval">
        {choices.map((choice) => <button key={choice.value} type="button" aria-pressed={interval === choice.value} className={interval === choice.value ? "is-active" : ""} onClick={() => setInterval(choice.value)}>{choice.label}</button>)}
      </div>
      <span className={`trade-live-pill ${connected ? "" : "is-offline"}`}><i /> {connected ? "Live trades" : "Awaiting feed"}</span>
    </div>
    <div className="trade-chart__plot">
      <div ref={container} className="trade-chart__canvas" />
      {!candles.length && <div className="trade-chart__empty"><span className="trade-chart__empty-icon">⌁</span><strong>{loading ? "Loading trade history" : "No trades yet"}</strong><span>{error || "Candles appear when orders match in this market."}</span></div>}
    </div>
    <div className="trade-chart__footer"><span>Trade price · {interval === "all" ? "All history" : `${interval} candles`}</span><span>{candles.length} candle{candles.length === 1 ? "" : "s"}</span></div>
  </section>;
}
