import { divideRounded, formatFixed } from "./math/fixed-point";
import {
  ENGINE_CONSTANTS,
  FIXED_POINT_CONSTANTS,
  FUNDING_CONSTANTS,
  MARKET_DATA_CONSTANTS,
  REDIS_CONSTANTS,
} from "./constants";
import {
  PositionState,
  type Position,
  type EngineSnapshot,
  type Fill,
  type SnapshotMarket,
  type CandleDraft,
  type CommandOf,
  type DBEventDraft,
  type EngineCommand,
  type EngineCommandResult,
  type FundingState,
  type MarketDefinition,
  type MarketContext,
  type MarketRiskConfig,
  type WSEventDraft,
} from "./types";
import { engine_response, generate_liquidation_order_id, max } from "./utils";
import { EngineSnapshotSchema } from "./zod/z";
import Orderbook from "./orderbook";
import AccountStore from "./accounts";
import {
  calculateFee,
  calculateInitialMargin,
  calculateNotional,
} from "./math/financial-math";
import type { EngineResponse } from "commons/src/index";
import type { DBEventInput } from "commons/src/engine-event";
import {
  OrderSide,
  OrderStatus,
  OrderType,
  PositionType,
} from "commons/src/order.type";
import { calcAvgPrice, calcUnrealisedPnL } from "./perp";
import MARKET_CONFIG from "./config/market.config";
import InsuranceFund from "./insurance-fund";
import TradingFeeAccount from "./trading-fee-account";
import {
  calculateLiquidationFill,
  calculateLiquidationPrice,
  calculatePositionRisk,
} from "./liquidation";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import RUNTIME_CONFIG from "./config/runtime.config";
import { randomUUID } from "node:crypto";
import {
  calculateFundingPayments,
  clampFundingRate,
  fundingIntervalEnd,
  samplePremium,
} from "./funding";

class Engine {
  private markets = new Map<string, MarketContext>();
  private accounts = new AccountStore([]);
  private liquidationQueue = new Map<
    string,
    { user_id: string; market_id: string }
  >(); //pending liquidations in this market
  private processingLiquidations = false; //flags true everytime there is a pending liquidation
  private readonly MAX_MARK_PRICE_AGE_MS;
  private readonly MAX_MARK_PRICE_CLOCK_SKEW_MS;
  private MAINTENANCE_MARGIN_RATE: bigint;
  private readonly LIQUIDATION_FEE_RATE: bigint;
  private readonly MAKER_FEE_RATE: bigint;
  private readonly TAKER_FEE_RATE: bigint;
  private insuranceFund!: InsuranceFund;
  private tradingFeeAccount!: TradingFeeAccount;
  private lastAppliedStreamId: string = REDIS_CONSTANTS.INITIAL_STREAM_ID;
  private replayTimestamp: number | null = null;
  private currentSourceMessageId: string | null = null;
  private awaitingEventPublication = false; //block snapshot if pending publication to ws or db
  private snapshotTimer?: ReturnType<typeof setInterval>;
  private commandEvents: {
    db: DBEventDraft[];
    ws: WSEventDraft[];
    changedBooks: Set<string>; //set of markets which had a change in their orderbooks
    changedTickers: Set<string>; //set of markets which had a change in their tickerdata
    candles: Map<string, CandleDraft>;
    timestampMs: number;
    liquidationOrderSequence: number;
  } | null = null;

  private constructor(markets: MarketDefinition[]) {
    let restoredSnapshot: EngineSnapshot | undefined;
    const quotes = new Map(
      markets.map(({ market_id, slug }) => [
        market_id,
        slug.split("-").at(-1) ?? "",
      ])
    );
    this.MAX_MARK_PRICE_AGE_MS = MARKET_CONFIG.MAX_MARK_PRICE_AGE_MS;
    this.MAX_MARK_PRICE_CLOCK_SKEW_MS =
      MARKET_CONFIG.MAX_MARK_PRICE_CLOCK_SKEW_MS;
    this.MAINTENANCE_MARGIN_RATE = MARKET_CONFIG.MAINTENANCE_MARGIN_RATE;
    this.LIQUIDATION_FEE_RATE = MARKET_CONFIG.LIQUIDATION_FEE_RATE;
    this.MAKER_FEE_RATE = MARKET_CONFIG.MAKER_FEE_RATE;
    this.TAKER_FEE_RATE = MARKET_CONFIG.TAKER_FEE_RATE;

    if (existsSync(RUNTIME_CONFIG.snapshotPath)) {
      const parsedSnapshot = EngineSnapshotSchema.safeParse(
        JSON.parse(readFileSync(RUNTIME_CONFIG.snapshotPath, "utf8"))
      );
      if (!parsedSnapshot.success) {
        const details = parsedSnapshot.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        throw new Error(`Cannot restore invalid engine snapshot: ${details}`);
      }
      const snapshot: EngineSnapshot = parsedSnapshot.data;
      restoredSnapshot = snapshot;
      this.insuranceFund = new InsuranceFund(
        MARKET_CONFIG.COLLATERAL_ASSET,
        MARKET_CONFIG.INSURANCE_FUND_INITIAL_BALANCE,
        snapshot.insurance_fund
      );
      this.tradingFeeAccount = new TradingFeeAccount(
        MARKET_CONFIG.COLLATERAL_ASSET,
        snapshot.trading_fee_account
      );
      this.lastAppliedStreamId = snapshot.last_applied_stream_id;

      this.accounts = new AccountStore(snapshot.accounts);

      snapshot.markets.forEach((market_data) => {
        const funding = market_data.funding;
        const saved = market_data.risk_config;
        this.markets.set(market_data.market_id, {
          book: new Orderbook(market_data, this.MAKER_FEE_RATE),
          quote: quotes.get(market_data.market_id) ?? "",
          risk: this.validateRiskConfig({
            maintenanceMarginRate: saved
              ? BigInt(saved.maintenance_margin_rate)
              : this.MAINTENANCE_MARGIN_RATE,
            liquidationFeeRate: saved
              ? BigInt(saved.liquidation_fee_rate)
              : this.LIQUIDATION_FEE_RATE,
            maxLeverage: saved?.max_leverage
              ? BigInt(saved.max_leverage)
              : null,
            maxLiquidationQuantity: saved?.max_liquidation_quantity
              ? BigInt(saved.max_liquidation_quantity)
              : null,
          }),
          funding: funding
            ? {
                lastSettledIntervalMs: funding.last_settled_interval_ms,
                fixedRate:
                  funding.fixed_rate === null
                    ? null
                    : BigInt(funding.fixed_rate),
                premiumSum: BigInt(funding.premium_sum),
                premiumSamples: funding.premium_samples,
                premiumIntervalMs: funding.premium_interval_ms,
                lastRate: BigInt(funding.last_rate),
              }
            : this.emptyFundingState(),
          positionUserIds: new Set(),
          halted: (snapshot.halted_markets ?? []).includes(
            market_data.market_id
          ),
        });
        market_data.orders.forEach((order) => {
          const account = this.accounts.get(order.user_id);
          if (!account) {
            throw new Error(`Snapshot order ${order.order_id} has no account`);
          }
          account.orders.add(order.order_id);
          if (snapshot.version < 4) {
            this.accounts.reserveMargin(
              order.user_id,
              calculateFee(
                calculateNotional(
                  BigInt(order.price),
                  BigInt(order.quantity) - BigInt(order.filled)
                ),
                this.MAKER_FEE_RATE
              )
            );
          }
        });
      });
    }

    if (!this.insuranceFund) {
      this.insuranceFund = new InsuranceFund(
        MARKET_CONFIG.COLLATERAL_ASSET,
        MARKET_CONFIG.INSURANCE_FUND_INITIAL_BALANCE
      );
    }
    if (!this.tradingFeeAccount) {
      this.tradingFeeAccount = new TradingFeeAccount(
        MARKET_CONFIG.COLLATERAL_ASSET
      );
    }

    for (const market of markets) {
      const { market_id } = market;
      const existing = this.markets.get(market_id);
      if (existing) {
        existing.quote = quotes.get(market_id) ?? "";
        continue;
      }
      // Risk changes are replayed from the engine stream. DB values are a
      // projection and may be ahead of the snapshot cursor on recovery.
      this.markets.set(
        market_id,
        this.createMarketContext(market_id, quotes.get(market_id) ?? "")
      );
    }

    for (const market_id of restoredSnapshot?.halted_markets ?? []) {
      const context = this.markets.get(market_id);
      if (context) context.halted = true;
    }

    restoredSnapshot?.mark_prices.forEach((mark) => {
      const context = this.markets.get(mark.market_id);
      if (!context)
        throw new Error(
          `Snapshot mark price has unknown market ${mark.market_id}`
        );
      context.markPrice = BigInt(mark.price);
      context.markPriceMetadata = {
        producer_id: mark.producer_id,
        source_timestamp: mark.source_timestamp,
        sequence: BigInt(mark.sequence),
      };
    });
    restoredSnapshot?.accounts.forEach((account) => {
      account.positions.forEach((position) => {
        const context = this.markets.get(position.market_id);
        if (!context)
          throw new Error(
            `Snapshot position has unknown market ${position.market_id}`
          );
        context.positionUserIds.add(account.user_id);
      });
    });

    if (this.markets.size === 0) {
      throw new Error("No markets available to initialize the engine");
    }
    this.captureSnapshot();
  }

  static create = async (): Promise<Engine> => {
    const { MarketRepo } = await import("db/repositories/market.repo");
    const markets = await MarketRepo.listMarkets();
    return new Engine(markets);
  };

  private validateRiskConfig = (config: MarketRiskConfig): MarketRiskConfig => {
    if (
      config.maintenanceMarginRate < 0n ||
      config.liquidationFeeRate < 0n ||
      config.maintenanceMarginRate + config.liquidationFeeRate >=
        FIXED_POINT_CONSTANTS.SCALE ||
      (config.maxLeverage !== null && config.maxLeverage <= 0n) ||
      (config.maxLiquidationQuantity !== null &&
        config.maxLiquidationQuantity <= 0n)
    ) {
      throw new Error("Invalid market risk configuration");
    }
    return config;
  };

  private emptyFundingState = (): FundingState => {
    return {
      lastSettledIntervalMs: 0,
      fixedRate: null,
      premiumSum: 0n,
      premiumSamples: 0,
      premiumIntervalMs: 0,
      lastRate: 0n,
    };
  };

  private createMarketContext = (
    market_id: string,
    quote: string
  ): MarketContext => ({
    book: new Orderbook(
      {
        market_id,
        last_traded_price: "0",
        last_trade_id: "",
        orders: [],
      },
      this.MAKER_FEE_RATE
    ),
    quote,
    risk: this.validateRiskConfig({
      maintenanceMarginRate: this.MAINTENANCE_MARGIN_RATE,
      liquidationFeeRate: this.LIQUIDATION_FEE_RATE,
      maxLeverage: null,
      maxLiquidationQuantity: null,
    }),
    funding: this.emptyFundingState(),
    positionUserIds: new Set(),
    halted: false,
  });

  private riskConfig = (market_id: string): MarketRiskConfig => {
    return (
      this.markets.get(market_id)?.risk ?? {
        maintenanceMarginRate: this.MAINTENANCE_MARGIN_RATE,
        liquidationFeeRate: this.LIQUIDATION_FEE_RATE ?? 0n,
        maxLeverage: null,
        maxLiquidationQuantity: null,
      }
    );
  };

  getLastAppliedStreamId = (): string => {
    return this.lastAppliedStreamId;
  };

  //check for active liquidation in all markets
  hasActiveLiquidations = (): boolean => {
    for (const market of this.markets.values()) {
      for (const userId of market.positionUserIds) {
        const positions = this.accounts.get(userId)?.positions;
        if (
          [...(positions?.values() ?? [])].some(
            (position) => position.state === PositionState.LIQUIDATING
          )
        )
          return true;
      }
    }
    return false;
  };

  recordAppliedStreamId = (streamId: string): void => {
    this.lastAppliedStreamId = streamId;
    this.awaitingEventPublication = false;
  };

  captureSnapshot = () => {
    this.snapshotTimer = setInterval(() => {
      if (this.awaitingEventPublication) return;

      const snapshot: EngineSnapshot = {
        version: ENGINE_CONSTANTS.SNAPSHOT_VERSION,
        snapshot_time: Date.now(),
        scale: Number(FIXED_POINT_CONSTANTS.SCALE),
        last_applied_stream_id: this.lastAppliedStreamId,
        markets: [],
        accounts: this.accounts.snapshotAccount(),
        mark_prices: [...this.markets.entries()].flatMap(
          ([market_id, market]) => {
            const metadata = market.markPriceMetadata;
            if (!metadata) return [];
            if (market.markPrice === undefined) {
              throw new Error(`Missing mark price for market ${market_id}`);
            }
            return [
              {
                market_id,
                price: String(market.markPrice),
                producer_id: metadata.producer_id,
                source_timestamp: metadata.source_timestamp,
                sequence: String(metadata.sequence),
              },
            ];
          }
        ),
        insurance_fund: this.insuranceFund.snapshot(),
        trading_fee_account: this.tradingFeeAccount.snapshot(),
        halted_markets: [...this.markets.entries()]
          .filter(([, market]) => market.halted)
          .map(([market_id]) => market_id),
      };

      this.markets.forEach((market, market_id) => {
        const orderbook = market.book;
        const { last_traded_price, last_trade_id } =
          orderbook.fetchMarketData();

        const market_data: SnapshotMarket = {
          market_id,
          last_traded_price: String(last_traded_price),
          last_trade_id: String(last_trade_id),
          orders: orderbook.snapshotOrderbook(),
          funding: (() => {
            const state = market.funding;
            return {
              last_settled_interval_ms: state.lastSettledIntervalMs,
              fixed_rate:
                state.fixedRate === null ? null : String(state.fixedRate),
              premium_sum: String(state.premiumSum),
              premium_samples: state.premiumSamples,
              premium_interval_ms: state.premiumIntervalMs,
              last_rate: String(state.lastRate),
            };
          })(),
          risk_config: (() => {
            const risk = this.riskConfig(market_id);
            return {
              maintenance_margin_rate: String(risk.maintenanceMarginRate),
              liquidation_fee_rate: String(risk.liquidationFeeRate),
              max_leverage:
                risk.maxLeverage === null ? null : String(risk.maxLeverage),
              max_liquidation_quantity:
                risk.maxLiquidationQuantity === null
                  ? null
                  : String(risk.maxLiquidationQuantity),
            };
          })(),
        };

        snapshot.markets.push(market_data);
      });

      const temporaryPath = `${RUNTIME_CONFIG.snapshotPath}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(snapshot));
      renameSync(temporaryPath, RUNTIME_CONFIG.snapshotPath);
    }, ENGINE_CONSTANTS.SNAPSHOT_INTERVAL_MS);
  };

  stopSnapshot = () => {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = undefined;
  };

  processEngineOrder = (
    request: EngineCommand,
    replayTimestamp?: number
  ): EngineResponse => {
    this.replayTimestamp = replayTimestamp ?? null;
    try {
      switch (request.action) {
        case "ONRAMP":
          return this.onramp(request);
        case "GET_BALANCE":
          return this.getBalance(request);
        case "PLACE_ORDER":
          return this.placeOrder(request);
        case "CANCEL_ORDER":
          return this.cancelOrder(request);
        case "GET_DEPTH":
          return this.getDepth(request);
        case "GET_POSITION":
          return this.getPosition(request);
        case "REGISTER_MARKET":
          return this.registerMarket(request);
        case "MARK_PRICE_UPDATE":
          return this.markPriceUpdate(request);
        case "RETRY_LIQUIDATIONS":
          for (const marketId of this.markets.keys()) {
            const metadata = this.markets.get(marketId)?.markPriceMetadata;
            if (
              !metadata ||
              (this.replayTimestamp ?? Date.now()) - metadata.source_timestamp >
                this.MAX_MARK_PRICE_AGE_MS
            )
              continue;
            this.retryActiveLiquidations(marketId);
          }
          return engine_response("Liquidation retries processed", 1);
        case "SET_MARKET_RISK":
          return this.setMarketRisk(request);
        case "GET_FUNDING_RATE":
          return this.getFundingRate(request);
        case "SET_FUNDING_RATE":
          return this.setFundingRate(request);
        case "SETTLE_FUNDING":
          return this.settleFunding(request);
        default:
          return engine_response("Unrecognised engine request action", 0);
      }
    } catch (error) {
      console.log(error);
      const err = error instanceof Error ? error : new Error(String(error));
      return engine_response(err.message, 0);
    } finally {
      this.replayTimestamp = null;
    }
  };

  processEngineCommand = (
    request: EngineCommand,
    replayTimestamp?: number,
    sourceMessageId?: string
  ): EngineCommandResult => {
    this.liquidationQueue ??= new Map();
    this.processingLiquidations ??= false;
    const sourceTimestamp = sourceMessageId
      ? Number(sourceMessageId.split("-")[0])
      : undefined;
    const timestampMs = sourceTimestamp ?? replayTimestamp ?? Date.now();

    //group of events that occur in engine which are pushed to different services
    const events = {
      db: [] as DBEventDraft[],
      ws: [] as WSEventDraft[],
      changedBooks: new Set<string>(), //market_id for those who had a trade compelted
      changedTickers: new Set<string>(), //market_id for those who had a trade compelted
      candles: new Map<string, CandleDraft>(),
      timestampMs,
      liquidationOrderSequence: 0,
    };
    this.commandEvents = events;
    this.currentSourceMessageId = sourceMessageId ?? randomUUID();

    try {
      const response = this.processEngineOrder(request, replayTimestamp);
      for (const market_id of events.changedBooks) {
        const orderbook = this.markets.get(market_id)?.book;
        if (!orderbook) continue;
        this.emitWsEvent({
          event_type: "BOOK",
          data: { market_id, ...orderbook.getDepth() },
        });
      }
      for (const market_id of events.changedTickers) {
        const orderbook = this.markets.get(market_id)?.book;
        if (!orderbook) continue;
        const { last_trade_id, last_traded_price } =
          orderbook.fetchMarketData();
        const mark_price = this.markets.get(market_id)?.markPrice;
        this.emitWsEvent({
          event_type: "TICKER",
          data: {
            market_id,
            ...(mark_price !== undefined && {
              mark_price: formatFixed(mark_price),
            }),
            ...(last_trade_id && {
              last_trade_id,
              last_traded_price: formatFixed(last_traded_price),
            }),
            ...(this.markets.get(market_id)?.halted && {
              trading_halted: true,
            }),
            ...orderbook.getBestPrices(),
          },
        });
      }
      if (events.candles.size) {
        const lastDbEvent = events.db.at(-1);
        if (!lastDbEvent) throw new Error("Trade has no database event");
        lastDbEvent.changes.candles = [...events.candles.values()];
      }
      // Project all changes from one command together: orders must exist before fills.
      const dbEvents: DBEventDraft[] =
        events.db.length > 1
          ? [
              {
                event_type: events.db[events.db.length - 1]!.event_type,
                changes: {
                  balances: events.db.flatMap(
                    (event) => event.changes.balances ?? []
                  ),
                  orders: events.db.flatMap(
                    (event) => event.changes.orders ?? []
                  ),
                  order_updates: events.db.flatMap(
                    (event) => event.changes.order_updates ?? []
                  ),
                  fills: events.db.flatMap(
                    (event) => event.changes.fills ?? []
                  ),
                  positions: events.db.flatMap(
                    (event) => event.changes.positions ?? []
                  ),
                  market_data: events.db.flatMap(
                    (event) => event.changes.market_data ?? []
                  ),
                  candles: events.db.flatMap(
                    (event) => event.changes.candles ?? []
                  ),
                  insurance_fund: events.db.flatMap(
                    (event) => event.changes.insurance_fund ?? []
                  ),
                  trading_fee_account: events.db.flatMap(
                    (event) => event.changes.trading_fee_account ?? []
                  ),
                  liquidation_attempts: events.db.flatMap(
                    (event) => event.changes.liquidation_attempts ?? []
                  ),
                  funding_intervals: events.db.flatMap(
                    (event) => event.changes.funding_intervals ?? []
                  ),
                  funding_payments: events.db.flatMap(
                    (event) => event.changes.funding_payments ?? []
                  ),
                },
              },
            ]
          : events.db;
      this.awaitingEventPublication =
        dbEvents.length > 0 || events.ws.length > 0;
      return { response, dbEvents, wsEvents: events.ws };
    } finally {
      this.commandEvents = null;
      this.currentSourceMessageId = null;
    }
  };

  private emitDbEvent = (event: DBEventDraft): void => {
    this.commandEvents?.db.push(event);
  };

  private emitWsEvent = (event: WSEventDraft): void => {
    this.commandEvents?.ws.push(event);
  };

  private markBookChanged = (market_id: string): void => {
    this.commandEvents?.changedBooks.add(market_id);
    this.commandEvents?.changedTickers.add(market_id);
  };

  private emitTrades = (
    market_id: string,
    taker_side: OrderSide,
    fills: Fill[]
  ): void => {
    for (const fill of fills) {
      const events = this.commandEvents;
      if (events) {
        const start_ms =
          Math.floor(
            events.timestampMs / MARKET_DATA_CONSTANTS.CANDLE_INTERVAL_MS
          ) * MARKET_DATA_CONSTANTS.CANDLE_INTERVAL_MS;
        const key = `${market_id}:${start_ms}`;
        const candle = events.candles.get(key);
        const quoteVolume = calculateNotional(fill.price, fill.filled);
        if (candle) {
          candle.high = candle.high > fill.price ? candle.high : fill.price;
          candle.low = candle.low < fill.price ? candle.low : fill.price;
          candle.close = fill.price;
          candle.base_volume += fill.filled;
          candle.quote_volume += quoteVolume;
          candle.trade_count += 1;
        } else {
          events.candles.set(key, {
            market_id,
            start_ms,
            open: fill.price,
            high: fill.price,
            low: fill.price,
            close: fill.price,
            base_volume: fill.filled,
            quote_volume: quoteVolume,
            trade_count: 1,
          });
        }
      }
      this.emitWsEvent({
        event_type: "TRADE",
        data: {
          market_id,
          trade_id: fill.trade_id,
          price: formatFixed(fill.price),
          quantity: formatFixed(fill.filled),
          taker_side,
        },
      });
    }
  };

  private onramp = (request: CommandOf<"ONRAMP">): EngineResponse => {
    if (request.amount <= 0n) {
      return engine_response("Cannot ramp negative value", 0);
    }

    this.accounts.credit(request.user_id, request.amount);
    const account = this.accounts.getOrCreate(request.user_id);
    this.emitDbEvent({
      event_type: "BALANCE_CHANGE",
      changes: {
        balances: [
          {
            user_id: request.user_id,
            available: account.collateral.available.toString(),
            reserved: account.collateral.reserved.toString(),
          },
        ],
        orders: [],
        fills: [],
        positions: [],
        market_data: [],
      },
    });
    return engine_response("Onramp successfull", 1);
  };

  private getBalance = (request: CommandOf<"GET_BALANCE">): EngineResponse => {
    const account = this.accounts.get(request.user_id);
    if (!account) {
      return engine_response("Balance Retrieved", 1, {
        available: "0",
        reserved: "0",
      });
    }

    return engine_response("Balance Retrieved", 1, {
      available: formatFixed(account.collateral.available),
      reserved: formatFixed(account.collateral.reserved),
    });
  };

  private settleFilledOrderMargin = (
    user_id: string,
    order_margin_consumed: bigint,
    position_margin_added: bigint
  ): void => {
    if (position_margin_added > order_margin_consumed) {
      this.accounts.reserveMargin(
        user_id,
        position_margin_added - order_margin_consumed
      );
    } else if (order_margin_consumed > position_margin_added) {
      this.accounts.releaseMargin(
        user_id,
        order_margin_consumed - position_margin_added
      );
    }
  };

  private realizeClosedFunding = (
    user_id: string,
    position: Position,
    closedQuantity: bigint
  ): void => {
    if (position.funding_accrued === 0n) return;
    const amount =
      closedQuantity === position.quantity
        ? position.funding_accrued
        : divideRounded(
            position.funding_accrued * closedQuantity,
            position.quantity,
            "toward-zero"
          );
    position.funding_accrued -= amount;
    this.accounts.credit(user_id, amount);
  };

  private setMarketRisk = (
    request: CommandOf<"SET_MARKET_RISK">
  ): EngineResponse => {
    if (!this.markets.has(request.market_id)) {
      throw new Error("Incorrect Market ID");
    }
    const config = this.validateRiskConfig({
      maintenanceMarginRate: request.maintenance_margin_rate,
      liquidationFeeRate: request.liquidation_fee_rate,
      maxLeverage: request.max_leverage,
      maxLiquidationQuantity: request.max_liquidation_quantity,
    });
    this.markets.get(request.market_id)!.risk = config;
    this.emitDbEvent({
      event_type: "MARKET_RISK_UPDATE",
      changes: {
        market_data: [
          {
            market_id: request.market_id,
            maintenance_margin_rate: config.maintenanceMarginRate,
            liquidation_fee_rate: config.liquidationFeeRate,
            max_leverage: config.maxLeverage,
            max_liquidation_quantity: config.maxLiquidationQuantity,
          },
        ],
      },
    });
    // A stricter maintenance setting can make existing positions liquidatable.
    const markMetadata = this.markets.get(request.market_id)?.markPriceMetadata;
    if (
      markMetadata &&
      this.markets.get(request.market_id)?.markPrice !== undefined &&
      (this.replayTimestamp ?? Date.now()) - markMetadata.source_timestamp <=
        this.MAX_MARK_PRICE_AGE_MS
    ) {
      for (const user_id of this.markets.get(request.market_id)
        ?.positionUserIds ?? []) {
        this.liquidationCheck({ user_id, market_id: request.market_id });
      }
    }
    return engine_response("Market risk configuration updated", 1);
  };

  private registerMarket = (
    request: CommandOf<"REGISTER_MARKET">
  ): EngineResponse => {
    const { market_id, slug } = request;
    const quote = slug.split("-")[1]!;
    if (this.markets.has(market_id)) {
      if (this.markets.get(market_id)?.quote !== quote) {
        return engine_response(
          "Market ID already exists with a different quote",
          0
        );
      }
      return engine_response("Market already registered", 1, { market_id });
    }
    this.markets.set(market_id, this.createMarketContext(market_id, quote));
    return engine_response("Market registered", 1, { market_id });
  };

  private estimatedFundingRate = (state: FundingState): bigint => {
    if (state.fixedRate !== null) return state.fixedRate;
    if (state.premiumSamples < FUNDING_CONSTANTS.MIN_SAMPLES) return 0n;
    return clampFundingRate(
      divideRounded(
        state.premiumSum,
        BigInt(state.premiumSamples),
        "toward-zero"
      )
    );
  };

  private fundingResponse = (market_id: string) => {
    const state = this.markets.get(market_id)!.funding;
    const now = this.replayTimestamp ?? Date.now();
    return {
      market_id,
      rate: formatFixed(this.estimatedFundingRate(state)),
      mode: state.fixedRate === null ? "PREMIUM" : "FIXED",
      ready:
        state.fixedRate !== null ||
        state.premiumSamples >= FUNDING_CONSTANTS.MIN_SAMPLES,
      last_rate: formatFixed(state.lastRate),
      last_settled_ms: state.lastSettledIntervalMs,
      next_funding_ms: fundingIntervalEnd(now),
      sample_count: state.premiumSamples,
      minimum_samples: FUNDING_CONSTANTS.MIN_SAMPLES,
    };
  };

  private getFundingRate = (
    request: CommandOf<"GET_FUNDING_RATE">
  ): EngineResponse => {
    if (!this.markets.has(request.market_id))
      return engine_response("Incorrect Market ID", 0);
    return engine_response(
      "Funding state retrieved",
      1,
      this.fundingResponse(request.market_id)
    );
  };

  private setFundingRate = (
    request: CommandOf<"SET_FUNDING_RATE">
  ): EngineResponse => {
    const state = this.markets.get(request.market_id)?.funding;
    if (!state) return engine_response("Incorrect Market ID", 0);
    if (
      request.funding_rate !== null &&
      clampFundingRate(request.funding_rate) !== request.funding_rate
    ) {
      return engine_response("Funding rate exceeds the market cap", 0);
    }
    state.fixedRate = request.funding_rate;
    this.emitDbEvent({
      event_type: "FUNDING_CONFIG_UPDATE",
      changes: {
        market_data: [
          { market_id: request.market_id, funding_fixed_rate: state.fixedRate },
        ],
      },
    });
    this.emitFundingState(request.market_id);
    return engine_response(
      "Funding configuration updated",
      1,
      this.fundingResponse(request.market_id)
    );
  };

  private emitFundingState = (market_id: string): void => {
    const state = this.markets.get(market_id)!.funding;
    this.emitWsEvent({
      event_type: "FUNDING",
      data: {
        market_id,
        rate: formatFixed(this.estimatedFundingRate(state)),
        ready:
          state.fixedRate !== null ||
          state.premiumSamples >= FUNDING_CONSTANTS.MIN_SAMPLES,
        next_funding_ms: fundingIntervalEnd(
          this.commandEvents?.timestampMs ?? Date.now()
        ),
        last_settled_ms: state.lastSettledIntervalMs,
        sample_count: state.premiumSamples,
      },
    });
  };

  private settleFunding = (
    request: CommandOf<"SETTLE_FUNDING">
  ): EngineResponse => {
    const { market_id, interval_end_ms } = request;
    const state = this.markets.get(market_id)?.funding;
    if (!state) return engine_response("Incorrect Market ID", 0);
    if (this.markets.get(market_id)?.quote !== MARKET_CONFIG.COLLATERAL_ASSET) {
      return engine_response("Funding requires a collateral-quoted market", 0);
    }
    const now =
      this.commandEvents?.timestampMs ?? this.replayTimestamp ?? Date.now();
    if (
      interval_end_ms % FUNDING_CONSTANTS.INTERVAL_MS !== 0 ||
      interval_end_ms > now
    ) {
      return engine_response("Invalid funding interval", 0);
    }
    if (interval_end_ms <= state.lastSettledIntervalMs) {
      return engine_response(
        "Funding interval already settled",
        1,
        this.fundingResponse(market_id)
      );
    }
    const late =
      now - interval_end_ms > FUNDING_CONSTANTS.SETTLEMENT_LATE_THRESHOLD_MS;
    // The current mark feed is a two-venue spot index. Keep this name explicit
    // here so a future perp mark can diverge without changing funding notional.
    const indexPrice = late ? 0n : this.requireFreshMarkPrice(market_id);
    const sampleCount =
      state.premiumIntervalMs === interval_end_ms ? state.premiumSamples : 0;
    const skipped =
      late ||
      (state.fixedRate === null && sampleCount < FUNDING_CONSTANTS.MIN_SAMPLES);
    const rate = skipped ? 0n : this.estimatedFundingRate(state);
    const participants = [
      ...(this.markets.get(market_id)?.positionUserIds ?? []),
    ]
      .map((userId) => {
        const account = this.accounts.get(userId)!;
        const position = account.positions.get(market_id)!;
        return { userId, account, position };
      })
      .filter(({ position }) => position.quantity > 0n);
    const batch = calculateFundingPayments(
      participants,
      indexPrice,
      rate,
      this.insuranceFund.available()
    );
    const { payments } = batch;
    const insuranceChanges = payments
      .filter((payment) => payment.insuranceCovered > 0n)
      .map((payment) =>
        this.insuranceFund.coverFundingShortfall(
          payment.insuranceCovered,
          market_id,
          payment.userId,
          interval_end_ms
        )
      );
    for (const payment of payments) {
      const account = this.accounts.get(payment.userId)!;
      account.collateral.available +=
        payment.amount < 0n ? -payment.availableDebit : payment.amount;
      if (payment.marginDebit) {
        account.collateral.reserved -= payment.marginDebit;
        account.positions.get(market_id)!.reserved_margin -=
          payment.marginDebit;
      }
    }
    state.lastSettledIntervalMs = interval_end_ms;
    state.lastRate = rate;
    state.premiumSum = 0n;
    state.premiumSamples = 0;
    state.premiumIntervalMs = interval_end_ms + FUNDING_CONSTANTS.INTERVAL_MS;
    this.emitDbEvent({
      event_type: "FUNDING_SETTLEMENT",
      changes: {
        balances: payments.map(({ userId }) => {
          const collateral = this.accounts.get(userId)!.collateral;
          return {
            user_id: userId,
            available: collateral.available,
            reserved: collateral.reserved,
          };
        }),
        positions: payments
          .filter((payment) => payment.marginDebit > 0n)
          .map(({ userId }) => ({
            user_id: userId,
            market_id,
            position: this.accounts.get(userId)!.positions.get(market_id)!,
          })),
        market_data: [
          {
            market_id,
            funding_last_rate: rate,
            last_funding_ms: interval_end_ms,
            next_funding_ms: interval_end_ms + FUNDING_CONSTANTS.INTERVAL_MS,
          },
        ],
        funding_intervals: [
          {
            market_id,
            interval_end_ms,
            index_price: indexPrice,
            rate,
            sample_count: sampleCount,
            status: skipped
              ? "SKIPPED"
              : batch.uncoveredShortfall > 0n
                ? "PARTIAL"
                : "SETTLED",
            total_paid: payments.reduce(
              (sum, payment) =>
                payment.amount > 0n ? sum + payment.amount : sum,
              0n
            ),
            insurance_used: batch.insuranceUsed,
            uncovered_shortfall: batch.uncoveredShortfall,
          },
        ],
        funding_payments: payments.map((payment) => ({
          market_id,
          interval_end_ms,
          user_id: payment.userId,
          amount: payment.amount,
          requested_amount: payment.requestedAmount,
          available_debit: payment.availableDebit,
          margin_debit: payment.marginDebit,
          insurance_covered: payment.insuranceCovered,
          uncovered_shortfall: payment.uncoveredShortfall,
        })),
        ...(insuranceChanges.length > 0 && {
          insurance_fund: insuranceChanges,
        }),
      },
    });
    this.emitFundingState(market_id);
    for (const payment of payments) {
      if (payment.marginDebit > 0n || payment.uncoveredShortfall > 0n) {
        this.liquidationCheck({ user_id: payment.userId, market_id });
      }
    }
    return engine_response(
      skipped
        ? "Funding skipped: late interval or insufficient premium samples"
        : "Funding settled",
      1,
      this.fundingResponse(market_id)
    );
  };

  private requireFreshMarkPrice = (market_id: string) => {
    const mark_price = this.markets.get(market_id)?.markPrice;
    const mark_price_metadata = this.markets.get(market_id)?.markPriceMetadata;

    if (
      !mark_price ||
      !mark_price_metadata ||
      mark_price < 0 ||
      (this.replayTimestamp ?? Date.now()) -
        mark_price_metadata?.source_timestamp >
        this.MAX_MARK_PRICE_AGE_MS
    ) {
      throw new Error("Fresh mark price does not exist");
    }

    return mark_price;
  };

  private calculateOrderReservation = (
    request: CommandOf<"PLACE_ORDER">,
    orderbook: Orderbook,
    existingPosition?: Position
  ): {
    initialMargin: bigint;
    feeReserve: bigint;
    requiredAvailable: bigint;
  } => {
    const { price, quantity, filled, leverage, side, type } = request;
    const remainingQuantity = quantity - filled;
    const bestOpposite = orderbook.getBestOppositePrice(side);
    const priceCap =
      side === OrderSide.SELL
        ? type === OrderType.MARKET
          ? (bestOpposite ?? 0n)
          : max(price, bestOpposite ?? 0n)
        : price;
    // Market buys use price as their quote budget
    // sells cannot fill above the current best bid while this synchronous order executes.
    const maximumNotional =
      type === OrderType.MARKET && side === OrderSide.BUY
        ? bestOpposite === undefined
          ? 0n
          : price
        : calculateNotional(priceCap, remainingQuantity);
    const roundingAllowance =
      maximumNotional > 0n ? BigInt(orderbook.getRestingOrderCount() + 1) : 0n;
    const feeReserve =
      calculateFee(
        maximumNotional,
        max(this.TAKER_FEE_RATE, this.MAKER_FEE_RATE)
      ) + roundingAllowance;
    const maximumMargin =
      calculateInitialMargin(maximumNotional, leverage) + roundingAllowance;
    const closesEntireMarketOrder =
      type === OrderType.MARKET &&
      existingPosition &&
      existingPosition.type !==
        (side === OrderSide.SELL ? PositionType.SHORT : PositionType.LONG) &&
      existingPosition.quantity >= remainingQuantity;
    const initialMargin =
      type === OrderType.LIMIT
        ? calculateInitialMargin(
            calculateNotional(price, remainingQuantity),
            leverage
          )
        : closesEntireMarketOrder
          ? 0n
          : maximumMargin;
    return {
      initialMargin,
      feeReserve,
      requiredAvailable:
        (type === OrderType.LIMIT ? maximumMargin : initialMargin) + feeReserve,
    };
  };

  private placeOrder = (request: CommandOf<"PLACE_ORDER">): EngineResponse => {
    try {
      const {
        action,
        market_id,
        leverage,
        user_id,
        price,
        quantity,
        ...order
      } = request;

      const orderbook = this.markets.get(market_id)?.book;
      if (!orderbook) {
        throw new Error("Incorrect Market ID");
      }
      if (this.markets.get(market_id)?.halted) {
        throw new Error("Trading is halted for this market");
      }
      const riskConfig = this.riskConfig(market_id);
      if (
        riskConfig.maxLeverage !== null &&
        leverage > riskConfig.maxLeverage
      ) {
        throw new Error("Leverage exceeds this market's limit");
      }

      const account = this.accounts.get(user_id);
      if (!account) {
        return engine_response("User Account does not exist", 0);
      }
      const existingPosition = account.positions.get(market_id);
      if (
        existingPosition &&
        existingPosition.state !== PositionState.HEALTHY
      ) {
        throw new Error("Position is under liquidation");
      }

      if (order.filled < 0n || order.filled >= quantity) {
        throw new Error("Filled quantity must be less than order quantity");
      }

      this.requireFreshMarkPrice(market_id);

      //create initial taker margin inlcuding the taker fee
      const {
        initialMargin: initial_margin,
        feeReserve,
        requiredAvailable,
      } = this.calculateOrderReservation(request, orderbook, existingPosition);
      if (account.collateral.available < requiredAvailable) {
        throw new Error("Insufficient funds");
      }

      //reserve taker margin
      this.accounts.reserveMargin(user_id, initial_margin + feeReserve);

      const result = orderbook.placeOrder({
        user_id,
        market_id,
        price,
        quantity,
        leverage,
        ...order,
      });

      //calculate actual taker fees of filled qty
      let takerFees = 0n;
      for (const fill of result.fills) {
        fill.taker_fee = calculateFee(
          calculateNotional(fill.price, fill.filled),
          this.TAKER_FEE_RATE
        );
        takerFees += fill.taker_fee;
      }

      const restingQuantity =
        order.type === OrderType.LIMIT ? quantity - result.order.filled : 0n;
      //calculate maker fee for the resting qty
      const restingMakerFee = calculateFee(
        calculateNotional(price, restingQuantity),
        this.MAKER_FEE_RATE
      );

      //calculated delta of assumed fee and actual fee
      const initial_fee = takerFees + restingMakerFee;
      const unusedFeeReserve = feeReserve - initial_fee;

      //update flags for change in market data
      if (order.type === OrderType.LIMIT || result.fills.length > 0) {
        this.markBookChanged(market_id);
      }
      //update candles and push trades to ws events
      this.emitTrades(market_id, order.side, result.fills);

      if (order.type == OrderType.LIMIT) {
        if (
          result.order.status == OrderStatus.OPEN ||
          result.order.status == OrderStatus.PARTIALLY_FILLED
        ) {
          account.orders.add(result.order.order_id);
        } else if (result.order.status === OrderStatus.FILLED) {
          account.orders.delete(result.order.order_id);
        }
      }

      let trading_fee_change: DBEventDraft["changes"]["trading_fee_account"] =
        [];
      let market_position_margin_added = 0n;
      if (result.fills.length > 0) {
        let taker_acc = this.accounts.get(user_id);
        if (!taker_acc) {
          throw new Error("Taker account not registered");
        }

        const order_position_type =
          order.side == OrderSide.SELL ? PositionType.SHORT : PositionType.LONG;
        let taker_remaining = quantity - order.filled;

        const liquidation_risks = new Set<string>();
        const fee_charges: Parameters<TradingFeeAccount["collect"]>[0] = [];

        for (const fill of result.fills) {
          this.accounts.debitMargin(fill.taker_user_id, fill.taker_fee);
          this.accounts.debitMargin(
            fill.maker_user_id,
            fill.maker_order_fee_consumed
          );
          fee_charges.push(
            {
              trade_id: fill.trade_id,
              order_id: fill.taker_order_id,
              market_id,
              user_id: fill.taker_user_id,
              role: "TAKER",
              amount: fill.taker_fee,
            },
            {
              trade_id: fill.trade_id,
              order_id: fill.maker_order_id,
              market_id,
              user_id: fill.maker_user_id,
              role: "MAKER",
              amount: fill.maker_order_fee_consumed,
            }
          );
          //========Update Positions===========
          const taker_margin_before = calculateInitialMargin(
            calculateNotional(price, taker_remaining),
            leverage
          );
          taker_remaining -= fill.filled;
          const taker_order_margin_consumed =
            taker_margin_before -
            calculateInitialMargin(
              calculateNotional(price, taker_remaining),
              leverage
            );

          // A user's own buy and sell cancel economically. Keep the trade and
          // both fees, but release the filled order margin without touching
          // their existing position.
          if (fill.taker_user_id === fill.maker_user_id) {
            if (order.type === OrderType.LIMIT) {
              this.settleFilledOrderMargin(
                user_id,
                taker_order_margin_consumed,
                0n
              );
            }
            this.settleFilledOrderMargin(
              user_id,
              fill.maker_order_margin_consumed,
              0n
            );
            if (fill.maker_order_status === OrderStatus.FILLED) {
              account.orders.delete(fill.maker_order_id);
            }
            continue;
          }

          let taker_position_margin_added = 0n;

          //========Update Taker Position===========
          let taker_position = taker_acc.positions.get(market_id);

          if (!taker_position) {
            taker_position = {
              market_id,
              type: order_position_type,
              quantity: 0n,
              reserved_margin: 0n,
              unrealized_pnl: 0n,
              avg_entry_price: 0n,
              funding_accrued: 0n,
              state: PositionState.HEALTHY,
              liquidation_attempts: 0,
            };
            taker_acc?.positions.set(market_id, taker_position);
            this.markets
              .get(market_id)
              ?.positionUserIds?.add(taker_acc.user_id);
          }

          //========Taker Position and Current Order are same side===========
          if (taker_position.type == order_position_type) {
            const margin_reserved = calculateInitialMargin(
              calculateNotional(fill.price, fill.filled),
              leverage
            );
            taker_position_margin_added = margin_reserved;
            taker_position.reserved_margin += margin_reserved;
            taker_position.avg_entry_price = calcAvgPrice(
              taker_position.avg_entry_price,
              taker_position.quantity,
              fill.price,
              fill.filled
            );
            taker_position.quantity += fill.filled;

            liquidation_risks.add(fill.taker_user_id);
            //========Taker Position and Current Order are opposite side===========
          } else {
            if (taker_position.quantity <= fill.filled) {
              //========Incase the previous position cancels out===========
              const rem_qty = fill.filled - taker_position.quantity;

              //release the prev margin + realise the PnL
              this.accounts.releaseMargin(
                taker_acc.user_id,
                taker_position.reserved_margin
              );
              this.realizeClosedFunding(
                taker_acc.user_id,
                taker_position,
                taker_position.quantity
              );

              const realizedPnl = calcUnrealisedPnL(
                taker_position.type,
                fill.price,
                taker_position.avg_entry_price,
                taker_position.quantity
              );
              this.accounts.credit(taker_acc.user_id, realizedPnl);

              //delete the redundant position
              taker_acc.positions.delete(market_id);
              this.markets
                .get(market_id)
                ?.positionUserIds?.delete(taker_acc.user_id);

              //========Incase the previous position cancels out and a opposite position is created===========
              if (taker_position.quantity < fill.filled) {
                //create new
                taker_position = {
                  market_id,
                  type: order_position_type,
                  quantity: 0n,
                  reserved_margin: 0n,
                  unrealized_pnl: 0n,
                  avg_entry_price: 0n,
                  funding_accrued: 0n,
                  state: PositionState.HEALTHY,
                  liquidation_attempts: 0,
                };

                const margin_reserved = calculateInitialMargin(
                  calculateNotional(fill.price, rem_qty),
                  leverage
                );
                taker_position_margin_added = margin_reserved;
                taker_position.reserved_margin += margin_reserved;

                taker_position.avg_entry_price = calcAvgPrice(
                  taker_position.avg_entry_price,
                  taker_position.quantity,
                  fill.price,
                  rem_qty
                );
                taker_position.quantity += rem_qty;

                taker_acc.positions.set(market_id, taker_position);
                this.markets
                  .get(market_id)
                  ?.positionUserIds?.add(taker_acc.user_id);
                liquidation_risks.add(fill.taker_user_id);
              }
            } else {
              //========Incase the previous position donot cancels out but reduces===========
              const margin_released = divideRounded(
                taker_position.reserved_margin * fill.filled,
                taker_position.quantity,
                "floor"
              );
              const realizedPnl = calcUnrealisedPnL(
                taker_position.type,
                fill.price,
                taker_position.avg_entry_price,
                fill.filled
              );

              taker_position.reserved_margin -= margin_released;
              this.realizeClosedFunding(
                taker_acc.user_id,
                taker_position,
                fill.filled
              );
              taker_position.quantity -= fill.filled;

              liquidation_risks.add(fill.taker_user_id);

              this.accounts.releaseMargin(taker_acc.user_id, margin_released);
              this.accounts.credit(taker_acc.user_id, realizedPnl);
            }
          }

          if (order.type === OrderType.MARKET) {
            market_position_margin_added += taker_position_margin_added;
          } else {
            this.settleFilledOrderMargin(
              taker_acc.user_id,
              taker_order_margin_consumed,
              taker_position_margin_added
            );
          }

          //========Update Maker Position===========
          let maker_acc = this.accounts.get(fill.maker_user_id);
          if (!maker_acc) {
            throw new Error("Maker account not registered");
          }
          let maker_position = maker_acc.positions.get(market_id);

          //===========Delete orders from User Accounts================
          if (fill.maker_order_status === OrderStatus.FILLED) {
            maker_acc.orders.delete(fill.maker_order_id);
          }

          if (!maker_position) {
            maker_position = {
              market_id,
              type:
                order_position_type == PositionType.LONG
                  ? PositionType.SHORT
                  : PositionType.LONG,
              quantity: 0n,
              reserved_margin: 0n,
              unrealized_pnl: 0n,
              avg_entry_price: 0n,
              funding_accrued: 0n,
              state: PositionState.HEALTHY,
              liquidation_attempts: 0,
            };
            maker_acc?.positions.set(market_id, maker_position);
            this.markets
              .get(market_id)
              ?.positionUserIds?.add(maker_acc.user_id);
          }

          let maker_position_margin_added = 0n;
          //========Taker Position and Current Order are same side===========
          if (maker_position.type != order_position_type) {
            const margin_reserved = calculateInitialMargin(
              calculateNotional(fill.price, fill.filled),
              fill.maker_leverage
            );
            maker_position_margin_added = margin_reserved;
            maker_position.reserved_margin += margin_reserved;
            maker_position.avg_entry_price = calcAvgPrice(
              maker_position.avg_entry_price,
              maker_position.quantity,
              fill.price,
              fill.filled
            );
            maker_position.quantity += fill.filled;

            liquidation_risks.add(fill.maker_user_id);
            //========Maker Position and Current Order are opposite side===========
          } else {
            if (maker_position.quantity <= fill.filled) {
              //========Incase the previous position cancels out===========
              const rem_qty = fill.filled - maker_position.quantity;

              //release the prev margin + realise the PnL
              this.accounts.releaseMargin(
                maker_acc.user_id,
                maker_position.reserved_margin
              );
              this.realizeClosedFunding(
                maker_acc.user_id,
                maker_position,
                maker_position.quantity
              );

              const realizedPnl = calcUnrealisedPnL(
                maker_position.type,
                fill.price,
                maker_position.avg_entry_price,
                maker_position.quantity
              );
              this.accounts.credit(maker_acc.user_id, realizedPnl);

              //delete the redundant position
              maker_acc.positions.delete(market_id);
              this.markets
                .get(market_id)
                ?.positionUserIds?.delete(maker_acc.user_id);

              //========Incase the previous position cancels out and a opposite position is created===========
              if (maker_position.quantity < fill.filled) {
                //create new
                maker_position = {
                  market_id,
                  type:
                    order_position_type == PositionType.LONG
                      ? PositionType.SHORT
                      : PositionType.LONG,
                  quantity: 0n,
                  reserved_margin: 0n,
                  unrealized_pnl: 0n,
                  avg_entry_price: 0n,
                  funding_accrued: 0n,
                  state: PositionState.HEALTHY,
                  liquidation_attempts: 0,
                };

                const margin_reserved = calculateInitialMargin(
                  calculateNotional(fill.price, rem_qty),
                  fill.maker_leverage
                );
                maker_position_margin_added = margin_reserved;
                maker_position.reserved_margin += margin_reserved;

                maker_position.avg_entry_price = calcAvgPrice(
                  maker_position.avg_entry_price,
                  maker_position.quantity,
                  fill.price,
                  rem_qty
                );
                maker_position.quantity += rem_qty;

                liquidation_risks.add(fill.maker_user_id);

                maker_acc.positions.set(market_id, maker_position);
                this.markets
                  .get(market_id)
                  ?.positionUserIds?.add(maker_acc.user_id);
              }
            } else {
              //========Incase the previous position donot cancels out but reduces===========
              const margin_released = divideRounded(
                maker_position.reserved_margin * fill.filled,
                maker_position.quantity,
                "floor"
              );
              const realizedPnl = calcUnrealisedPnL(
                maker_position.type,
                fill.price,
                maker_position.avg_entry_price,
                fill.filled
              );

              maker_position.reserved_margin -= margin_released;
              this.realizeClosedFunding(
                maker_acc.user_id,
                maker_position,
                fill.filled
              );
              maker_position.quantity -= fill.filled;

              liquidation_risks.add(fill.maker_user_id);

              this.accounts.releaseMargin(maker_acc.user_id, margin_released);
              this.accounts.credit(maker_acc.user_id, realizedPnl);
            }
          }
          this.settleFilledOrderMargin(
            maker_acc.user_id,
            fill.maker_order_margin_consumed,
            maker_position_margin_added
          );
        }

        this.tradingFeeAccount ??= new TradingFeeAccount(
          MARKET_CONFIG.COLLATERAL_ASSET
        );
        const fee_settlement = this.tradingFeeAccount.collect(fee_charges);
        trading_fee_change = [fee_settlement];

        for (const affected_user_id of liquidation_risks) {
          this.liquidationCheck({ user_id: affected_user_id, market_id });
        }
      }

      if (
        order.type === OrderType.MARKET &&
        initial_margin > market_position_margin_added
      ) {
        this.accounts.releaseMargin(
          user_id,
          initial_margin - market_position_margin_added
        );
      }

      if (unusedFeeReserve > 0n) {
        this.accounts.releaseMargin(user_id, unusedFeeReserve);
      }

      const order_db_update: NonNullable<DBEventInput["changes"]["orders"]> = [
        {
          order_id: result.order.order_id,
          user_id,
          market_id,
          type: order.type,
          side: order.side,
          status: result.order.status,
          price,
          quantity,
          filled: result.order.filled,
          leverage,
          initial_margin,
          initial_fee,
          remaining_order_margin:
            order.type === OrderType.LIMIT
              ? calculateInitialMargin(
                  calculateNotional(price, quantity - result.order.filled),
                  leverage
                )
              : 0n,
          remaining_order_fee:
            order.type === OrderType.LIMIT
              ? calculateFee(
                  calculateNotional(price, quantity - result.order.filled),
                  this.MAKER_FEE_RATE ?? 0n
                )
              : 0n,
          slippage: 0n,
        },
      ];

      const cancellation_events =
        this.commandEvents?.db.filter(
          (event) => event.event_type === "CANCEL_ORDER"
        ) ?? [];
      const affected_user_ids = new Set([
        user_id,
        ...result.fills.map((fill) => fill.maker_user_id),
        ...cancellation_events.flatMap((event) =>
          (event.changes.balances ?? []).map((balance) => balance.user_id)
        ),
      ]);
      const balance_db_update: NonNullable<
        DBEventInput["changes"]["balances"]
      > = [];
      const positions_db_update: NonNullable<
        DBEventInput["changes"]["positions"]
      > = [];
      for (const affected_user_id of affected_user_ids) {
        const affected_account = this.accounts.get(affected_user_id);
        if (!affected_account) {
          throw new Error(`Account not registered: ${affected_user_id}`);
        }

        balance_db_update.push({
          user_id: affected_user_id,
          available: affected_account.collateral.available,
          reserved: affected_account.collateral.reserved,
        });

        if (result.fills.length > 0) {
          const position = affected_account.positions.get(market_id);
          positions_db_update.push({
            user_id: affected_user_id,
            market_id,
            position: position
              ? {
                  type: position.type,
                  quantity: position.quantity,
                  reserved_margin: position.reserved_margin,
                  avg_entry_price: position.avg_entry_price,
                  unrealized_pnl: position.unrealized_pnl,
                  funding_accrued: position.funding_accrued,
                  state: position.state,
                  liquidation_id: position.liquidation_id,
                  liquidation_attempts: position.liquidation_attempts,
                }
              : null,
          });
        }
      }

      const fills_db_update: NonNullable<DBEventInput["changes"]["fills"]> =
        result.fills.map((fill_item: Fill) => ({
          trade_id: fill_item.trade_id,
          maker_order_id: fill_item.maker_order_id,
          taker_order_id: fill_item.taker_order_id,
          maker_user_id: fill_item.maker_user_id,
          taker_user_id: fill_item.taker_user_id,
          price: fill_item.price.toString(),
          filled: fill_item.filled.toString(),
          maker_leverage: fill_item.maker_leverage.toString(),
          maker_order_margin_consumed:
            fill_item.maker_order_margin_consumed.toString(),
          maker_order_fee_consumed:
            fill_item.maker_order_fee_consumed.toString(),
          maker_order_fee_remaining:
            fill_item.maker_order_fee_remaining.toString(),
          taker_fee: fill_item.taker_fee.toString(),
          maker_order_status: fill_item.maker_order_status,
        }));

      const response = {
        order: {
          ...result.order,
          filled: formatFixed(result.order.filled),
          rem_qty: formatFixed(result.order.rem_qty),
          rem_amt: formatFixed(result.order.rem_amt),
          initial_fee: formatFixed(initial_fee),
          remaining_order_fee: formatFixed(
            order.type === OrderType.LIMIT
              ? calculateFee(
                  calculateNotional(price, quantity - result.order.filled),
                  this.MAKER_FEE_RATE ?? 0n
                )
              : 0n
          ),
        },
        fills: result.fills.map((fill_item: Fill) => {
          const {
            price,
            filled,
            maker_leverage,
            maker_order_margin_consumed,
            maker_order_fee_consumed,
            maker_order_fee_remaining,
            taker_fee,
            ...fill
          } = fill_item;

          return {
            ...fill,
            price: formatFixed(price),
            filled: formatFixed(filled),
            maker_fee: formatFixed(maker_order_fee_consumed),
            taker_fee: formatFixed(taker_fee),
          };
        }),
      };

      this.emitDbEvent({
        event_type: "PLACE_ORDER",
        changes: {
          balances: balance_db_update,
          orders: order_db_update,
          fills: fills_db_update,
          positions: positions_db_update,
          market_data:
            result.fills.length > 0
              ? [{ market_id, ...orderbook.fetchMarketData() }]
              : [],
          trading_fee_account: trading_fee_change,
        },
      });
      const eventsBeforeRetry = this.commandEvents?.db.length ?? 0;
      this.retryActiveLiquidations(market_id);

      // A newly resting order may be consumed by a liquidation in the same
      // command. Include those maker fills in the placement response.
      const retryFills = (this.commandEvents?.db.slice(eventsBeforeRetry) ?? [])
        .flatMap((event) => event.changes.fills ?? [])
        .filter((fill) => fill.maker_order_id === result.order.order_id);
      if (retryFills.length) {
        const finalFilled =
          result.order.filled +
          retryFills.reduce((sum, fill) => sum + BigInt(fill.filled), 0n);
        const lastFill = retryFills[retryFills.length - 1]!;
        response.order.filled = formatFixed(finalFilled);
        response.order.status = lastFill.maker_order_status;
        response.order.rem_qty = formatFixed(quantity - finalFilled);
        response.order.remaining_order_fee = formatFixed(
          BigInt(lastFill.maker_order_fee_remaining)
        );
        response.fills.push(
          ...retryFills.map((fill) => ({
            trade_id: fill.trade_id,
            maker_order_id: fill.maker_order_id,
            maker_user_id: fill.maker_user_id,
            taker_order_id: fill.taker_order_id,
            taker_user_id: fill.taker_user_id,
            maker_order_status: fill.maker_order_status,
            price: formatFixed(BigInt(fill.price)),
            filled: formatFixed(BigInt(fill.filled)),
            maker_fee: formatFixed(BigInt(fill.maker_order_fee_consumed)),
            taker_fee: formatFixed(BigInt(fill.taker_fee)),
          }))
        );
      }

      return engine_response("Order placed successfully", 1, response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return engine_response(err.message, 0, null);
    }
  };

  private cancelOrder = (
    request: CommandOf<"CANCEL_ORDER">
  ): EngineResponse => {
    const { action, ...cancel_request } = request;
    const orderbook = this.markets.get(cancel_request.market_id)?.book;
    if (!orderbook) {
      throw new Error("Incorrect Market ID");
    }
    const account = this.accounts.get(request.user_id);
    if (!account) {
      throw new Error("User Account does not exist");
    }

    const cancelResult = orderbook.cancelOrder(cancel_request);
    if (!cancelResult) {
      throw new Error("Cancel order failed");
    }
    this.markBookChanged(request.market_id);

    const { order_id, rem_qty, price, leverage } = cancelResult;
    const notional = calculateNotional(price, rem_qty);
    const initial_margin = calculateInitialMargin(notional, leverage);
    const remaining_order_fee = calculateFee(
      notional,
      this.MAKER_FEE_RATE ?? 0n
    );
    this.accounts.releaseMargin(
      request.user_id,
      initial_margin + remaining_order_fee
    );
    account.orders.delete(order_id);

    this.emitDbEvent({
      event_type: "CANCEL_ORDER",
      changes: {
        balances: [
          {
            user_id: request.user_id,
            available: account.collateral.available,
            reserved: account.collateral.reserved,
          },
        ],
        orders: [],
        order_updates: [
          {
            order_id,
            user_id: request.user_id,
            market_id: request.market_id,
            status: OrderStatus.CANCELLED,
            remaining_order_margin: 0n,
            remaining_order_fee: 0n,
          },
        ],
        fills: [],
        positions: [],
        market_data: [],
      },
    });

    return engine_response("Order cancelled successfully", 1, {
      order_id,
      rem_qty: formatFixed(rem_qty),
      price: formatFixed(price),
      released_fee: formatFixed(remaining_order_fee),
    });
  };

  private getDepth = (request: CommandOf<"GET_DEPTH">): EngineResponse => {
    const orderbook = this.markets.get(request.market_id)?.book;
    if (!orderbook) {
      throw new Error("Incorrect Market ID");
    }

    const response = orderbook.getDepth();
    return engine_response("Depth fetched successfully", 1, { ...response });
  };

  private getPosition = (
    request: CommandOf<"GET_POSITION">
  ): EngineResponse => {
    const account = this.accounts.get(request.user_id);
    if (!account) {
      throw new Error("Incorrect User ID");
    }

    const position = account.positions.get(request.market_id);

    if (!position) {
      return engine_response("Position does not exist for this market", 1);
    }

    const response = {
      market_id: position.market_id,
      type: position.type,
      quantity: formatFixed(position.quantity),
      reserved_margin: formatFixed(position.reserved_margin),
      avg_entry_price: formatFixed(position.avg_entry_price),
      unrealized_pnl: formatFixed(position.unrealized_pnl),
      funding_accrued: formatFixed(position.funding_accrued),
      state: position.state,
      liquidation_id: position.liquidation_id,
    };
    const markPrice = this.markets.get(request.market_id)?.markPrice;
    if (markPrice !== undefined) {
      const riskConfig = this.riskConfig(request.market_id);
      const risk = calculatePositionRisk(
        position,
        markPrice,
        riskConfig.maintenanceMarginRate,
        riskConfig.liquidationFeeRate
      );
      Object.assign(response, {
        mark_price: formatFixed(markPrice),
        equity: formatFixed(risk.equity),
        maintenance_margin: formatFixed(risk.maintenanceMargin),
        estimated_liquidation_fee: formatFixed(risk.estimatedCloseFee),
        liquidation_price: (() => {
          const price = calculateLiquidationPrice(
            position,
            riskConfig.maintenanceMarginRate,
            riskConfig.liquidationFeeRate
          );
          return price === null ? null : formatFixed(price);
        })(),
      });
    }

    return engine_response("Position fetched successfully", 1, { ...response });
  };

  private liquidationCheck = ({
    user_id,
    market_id,
  }: {
    user_id: string;
    market_id: string;
  }) => {
    this.liquidationQueue.set(`${user_id}:${market_id}`, {
      user_id,
      market_id,
    });
    this.drainLiquidationQueue();
  };

  private retryActiveLiquidations = (market_id: string): void => {
    if (this.markets.get(market_id)?.halted) return;
    for (const user_id of this.markets.get(market_id)?.positionUserIds ?? []) {
      const position = this.accounts.get(user_id)?.positions.get(market_id);
      if (position?.state === PositionState.LIQUIDATING) {
        this.liquidationQueue.set(`${user_id}:${market_id}`, {
          user_id,
          market_id,
        });
      }
    }
    this.drainLiquidationQueue();
  };

  private drainLiquidationQueue = (): void => {
    if (this.processingLiquidations) return;
    this.processingLiquidations = true;
    const processed = new Set<string>();
    try {
      while (this.liquidationQueue.size > 0) {
        const [key, next] = this.liquidationQueue.entries().next().value!;
        this.liquidationQueue.delete(key);
        if (processed.has(key)) continue;
        processed.add(key);
        if (processed.size > ENGINE_CONSTANTS.LIQUIDATION_QUEUE_MAX_PROCESSED) {
          throw new Error("Liquidation cascade exceeds safety limit");
        }
        this.processLiquidation(next);
      }
    } finally {
      this.processingLiquidations = false;
    }
  };

  private processLiquidation = ({
    user_id,
    market_id,
  }: {
    user_id: string;
    market_id: string;
  }) => {
    if (this.markets.get(market_id)?.halted) return;
    const account = this.accounts.get(user_id);
    const position = account?.positions.get(market_id);
    if (!account || !position) return;
    const orderbook = this.markets.get(market_id)?.book;
    if (!orderbook) {
      throw new Error("Incorrect Market ID");
    }

    const mark_price = this.requireFreshMarkPrice(market_id);
    const riskConfig = this.riskConfig(market_id);
    const risk = calculatePositionRisk(
      position,
      mark_price,
      riskConfig.maintenanceMarginRate,
      riskConfig.liquidationFeeRate
    );
    position.unrealized_pnl = risk.unrealizedPnl;

    if (risk.liquidatable || position.state === PositionState.LIQUIDATING) {
      position.state = PositionState.LIQUIDATING;
      position.liquidation_id ??= generate_liquidation_order_id(
        this.currentSourceMessageId ?? randomUUID(),
        user_id,
        market_id,
        0
      );
      position.liquidation_attempts += 1;
      //trigger liquidity
      const initial_position_quantity = position.quantity;
      const liquidation_quantity =
        riskConfig.maxLiquidationQuantity !== null &&
        riskConfig.maxLiquidationQuantity < position.quantity
          ? riskConfig.maxLiquidationQuantity
          : position.quantity;

      // Cancel only resting orders in the liquidated market. Isolated margin
      // and orders in other markets must remain available to the user.
      for (const open_order_id of [...account.orders]) {
        if (!orderbook.hasOrder(open_order_id)) continue;

        this.cancelOrder({
          action: "CANCEL_ORDER",
          user_id,
          order_id: open_order_id,
          market_id,
        });
      }

      const liquidationIndex =
        this.commandEvents?.liquidationOrderSequence ?? 0;
      if (this.commandEvents) this.commandEvents.liquidationOrderSequence++;
      const order_id = generate_liquidation_order_id(
        this.currentSourceMessageId ?? randomUUID(),
        user_id,
        market_id,
        liquidationIndex
      );

      const side =
        position.type == PositionType.LONG ? OrderSide.SELL : OrderSide.BUY;

      const response = orderbook.matchToClose(
        user_id,
        order_id,
        side,
        liquidation_quantity
      );
      if (response.fills.length > 0) {
        this.markBookChanged(market_id);
        this.emitTrades(market_id, side, response.fills);
      }

      const liquidation_risks = new Set<string>();
      let remaining_liquidation_quantity = position.quantity;
      let remaining_position_margin = position.reserved_margin;
      let remaining_funding = position.funding_accrued;
      let consumed_position_margin = 0n;
      let total_realized_pnl = 0n;
      let total_liquidation_fee = 0n;
      let total_user_refund = 0n;
      let total_shortfall_covered = 0n;
      let total_uncovered_shortfall = 0n;
      const fund_settlement_inputs: Array<{
        entry_id_prefix: string;
        market_id: string;
        user_id: string;
        liquidation_order_id: string;
        execution_equity: bigint;
        requested_liquidation_fee: bigint;
      }> = [];
      const insurance_fund_changes: DBEventDraft["changes"]["insurance_fund"] =
        [];
      const liquidation_fee_charges: Parameters<
        TradingFeeAccount["collect"]
      >[0] = [];
      response?.fills.forEach((fill: Fill) => {
        const economics = calculateLiquidationFill(
          {
            ...position,
            quantity: remaining_liquidation_quantity,
            reserved_margin: remaining_position_margin,
            funding_accrued: remaining_funding,
          },
          fill.filled,
          fill.price,
          riskConfig.liquidationFeeRate
        );
        total_realized_pnl += economics.realizedPnl;
        fund_settlement_inputs.push({
          entry_id_prefix: `${order_id}:${fill.trade_id}`,
          market_id,
          user_id,
          liquidation_order_id: order_id,
          execution_equity: economics.executionEquity,
          requested_liquidation_fee: economics.requestedFee,
        });
        consumed_position_margin += economics.allocatedMargin;
        remaining_position_margin -= economics.allocatedMargin;
        remaining_funding -= economics.allocatedFunding;
        remaining_liquidation_quantity -= fill.filled;

        //handle maker position
        //========Update Maker Position===========
        let maker_acc = this.accounts.get(fill.maker_user_id);
        if (!maker_acc) {
          throw new Error("Maker account not registered");
        }
        this.accounts.debitMargin(
          fill.maker_user_id,
          fill.maker_order_fee_consumed
        );
        liquidation_fee_charges.push({
          trade_id: fill.trade_id,
          order_id: fill.maker_order_id,
          market_id,
          user_id: fill.maker_user_id,
          role: "MAKER",
          amount: fill.maker_order_fee_consumed,
        });
        let maker_position = maker_acc.positions.get(market_id);

        //===========Delete orders from User Accounts================
        if (fill.maker_order_status === OrderStatus.FILLED) {
          maker_acc.orders.delete(fill.maker_order_id);
        }

        if (!maker_position) {
          maker_position = {
            market_id,
            type: position.type,
            quantity: 0n,
            reserved_margin: 0n,
            unrealized_pnl: 0n,
            avg_entry_price: 0n,
            funding_accrued: 0n,
            state: PositionState.HEALTHY,
            liquidation_attempts: 0,
          };
          maker_acc?.positions.set(market_id, maker_position);
          this.markets.get(market_id)?.positionUserIds?.add(maker_acc.user_id);
        }

        let maker_position_margin_added = 0n;
        //========Taker Position and Current Order are same side===========
        if (maker_position.type == position.type) {
          const margin_reserved = calculateInitialMargin(
            calculateNotional(fill.price, fill.filled),
            fill.maker_leverage
          );
          maker_position_margin_added = margin_reserved;
          maker_position.reserved_margin += margin_reserved;
          maker_position.avg_entry_price = calcAvgPrice(
            maker_position.avg_entry_price,
            maker_position.quantity,
            fill.price,
            fill.filled
          );
          maker_position.quantity += fill.filled;
          liquidation_risks.add(fill.maker_user_id);
          //========Maker Position and Current Order are opposite side===========
        } else {
          if (maker_position.quantity <= fill.filled) {
            //========Incase the previous position cancels out===========
            const rem_qty = fill.filled - maker_position.quantity;

            //release the prev margin + realise the PnL
            this.accounts.releaseMargin(
              maker_acc.user_id,
              maker_position.reserved_margin
            );
            this.realizeClosedFunding(
              maker_acc.user_id,
              maker_position,
              maker_position.quantity
            );

            const realizedPnl = calcUnrealisedPnL(
              maker_position.type,
              fill.price,
              maker_position.avg_entry_price,
              maker_position.quantity // full close
            );
            this.accounts.credit(maker_acc.user_id, realizedPnl);

            //delete the redundant position
            maker_acc.positions.delete(market_id);
            this.markets
              .get(market_id)
              ?.positionUserIds?.delete(maker_acc.user_id);

            //========Incase the previous position cancels out and a opposite position is created===========
            if (maker_position.quantity < fill.filled) {
              //create new
              maker_position = {
                market_id,
                type: position.type,
                quantity: 0n,
                reserved_margin: 0n,
                unrealized_pnl: 0n,
                avg_entry_price: 0n,
                funding_accrued: 0n,
                state: PositionState.HEALTHY,
                liquidation_attempts: 0,
              };

              const margin_reserved = calculateInitialMargin(
                calculateNotional(fill.price, rem_qty),
                fill.maker_leverage
              );
              maker_position_margin_added = margin_reserved;
              maker_position.reserved_margin += margin_reserved;

              maker_position.avg_entry_price = calcAvgPrice(
                maker_position.avg_entry_price,
                maker_position.quantity,
                fill.price,
                rem_qty
              );
              maker_position.quantity += rem_qty;
              liquidation_risks.add(fill.maker_user_id);

              maker_acc.positions.set(market_id, maker_position);
              this.markets
                .get(market_id)
                ?.positionUserIds?.add(maker_acc.user_id);
            }
          } else {
            //========Incase the previous position donot cancels out but reduces===========
            const margin_released = divideRounded(
              maker_position.reserved_margin * fill.filled,
              maker_position.quantity,
              "floor"
            );
            const realizedPnl = calcUnrealisedPnL(
              maker_position.type,
              fill.price,
              maker_position.avg_entry_price,
              fill.filled
            );

            maker_position.reserved_margin -= margin_released;
            this.realizeClosedFunding(
              maker_acc.user_id,
              maker_position,
              fill.filled
            );
            maker_position.quantity -= fill.filled;
            liquidation_risks.add(fill.maker_user_id);

            this.accounts.releaseMargin(maker_acc.user_id, margin_released);
            this.accounts.credit(maker_acc.user_id, realizedPnl);
          }
        }
        this.settleFilledOrderMargin(
          maker_acc.user_id,
          fill.maker_order_margin_consumed,
          maker_position_margin_added
        );
      });

      for (const settlement_input of fund_settlement_inputs) {
        const fund_settlement =
          this.insuranceFund.settleLiquidation(settlement_input);
        if (fund_settlement.user_refund > 0n) {
          this.accounts.credit(user_id, fund_settlement.user_refund);
        }
        total_liquidation_fee += fund_settlement.liquidation_fee;
        total_user_refund += fund_settlement.user_refund;
        total_shortfall_covered += fund_settlement.shortfall_covered;
        total_uncovered_shortfall += fund_settlement.uncovered_shortfall;
        insurance_fund_changes.push({
          collateral_asset: fund_settlement.collateral_asset,
          balance: fund_settlement.balance,
          total_liquidation_fees: fund_settlement.total_liquidation_fees,
          total_liquidation_surplus: fund_settlement.total_liquidation_surplus,
          total_shortfall_covered: fund_settlement.total_shortfall_covered,
          total_uncovered_shortfall: fund_settlement.total_uncovered_shortfall,
          entries: fund_settlement.entries,
        });
      }
      const trading_fee_changes = liquidation_fee_charges.length
        ? [this.tradingFeeAccount.collect(liquidation_fee_charges)]
        : [];

      // Liquidation consumes the portion of isolated margin assigned to fills.
      // Positive execution equity is returned after the liquidation fee; the
      // insurance fund receives that fee and covers negative execution equity.
      this.accounts.debitMargin(user_id, consumed_position_margin);
      position.reserved_margin = remaining_position_margin;
      position.funding_accrued = remaining_funding;
      position.quantity = remaining_liquidation_quantity;
      if (total_uncovered_shortfall > 0n) {
        position.state = PositionState.BANKRUPT;
        this.markets.get(market_id)!.halted = true;
      }

      if (remaining_liquidation_quantity !== 0n) {
        position.unrealized_pnl = calcUnrealisedPnL(
          position.type,
          mark_price,
          position.avg_entry_price,
          position.quantity
        );
      } else {
        //delete the redundant position
        this.accounts.get(user_id)?.positions.delete(market_id);
        this.markets.get(market_id)?.positionUserIds?.delete(user_id);
      }

      const affected_accounts = Array.from(
        new Set([user_id, ...response.fills.map((fill) => fill.maker_user_id)]),
        (affected_user_id) => {
          const account = this.accounts.get(affected_user_id);
          if (!account) {
            throw new Error(`Account not registered: ${affected_user_id}`);
          }
          return account;
        }
      );

      const db_update_order =
        response.filled > 0n
          ? [
              {
                order_id,
                user_id,
                market_id,
                type: OrderType.MARKET,
                side,
                status:
                  response.rem_qty === 0n
                    ? OrderStatus.FILLED
                    : OrderStatus.CANCELLED,
                price: mark_price,
                quantity: liquidation_quantity,
                filled: response.filled,
                // Close-only liquidation has no order leverage or reserved margin.
                leverage: 0n,
                initial_margin: 0n,
                initial_fee: 0n,
                remaining_order_margin: 0n,
                remaining_order_fee: 0n,
                slippage: 0n,
              },
            ]
          : [];
      const db_update_fills = response.fills.map((fill) => ({
        trade_id: fill.trade_id,
        maker_order_id: fill.maker_order_id,
        taker_order_id: fill.taker_order_id,
        maker_user_id: fill.maker_user_id,
        taker_user_id: fill.taker_user_id,
        price: fill.price,
        filled: fill.filled,
        maker_leverage: fill.maker_leverage,
        maker_order_margin_consumed: fill.maker_order_margin_consumed,
        maker_order_fee_consumed: fill.maker_order_fee_consumed,
        maker_order_fee_remaining: fill.maker_order_fee_remaining,
        taker_fee: 0n,
        maker_order_status: fill.maker_order_status,
      }));
      const db_update_positions = affected_accounts.map((account) => {
        const current_position = account.positions.get(market_id);
        return {
          user_id: account.user_id,
          market_id,
          position: current_position
            ? {
                type: current_position.type,
                quantity: current_position.quantity,
                reserved_margin: current_position.reserved_margin,
                avg_entry_price: current_position.avg_entry_price,
                unrealized_pnl: current_position.unrealized_pnl,
                funding_accrued: current_position.funding_accrued,
                state: current_position.state,
                liquidation_id: current_position.liquidation_id,
                liquidation_attempts: current_position.liquidation_attempts,
              }
            : null,
        };
      });

      this.emitDbEvent({
        event_type: "LIQUIDATION",
        changes: {
          balances: affected_accounts.map((account) => ({
            user_id: account.user_id,
            available: account.collateral.available,
            reserved: account.collateral.reserved,
          })),
          orders: db_update_order,
          fills: db_update_fills,
          positions: db_update_positions,
          market_data: [
            {
              market_id,
              mark_price,
              ...(total_uncovered_shortfall > 0n && { trading_halted: true }),
              ...(response.fills.length > 0 ? orderbook.fetchMarketData() : {}),
            },
          ],
          insurance_fund: insurance_fund_changes,
          trading_fee_account: trading_fee_changes,
          liquidation_attempts: [
            {
              attempt_id: order_id,
              liquidation_id: position.liquidation_id!,
              user_id,
              market_id,
              status:
                total_uncovered_shortfall > 0n
                  ? "BANKRUPT"
                  : remaining_liquidation_quantity === 0n
                    ? "COMPLETED"
                    : "LIQUIDATING",
              attempt: position.liquidation_attempts,
              initial_quantity: initial_position_quantity,
              filled_quantity: response.filled,
              remaining_quantity: remaining_liquidation_quantity,
              mark_price,
              realized_pnl: total_realized_pnl,
              liquidation_fee: total_liquidation_fee,
              user_refund: total_user_refund,
              shortfall_covered: total_shortfall_covered,
              uncovered_shortfall: total_uncovered_shortfall,
            },
          ],
        },
      });

      for (const affected_user_id of liquidation_risks) {
        this.liquidationCheck({ user_id: affected_user_id, market_id });
      }
    }
  };

  private markPriceUpdate = (
    request: CommandOf<"MARK_PRICE_UPDATE">
  ): EngineResponse => {
    const { market_id, mark_price, source_timestamp, producer_id, sequence } =
      request;

    if (!this.markets.has(market_id)) {
      return engine_response("Incorrect Market ID", 0);
    }

    if (mark_price <= 0) {
      return engine_response("Invalid mark price", 0);
    }

    const parsed_sequence = BigInt(sequence);
    const latest_metadata = this.markets.get(market_id)?.markPriceMetadata;
    const now = this.replayTimestamp ?? Date.now();

    if (
      source_timestamp < now - this.MAX_MARK_PRICE_AGE_MS ||
      source_timestamp > now + this.MAX_MARK_PRICE_CLOCK_SKEW_MS ||
      (latest_metadata &&
        (source_timestamp < latest_metadata.source_timestamp ||
          (producer_id === latest_metadata.producer_id &&
            parsed_sequence <= latest_metadata.sequence) ||
          (source_timestamp === latest_metadata.source_timestamp &&
            parsed_sequence <= latest_metadata.sequence)))
    ) {
      return engine_response("Stale mark price update ignored", 0);
    }

    const market = this.markets.get(market_id)!;
    market.markPrice = mark_price;
    market.markPriceMetadata = {
      producer_id,
      source_timestamp,
      sequence: parsed_sequence,
    };
    const funding = this.markets.get(market_id)?.funding;
    const book = this.markets.get(market_id)?.book;
    if (
      funding &&
      book &&
      funding.fixedRate === null &&
      this.markets.get(market_id)?.quote === MARKET_CONFIG.COLLATERAL_ASSET
    ) {
      const intervalEnd = fundingIntervalEnd(source_timestamp);
      if (
        funding.premiumIntervalMs === 0 ||
        (intervalEnd > funding.premiumIntervalMs &&
          funding.lastSettledIntervalMs >= funding.premiumIntervalMs)
      ) {
        funding.premiumIntervalMs = intervalEnd;
        funding.premiumSum = 0n;
        funding.premiumSamples = 0;
      }
      if (funding.premiumIntervalMs === intervalEnd) {
        const premium = samplePremium(book, mark_price);
        if (premium !== null) {
          funding.premiumSum += premium;
          funding.premiumSamples += 1;
          if (funding.premiumSamples % 10 === 0)
            this.emitFundingState(market_id);
        }
      }
    }
    this.commandEvents?.changedTickers.add(market_id);
    this.emitDbEvent({
      event_type: "MARK_PRICE_UPDATE",
      changes: { market_data: [{ market_id, mark_price }] },
    });

    const users_with_position = this.markets.get(market_id)?.positionUserIds;

    if (!users_with_position?.size) {
      return engine_response("No positions to recalibrate", 1, {
        response: "res",
      });
    }

    for (const user_id of users_with_position) {
      this.liquidationCheck({ user_id, market_id });
    }
    return engine_response("Positions recalibrated successfully", 1, null);
  };
}

export default Engine;
