import {
  divideRounded,
  formatFixed,
  multiplyFixed,
  SCALE
} from "./math/fixed-point";
import type {
  EngineSnapshot,
  Fill,
  markPriceMetadata,
  SnapshotMarket
} from "./types";
import { engine_response, generate_liquidation_order_id } from "./utils";
import type { EngineCommand } from "./zod/z";
import { EngineSnapshotSchema } from "./zod/z";
import Orderbook from "./orderbook";
import AccountStore from "./accounts";
import {
  calculateFee,
  calculateInitialMargin,
  calculateMaintenanceMargin,
  calculateNotional
} from "./math/financial-math";
import type { EngineResponse } from "commons/src/index";
import type { DBEventInput, WSEvent } from "commons/src/engine-event";
import {
  OrderSide,
  OrderStatus,
  OrderType,
  PositionType
} from "commons/src/order.type";
import { calcAvgPrice, calcUnrealisedPnL } from "./perp";
import MARKET_CONFIG from "./config/market.config";
import InsuranceFund from "./insurance-fund";
import TradingFeeAccount from "./trading-fee-account";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const SNAPSHOT_PATH = fileURLToPath(
  new URL("../snapshot.json", import.meta.url)
);

type CommandOf<Action extends EngineCommand["action"]> = Extract<
  EngineCommand,
  { action: Action }
>;

type WSEventDraft<Event extends WSEvent = WSEvent> = Event extends WSEvent
  ? Pick<Event, "event_type" | "data">
  : never;
type DBEventDraft = Pick<DBEventInput, "event_type" | "changes">;
type CandleDraft = {
  market_id: string;
  start_ms: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  base_volume: bigint;
  quote_volume: bigint;
  trade_count: number;
};

export type EngineCommandResult = {
  response: EngineResponse;
  dbEvents: DBEventDraft[];
  wsEvents: WSEventDraft[];
};

class Engine {
  private orderbooks: Map<string, Orderbook> = new Map();
  private accounts = new AccountStore([]);
  private markPrices: Map<string, bigint> = new Map();
  private markPriceMetadata: Map<string, markPriceMetadata> = new Map();
  private positionUsersByMarket: Map<string, Set<string>> = new Map(); //market->users>
  private readonly MAX_MARK_PRICE_AGE_MS;
  private readonly MAX_MARK_PRICE_CLOCK_SKEW_MS;
  private MAINTENANCE_MARGIN_RATE: bigint;
  private readonly LIQUIDATION_FEE_RATE: bigint;
  private readonly MAKER_FEE_RATE: bigint;
  private readonly TAKER_FEE_RATE: bigint;
  private insuranceFund!: InsuranceFund;
  private tradingFeeAccount!: TradingFeeAccount;
  private lastAppliedStreamId = "0-0";
  private replayTimestamp: number | null = null;
  private currentSourceMessageId: string | null = null;
  private liquidationOrderSequence = 0;
  private awaitingEventPublication = false;
  private snapshotTimer?: ReturnType<typeof setInterval>;
  private commandEvents: {
    db: DBEventDraft[];
    ws: WSEventDraft[];
    changedBooks: Set<string>;
    changedTickers: Set<string>;
    candles: Map<string, CandleDraft>;
    timestampMs: number;
  } | null = null;

  private constructor(marketIds: string[]) {
    this.MAX_MARK_PRICE_AGE_MS = MARKET_CONFIG.MAX_MARK_PRICE_AGE_MS;
    this.MAX_MARK_PRICE_CLOCK_SKEW_MS =
      MARKET_CONFIG.MAX_MARK_PRICE_CLOCK_SKEW_MS;
    this.MAINTENANCE_MARGIN_RATE = MARKET_CONFIG.MAINTENANCE_MARGIN_RATE;
    this.LIQUIDATION_FEE_RATE = MARKET_CONFIG.LIQUIDATION_FEE_RATE;
    this.MAKER_FEE_RATE = MARKET_CONFIG.MAKER_FEE_RATE;
    this.TAKER_FEE_RATE = MARKET_CONFIG.TAKER_FEE_RATE;

    if (existsSync(SNAPSHOT_PATH)) {
      const parsedSnapshot = EngineSnapshotSchema.safeParse(
        JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"))
      );
      if (!parsedSnapshot.success) {
        const details = parsedSnapshot.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        throw new Error(`Cannot restore invalid engine snapshot: ${details}`);
      }
      const snapshot: EngineSnapshot = parsedSnapshot.data;
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
      snapshot.mark_prices.forEach((mark) => {
        this.markPrices.set(mark.market_id, BigInt(mark.price));
        this.markPriceMetadata.set(mark.market_id, {
          producer_id: mark.producer_id,
          source_timestamp: mark.source_timestamp,
          sequence: BigInt(mark.sequence)
        });
      });

      this.accounts = new AccountStore(snapshot.accounts);

      snapshot.markets.forEach((market_data) => {
        const orderbook = new Orderbook(market_data, this.MAKER_FEE_RATE);
        this.orderbooks.set(market_data.market_id, orderbook);
        this.positionUsersByMarket.set(market_data.market_id, new Set());

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

      snapshot.accounts.forEach((account) => {
        account.positions.forEach((position) => {
          let positionUsers = this.positionUsersByMarket.get(
            position.market_id
          );
          if (!positionUsers) {
            positionUsers = new Set<string>();
            this.positionUsersByMarket.set(position.market_id, positionUsers);
          }
          positionUsers.add(account.user_id);
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

    for (const market_id of marketIds) {
      if (!this.orderbooks.has(market_id)) {
        this.orderbooks.set(
          market_id,
          new Orderbook(
            {
              market_id,
              last_traded_price: "0",
              last_trade_id: "",
              orders: []
            },
            this.MAKER_FEE_RATE
          )
        );
        this.positionUsersByMarket.set(market_id, new Set());
      }
    }

    if (this.orderbooks.size === 0) {
      throw new Error("No markets available to initialize the engine");
    }
    this.captureSnapshot();
  }

  static async create(): Promise<Engine> {
    const { MarketRepo } = await import("db/repositories/market.repo");
    const marketIds = (await MarketRepo.listMarkets()).map(
      (market) => market.market_id
    );
    return new Engine(marketIds);
  }

  getLastAppliedStreamId(): string {
    return this.lastAppliedStreamId;
  }

  recordAppliedStreamId(streamId: string): void {
    this.lastAppliedStreamId = streamId;
    this.awaitingEventPublication = false;
  }

  captureSnapshot() {
    this.snapshotTimer = setInterval(() => {
      if (this.awaitingEventPublication) return;

      const snapshot: EngineSnapshot = {
        version: 4,
        snapshot_time: Date.now(),
        scale: Number(SCALE),
        last_applied_stream_id: this.lastAppliedStreamId,
        markets: [],
        accounts: this.accounts.snapshotAccount(),
        mark_prices: Array.from(
          this.markPriceMetadata,
          ([market_id, metadata]) => {
            const price = this.markPrices.get(market_id);
            if (price === undefined) {
              throw new Error(`Missing mark price for market ${market_id}`);
            }
            return {
              market_id,
              price: String(price),
              producer_id: metadata.producer_id,
              source_timestamp: metadata.source_timestamp,
              sequence: String(metadata.sequence)
            };
          }
        ),
        insurance_fund: this.insuranceFund.snapshot(),
        trading_fee_account: this.tradingFeeAccount.snapshot()
      };

      this.orderbooks.forEach((orderbook, market_id) => {
        const { last_traded_price, last_trade_id } =
          orderbook.fetchMarketData();

        const market_data: SnapshotMarket = {
          market_id,
          last_traded_price: String(last_traded_price),
          last_trade_id: String(last_trade_id),
          orders: orderbook.snapshotOrderbook()
        };

        snapshot.markets.push(market_data);
      });

      const temporaryPath = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(snapshot));
      renameSync(temporaryPath, SNAPSHOT_PATH);
    }, 3000);
  }

  stopSnapshot() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = undefined;
  }

  processEngineOrder(
    request: EngineCommand,
    replayTimestamp?: number
  ): EngineResponse {
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
        case "MARK_PRICE_UPDATE":
          return this.markPriceUpdate(request);
        case "GET_FUNDING_RATE":
          return engine_response("Updating soon", 0);
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
  }

  processEngineCommand(
    request: EngineCommand,
    replayTimestamp?: number,
    sourceMessageId?: string
  ): EngineCommandResult {
    const sourceTimestamp = sourceMessageId
      ? Number(sourceMessageId.split("-")[0])
      : undefined;
    const timestampMs = sourceTimestamp ?? replayTimestamp ?? Date.now();
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
      throw new Error("Invalid engine command timestamp");
    }
    const events = {
      db: [] as DBEventDraft[],
      ws: [] as WSEventDraft[],
      changedBooks: new Set<string>(),
      changedTickers: new Set<string>(),
      candles: new Map<string, CandleDraft>(),
      timestampMs
    };
    this.commandEvents = events;
    this.currentSourceMessageId = sourceMessageId ?? randomUUID();
    this.liquidationOrderSequence = 0;
    try {
      const response = this.processEngineOrder(request, replayTimestamp);
      for (const market_id of events.changedBooks) {
        const orderbook = this.orderbooks.get(market_id);
        if (!orderbook) continue;
        this.emitWsEvent({
          event_type: "BOOK",
          data: { market_id, ...orderbook.getDepth() }
        });
      }
      for (const market_id of events.changedTickers) {
        const orderbook = this.orderbooks.get(market_id);
        if (!orderbook) continue;
        const { last_trade_id, last_traded_price } =
          orderbook.fetchMarketData();
        const mark_price = this.markPrices.get(market_id);
        this.emitWsEvent({
          event_type: "TICKER",
          data: {
            market_id,
            ...(mark_price !== undefined && {
              mark_price: formatFixed(mark_price)
            }),
            ...(last_trade_id && {
              last_trade_id,
              last_traded_price: formatFixed(last_traded_price)
            }),
            ...orderbook.getBestPrices()
          }
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
                  )
                }
              }
            ]
          : events.db;
      this.awaitingEventPublication =
        dbEvents.length > 0 || events.ws.length > 0;
      return { response, dbEvents, wsEvents: events.ws };
    } finally {
      this.commandEvents = null;
      this.currentSourceMessageId = null;
    }
  }

  private emitDbEvent(event: DBEventDraft): void {
    this.commandEvents?.db.push(event);
  }

  private emitWsEvent(event: WSEventDraft): void {
    this.commandEvents?.ws.push(event);
  }

  private markBookChanged(market_id: string): void {
    this.commandEvents?.changedBooks.add(market_id);
    this.commandEvents?.changedTickers.add(market_id);
  }

  private emitTrades(
    market_id: string,
    taker_side: OrderSide,
    fills: Fill[]
  ): void {
    for (const fill of fills) {
      const events = this.commandEvents;
      if (events) {
        const start_ms = Math.floor(events.timestampMs / 60_000) * 60_000;
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
            trade_count: 1
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
          taker_side
        }
      });
    }
  }

  private onramp(request: CommandOf<"ONRAMP">): EngineResponse {
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
            reserved: account.collateral.reserved.toString()
          }
        ],
        orders: [],
        fills: [],
        positions: [],
        market_data: []
      }
    });
    return engine_response("Onramp successfull", 1);
  }

  private getBalance(request: CommandOf<"GET_BALANCE">): EngineResponse {
    const account = this.accounts.get(request.user_id);
    if (!account) {
      return engine_response("Balance Retrieved", 1, {
        available: "0",
        reserved: "0"
      });
    }

    return engine_response("Balance Retrieved", 1, {
      available: formatFixed(account.collateral.available),
      reserved: formatFixed(account.collateral.reserved)
    });
  }

  private settleFilledOrderMargin(
    user_id: string,
    order_margin_consumed: bigint,
    position_margin_added: bigint
  ): void {
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
  }

  private requireFreshMarkPrice(market_id: string) {
    const mark_price = this.markPrices.get(market_id);
    const mark_price_metadata = this.markPriceMetadata.get(market_id);

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
  }

  private placeOrder(request: CommandOf<"PLACE_ORDER">): EngineResponse {
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

      const orderbook = this.orderbooks.get(market_id);
      if (!orderbook) {
        throw new Error("Incorrect Market ID");
      }

      const account = this.accounts.get(user_id);
      if (!account) {
        return engine_response("User Account does not exist", 0);
      }

      if (order.filled < 0n || order.filled >= quantity) {
        throw new Error("Filled quantity must be less than order quantity");
      }

      const mark_price = this.requireFreshMarkPrice(market_id);

      if (!mark_price) {
        throw new Error("Mark Price not found for this market ID");
      }

      const notional = calculateNotional(price, quantity - order.filled);
      const preview_fills = orderbook.previewOrder({
        user_id,
        market_id,
        price,
        quantity,
        leverage,
        ...order
      });
      const preview_filled = preview_fills.reduce(
        (total, fill) => total + fill.quantity,
        0n
      );
      const taker_fee_reserve = preview_fills.reduce(
        (total, fill) =>
          total +
          calculateFee(
            calculateNotional(fill.price, fill.quantity),
            this.TAKER_FEE_RATE ?? 0n
          ),
        0n
      );
      const resting_quantity =
        order.type === OrderType.LIMIT
          ? quantity - order.filled - preview_filled
          : 0n;
      const maker_fee_reserve = calculateFee(
        calculateNotional(price, resting_quantity),
        this.MAKER_FEE_RATE ?? 0n
      );
      const initial_fee = taker_fee_reserve + maker_fee_reserve;
      let initial_margin = calculateInitialMargin(notional, leverage);
      if (order.type === OrderType.MARKET) {
        const current_position = account.positions.get(market_id);
        let position_type = current_position?.type;
        let position_quantity = current_position?.quantity ?? 0n;
        const order_position_type =
          order.side === OrderSide.SELL
            ? PositionType.SHORT
            : PositionType.LONG;
        initial_margin = 0n;

        for (const preview_fill of preview_fills) {
          let opening_qty = preview_fill.quantity;
          if (position_type && position_type !== order_position_type) {
            const closing_qty =
              position_quantity < opening_qty ? position_quantity : opening_qty;
            position_quantity -= closing_qty;
            opening_qty -= closing_qty;
            if (position_quantity === 0n) position_type = undefined;
          }

          if (opening_qty > 0n) {
            initial_margin += calculateInitialMargin(
              calculateNotional(preview_fill.price, opening_qty),
              leverage
            );
            position_type = order_position_type;
            position_quantity += opening_qty;
          }
        }
      }
      if (account.collateral.available < initial_margin + initial_fee) {
        throw new Error("Insufficient funds");
      }

      this.accounts.reserveMargin(user_id, initial_margin + initial_fee);

      const result = orderbook.placeOrder({
        user_id,
        market_id,
        price,
        quantity,
        leverage,
        ...order
      });
      if (result.fills.length !== preview_fills.length) {
        throw new Error("Order book changed between fee preview and execution");
      }
      result.fills.forEach((fill) => {
        fill.taker_fee = calculateFee(
          calculateNotional(fill.price, fill.filled),
          this.TAKER_FEE_RATE ?? 0n
        );
      });
      if (order.type === OrderType.LIMIT || result.fills.length > 0) {
        this.markBookChanged(market_id);
      }
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
      if (result.fills.length > 0) {
        let taker_acc = this.accounts.get(user_id);
        if (!taker_acc) {
          throw new Error("Taker account not registered");
        }

        const order_position_type =
          order.side == OrderSide.SELL ? PositionType.SHORT : PositionType.LONG;
        let taker_remaining = quantity - order.filled;

        const liquidation_risks = new Set<string>();
        let market_position_margin_added = 0n;
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
              amount: fill.taker_fee
            },
            {
              trade_id: fill.trade_id,
              order_id: fill.maker_order_id,
              market_id,
              user_id: fill.maker_user_id,
              role: "MAKER",
              amount: fill.maker_order_fee_consumed
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
              funding_accrued: 0n
            };
            taker_acc?.positions.set(market_id, taker_position);
            this.positionUsersByMarket.get(market_id)?.add(taker_acc.user_id);
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

              const realizedPnl = calcUnrealisedPnL(
                taker_position.type,
                fill.price,
                taker_position.avg_entry_price,
                taker_position.quantity
              );
              this.accounts.credit(taker_acc.user_id, realizedPnl);

              //delete the redundant position
              taker_acc.positions.delete(market_id);
              this.positionUsersByMarket
                .get(market_id)
                ?.delete(taker_acc.user_id);

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
                  funding_accrued: 0n
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
                this.positionUsersByMarket
                  .get(market_id)
                  ?.add(taker_acc.user_id);
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
              funding_accrued: 0n
            };
            maker_acc?.positions.set(market_id, maker_position);
            this.positionUsersByMarket.get(market_id)?.add(maker_acc.user_id);
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

              const realizedPnl = calcUnrealisedPnL(
                maker_position.type,
                fill.price,
                maker_position.avg_entry_price,
                maker_position.quantity
              );
              this.accounts.credit(maker_acc.user_id, realizedPnl);

              //delete the redundant position
              maker_acc.positions.delete(market_id);
              this.positionUsersByMarket
                .get(market_id)
                ?.delete(maker_acc.user_id);

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
                  funding_accrued: 0n
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
                this.positionUsersByMarket
                  .get(market_id)
                  ?.add(maker_acc.user_id);
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

        if (
          order.type === OrderType.MARKET &&
          initial_margin > market_position_margin_added
        ) {
          this.accounts.releaseMargin(
            user_id,
            initial_margin - market_position_margin_added
          );
        }

        for (const affected_user_id of liquidation_risks) {
          this.liquidationCheck({ user_id: affected_user_id, market_id });
        }
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
          slippage: 0n
        }
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
        )
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
          reserved: affected_account.collateral.reserved
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
                  funding_accrued: position.funding_accrued
                }
              : null
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
          maker_order_status: fill_item.maker_order_status
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
          )
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
            taker_fee: formatFixed(taker_fee)
          };
        })
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
          trading_fee_account: trading_fee_change
        }
      });

      return engine_response("Order placed successfully", 1, response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return engine_response(err.message, 0, null);
    }
  }

  private cancelOrder(request: CommandOf<"CANCEL_ORDER">): EngineResponse {
    const { action, ...cancel_request } = request;
    const orderbook = this.orderbooks.get(cancel_request.market_id);
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
            reserved: account.collateral.reserved
          }
        ],
        orders: [],
        order_updates: [
          {
            order_id,
            user_id: request.user_id,
            market_id: request.market_id,
            status: OrderStatus.CANCELLED,
            remaining_order_margin: 0n,
            remaining_order_fee: 0n
          }
        ],
        fills: [],
        positions: [],
        market_data: []
      }
    });

    return engine_response("Order cancelled successfully", 1, {
      order_id,
      rem_qty: formatFixed(rem_qty),
      price: formatFixed(price),
      released_fee: formatFixed(remaining_order_fee)
    });
  }

  private getDepth(request: CommandOf<"GET_DEPTH">): EngineResponse {
    const orderbook = this.orderbooks.get(request.market_id);
    if (!orderbook) {
      throw new Error("Incorrect Market ID");
    }

    const response = orderbook.getDepth();
    return engine_response("Depth fetched successfully", 1, { ...response });
  }

  private getPosition(request: CommandOf<"GET_POSITION">): EngineResponse {
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
      funding_accrued: formatFixed(position.funding_accrued)
    };

    return engine_response("Position fetched successfully", 1, { ...response });
  }

  private liquidationCheck({
    user_id,
    market_id
  }: {
    user_id: string;
    market_id: string;
  }) {
    const account = this.accounts.get(user_id);
    const position = account?.positions.get(market_id);
    if (!account || !position) return;
    const orderbook = this.orderbooks.get(market_id);
    if (!orderbook) {
      throw new Error("Incorrect Market ID");
    }

    const mark_price = this.requireFreshMarkPrice(market_id);
    position.unrealized_pnl = calcUnrealisedPnL(
      position.type,
      mark_price,
      position.avg_entry_price,
      position.quantity
    );

    const position_equity = position.reserved_margin + position.unrealized_pnl;
    const maintenance_margin_rate = this.MAINTENANCE_MARGIN_RATE;

    const mark_notional = calculateNotional(mark_price, position.quantity);
    const maintenance_requirement =
      calculateMaintenanceMargin(mark_notional, maintenance_margin_rate) +
      calculateFee(mark_notional, this.LIQUIDATION_FEE_RATE ?? 0n);

    if (position_equity <= maintenance_requirement) {
      //trigger liquidity
      const liquidation_quantity = position.quantity;

      // Cancel only resting orders in the liquidated market. Isolated margin
      // and orders in other markets must remain available to the user.
      for (const open_order_id of [...account.orders]) {
        if (!orderbook.hasOrder(open_order_id)) continue;

        this.cancelOrder({
          action: "CANCEL_ORDER",
          user_id,
          order_id: open_order_id,
          market_id
        });
      }

      const order_id = generate_liquidation_order_id(
        this.currentSourceMessageId ?? randomUUID(),
        user_id,
        market_id,
        this.liquidationOrderSequence++
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
      let consumed_position_margin = 0n;
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
        const allocated_margin =
          fill.filled === remaining_liquidation_quantity
            ? remaining_position_margin
            : divideRounded(
                remaining_position_margin * fill.filled,
                remaining_liquidation_quantity,
                "floor"
              );
        const realized_pnl = calcUnrealisedPnL(
          position.type,
          fill.price,
          position.avg_entry_price,
          fill.filled
        );
        const requested_liquidation_fee = calculateFee(
          calculateNotional(fill.price, fill.filled),
          this.LIQUIDATION_FEE_RATE
        );
        fund_settlement_inputs.push({
          entry_id_prefix: `${order_id}:${fill.trade_id}`,
          market_id,
          user_id,
          liquidation_order_id: order_id,
          execution_equity: allocated_margin + realized_pnl,
          requested_liquidation_fee
        });
        consumed_position_margin += allocated_margin;
        remaining_position_margin -= allocated_margin;
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
          amount: fill.maker_order_fee_consumed
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
            funding_accrued: 0n
          };
          maker_acc?.positions.set(market_id, maker_position);
          this.positionUsersByMarket.get(market_id)?.add(maker_acc.user_id);
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

            const realizedPnl = calcUnrealisedPnL(
              maker_position.type,
              fill.price,
              maker_position.avg_entry_price,
              maker_position.quantity // full close
            );
            this.accounts.credit(maker_acc.user_id, realizedPnl);

            //delete the redundant position
            maker_acc.positions.delete(market_id);
            this.positionUsersByMarket
              .get(market_id)
              ?.delete(maker_acc.user_id);

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
                funding_accrued: 0n
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
              this.positionUsersByMarket.get(market_id)?.add(maker_acc.user_id);
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
        insurance_fund_changes.push({
          collateral_asset: fund_settlement.collateral_asset,
          balance: fund_settlement.balance,
          total_liquidation_fees: fund_settlement.total_liquidation_fees,
          total_liquidation_surplus: fund_settlement.total_liquidation_surplus,
          total_shortfall_covered: fund_settlement.total_shortfall_covered,
          total_uncovered_shortfall: fund_settlement.total_uncovered_shortfall,
          entries: fund_settlement.entries
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
      position.quantity = remaining_liquidation_quantity;

      if (response.rem_qty != 0n) {
        position.unrealized_pnl = calcUnrealisedPnL(
          position.type,
          mark_price,
          position.avg_entry_price,
          position.quantity
        );
      } else {
        //delete the redundant position
        this.accounts.get(user_id)?.positions.delete(market_id);
        this.positionUsersByMarket.get(market_id)?.delete(user_id);
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
                    : OrderStatus.PARTIALLY_FILLED,
                price: mark_price,
                quantity: liquidation_quantity,
                filled: response.filled,
                // Close-only liquidation has no order leverage or reserved margin.
                leverage: 0n,
                initial_margin: 0n,
                initial_fee: 0n,
                remaining_order_margin: 0n,
                remaining_order_fee: 0n,
                slippage: 0n
              }
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
        maker_order_status: fill.maker_order_status
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
                funding_accrued: current_position.funding_accrued
              }
            : null
        };
      });

      this.emitDbEvent({
        event_type: "LIQUIDATION",
        changes: {
          balances: affected_accounts.map((account) => ({
            user_id: account.user_id,
            available: account.collateral.available,
            reserved: account.collateral.reserved
          })),
          orders: db_update_order,
          fills: db_update_fills,
          positions: db_update_positions,
          market_data: [
            {
              market_id,
              mark_price,
              ...(response.fills.length > 0 ? orderbook.fetchMarketData() : {})
            }
          ],
          insurance_fund: insurance_fund_changes,
          trading_fee_account: trading_fee_changes
        }
      });

      for (const affected_user_id of liquidation_risks) {
        this.liquidationCheck({ user_id: affected_user_id, market_id });
      }
    }
  }

  private markPriceUpdate(
    request: CommandOf<"MARK_PRICE_UPDATE">
  ): EngineResponse {
    const { market_id, mark_price, source_timestamp, producer_id, sequence } =
      request;

    if (!this.orderbooks.has(market_id)) {
      return engine_response("Incorrect Market ID", 0);
    }

    if (mark_price <= 0) {
      return engine_response("Invalid mark price", 0);
    }

    const parsed_sequence = BigInt(sequence);
    const latest_metadata = this.markPriceMetadata.get(market_id);
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

    this.markPrices.set(market_id, mark_price);
    this.markPriceMetadata.set(market_id, {
      producer_id,
      source_timestamp,
      sequence: parsed_sequence
    });
    this.commandEvents?.changedTickers.add(market_id);
    this.emitDbEvent({
      event_type: "MARK_PRICE_UPDATE",
      changes: { market_data: [{ market_id, mark_price }] }
    });

    const users_with_position = this.positionUsersByMarket.get(market_id);

    if (!users_with_position?.size) {
      return engine_response("No positions to recalibrate", 1, {
        response: "res"
      });
    }

    for (const user_id of users_with_position) {
      this.liquidationCheck({ user_id, market_id });
    }
    return engine_response("Positions recalibrated successfully", 1, null);
  }
}

export default Engine;
