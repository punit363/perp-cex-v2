import { divideRounded, formatFixed, multiplyFixed, SCALE } from "./math/fixed-point";
import type {
  EngineSnapshot,
  Fill,
  markPriceMetadata,
  SnapshotMarket,
} from "./types";
import { engine_response } from "./utils";
import type { EngineCommand } from "./zod/z";
import { EngineSnapshotSchema } from "./zod/z";
import Orderbook from "./orderbook";
import AccountStore from "./accounts";
import {
  calculateInitialMargin,
  calculateMaintenanceMargin,
  calculateNotional,
} from "./math/financial-math";
import type { EngineResponse } from "commons/src/index";
import {
  OrderSide,
  OrderStatus,
  OrderType,
  PositionType,
} from "commons/src/order.type";
import { calcAvgPrice, calcUnrealisedPnL } from "./perp";
import MARKET_CONFIG from "./config/market.config";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SNAPSHOT_PATH = fileURLToPath(new URL("../snapshot.json", import.meta.url));

type CommandOf<Action extends EngineCommand["action"]> = Extract<
  EngineCommand,
  { action: Action }
>;

class Engine {
  private orderbooks: Map<string, Orderbook> = new Map();
  private accounts = new AccountStore([]);
  private markPrices: Map<string, bigint> = new Map();
  private markPriceMetadata: Map<string, markPriceMetadata> = new Map();
  private positionUsersByMarket: Map<string, Set<string>> = new Map(); //market->users>
  private readonly MAX_MARK_PRICE_AGE_MS;
  private readonly MAX_MARK_PRICE_CLOCK_SKEW_MS;
  private MAINTENANCE_MARGIN_RATE: bigint;
  private lastAppliedStreamId = "0-0";
  private replayTimestamp: number | null = null;

  private constructor(marketIds: string[]) {
    this.MAX_MARK_PRICE_AGE_MS = MARKET_CONFIG.MAX_MARK_PRICE_AGE_MS;
    this.MAX_MARK_PRICE_CLOCK_SKEW_MS =
      MARKET_CONFIG.MAX_MARK_PRICE_CLOCK_SKEW_MS;
    this.MAINTENANCE_MARGIN_RATE = MARKET_CONFIG.MAINTENANCE_MARGIN_RATE;

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
      this.lastAppliedStreamId = snapshot.last_applied_stream_id;
      snapshot.mark_prices.forEach((mark) => {
        this.markPrices.set(mark.market_id, BigInt(mark.price));
        this.markPriceMetadata.set(mark.market_id, {
          producer_id: mark.producer_id,
          source_timestamp: mark.source_timestamp,
          sequence: BigInt(mark.sequence),
        });
      });

      this.accounts = new AccountStore(snapshot.accounts);

      snapshot.markets.forEach((market_data) => {
        const orderbook = new Orderbook(market_data);
        this.orderbooks.set(market_data.market_id, orderbook);
        this.positionUsersByMarket.set(market_data.market_id, new Set());

        market_data.orders.forEach((order) => {
          const account = this.accounts.get(order.user_id);
          if (!account) {
            throw new Error(`Snapshot order ${order.order_id} has no account`);
          }
          account.orders.add(order.order_id);
        });
      });

      snapshot.accounts.forEach((account) => {
        account.positions.forEach((position) => {
          let positionUsers = this.positionUsersByMarket.get(position.market_id);
          if (!positionUsers) {
            positionUsers = new Set<string>();
            this.positionUsersByMarket.set(position.market_id, positionUsers);
          }
          positionUsers.add(account.user_id);
        });
      });
    }

    for (const market_id of marketIds) {
      if (!this.orderbooks.has(market_id)) {
        this.orderbooks.set(
          market_id,
          new Orderbook({
            market_id,
            last_traded_price: "0",
            last_trade_id: "",
            orders: [],
          })
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
    const marketIds = (await MarketRepo.listMarkets()).map((market) => market.market_id);
    return new Engine(marketIds);
  }

  getLastAppliedStreamId(): string {
    return this.lastAppliedStreamId;
  }

  recordAppliedStreamId(streamId: string): void {
    this.lastAppliedStreamId = streamId;
  }

  captureSnapshot() {
    setInterval(() => {
      const snapshot: EngineSnapshot = {
        version: 2,
        snapshot_time: Date.now(),
        scale: Number(SCALE),
        last_applied_stream_id: this.lastAppliedStreamId,
        markets: [],
        accounts: this.accounts.snapshotAccount(),
        mark_prices: Array.from(this.markPriceMetadata, ([market_id, metadata]) => {
          const price = this.markPrices.get(market_id);
          if (price === undefined) {
            throw new Error(`Missing mark price for market ${market_id}`);
          }
          return {
            market_id,
            price: String(price),
            producer_id: metadata.producer_id,
            source_timestamp: metadata.source_timestamp,
            sequence: String(metadata.sequence),
          };
        }),
      };

      this.orderbooks.forEach((orderbook, market_id) => {
        const { last_traded_price, last_trade_id } =
          orderbook.fetchMarketData();

        const market_data: SnapshotMarket = {
          market_id,
          last_traded_price: String(last_traded_price),
          last_trade_id: String(last_trade_id),
          orders: orderbook.snapshotOrderbook(),
        };

        snapshot.markets.push(market_data);
      });

      const temporaryPath = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(snapshot));
      renameSync(temporaryPath, SNAPSHOT_PATH);
    }, 3000);
  }

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
  };

  private onramp(request: CommandOf<"ONRAMP">): EngineResponse {
    if (request.amount <= 0n) {
      return engine_response("Cannot ramp negative value", 0);
    }

    this.accounts.credit(request.user_id, request.amount);
    return engine_response("Onramp successfull", 1);
  }

  private getBalance(request: CommandOf<"GET_BALANCE">): EngineResponse {
    const account = this.accounts.get(request.user_id);
    if (!account) {
      return engine_response("User Account does not exist", 0);
    }

    return engine_response("Balance Retrieved", 1, {
      available: formatFixed(account.collateral.available),
      reserved: formatFixed(account.collateral.reserved),
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
      (this.replayTimestamp ?? Date.now()) - mark_price_metadata?.source_timestamp >
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

        for (const preview_fill of orderbook.previewMarketOrder({
          user_id,
          market_id,
          price,
          quantity,
          leverage,
          ...order,
        })) {
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
      if (account.collateral.available < initial_margin) {
        throw new Error("Insufficient funds");
      }

      this.accounts.reserveMargin(user_id, initial_margin);

      const result = orderbook.placeOrder({
        user_id,
        market_id,
        price,
        quantity,
        leverage,
        ...order,
      });

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
        for (const fill of result.fills) {
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
              funding_accrued: 0n,
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
            // taker_position.unrealized_pnl = calcUnrealisedPnL(
            //   order_position_type,
            //   mark_price,
            //   taker_position.avg_entry_price,
            //   taker_position.quantity
            // );

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
                taker_position.quantity // full close
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
                  funding_accrued: 0n,
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
                //TODO: where does current_market_price come from?
                // taker_position.unrealized_pnl = calcUnrealisedPnL(
                //   order_position_type,
                //   mark_price,
                //   taker_position.avg_entry_price,
                //   rem_qty
                // );

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
              // taker_position.unrealized_pnl = calcUnrealisedPnL(
              //   taker_position.type,
              //   mark_price,
              //   taker_position.avg_entry_price,
              //   taker_position.quantity
              // );

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
            // maker_position.unrealized_pnl = calcUnrealisedPnL(
            //   maker_position.type,
            //   mark_price,
            //   maker_position.avg_entry_price,
            //   maker_position.quantity
            // );
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
                  type:
                    order_position_type == PositionType.LONG
                      ? PositionType.SHORT
                      : PositionType.LONG,
                  quantity: 0n,
                  reserved_margin: 0n,
                  unrealized_pnl: 0n,
                  avg_entry_price: 0n,
                  funding_accrued: 0n,
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
                // maker_position.unrealized_pnl = calcUnrealisedPnL(
                //   maker_position.type,
                //   mark_price,
                //   maker_position.avg_entry_price,
                //   rem_qty
                // );

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
              // maker_position.unrealized_pnl = calcUnrealisedPnL(
              //   maker_position.type,
              //   mark_price,
              //   maker_position.avg_entry_price,
              //   maker_position.quantity
              // );
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
      const response = {
        order: {
          ...result.order,
          filled: formatFixed(result.order.filled),
          rem_qty: formatFixed(result.order.rem_qty),
          rem_amt: formatFixed(result.order.rem_amt),
        },
        fills: result.fills.map((fill_item: Fill) => {
          const {
            price,
            filled,
            maker_leverage,
            maker_order_margin_consumed,
            ...fill
          } = fill_item;

          return {
            ...fill,
            price: formatFixed(price),
            filled: formatFixed(filled),
          };
        }),
      };

      // this.accounts.reserveMargin(user_id, initial_margin);

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

    const cancelResult = orderbook.cancelOrder(cancel_request);
    if (!cancelResult) {
      throw new Error("Cancel order failed");
    }

    const { order_id, rem_qty, price, leverage } = cancelResult;
    const notional = calculateNotional(price, rem_qty);
    const initial_margin = calculateInitialMargin(notional, leverage);
    this.accounts.releaseMargin(request.user_id, initial_margin);
    this.accounts.get(cancel_request.user_id)?.orders.delete(order_id);

    return engine_response("Order cancelled successfully", 1, {
      order_id,
      rem_qty: formatFixed(rem_qty),
      price: formatFixed(price),
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
      funding_accrued: formatFixed(position.funding_accrued),
    };

    return engine_response("Position fetched successfully", 1, { ...response });
  }

  private liquidationCheck({
    user_id,
    market_id,
  }: {
    user_id: string;
    market_id: string;
  }) {
    const position = this.accounts.get(user_id)?.positions.get(market_id);
    if (!position) return;

    const mark_price = this.requireFreshMarkPrice(market_id);
    position.unrealized_pnl = calcUnrealisedPnL(
      position.type,
      mark_price,
      position.avg_entry_price,
      position.quantity
    );

    const position_equity = position.reserved_margin + position.unrealized_pnl;
    const maintenance_margin_rate = this.MAINTENANCE_MARGIN_RATE;

    const maintenance_requirement = calculateMaintenanceMargin(
      calculateNotional(mark_price, position.quantity),
      maintenance_margin_rate
    );

    if (position_equity <= maintenance_requirement) {
      //trigger liquidity

      //cancel all open orders
      this.accounts.get(user_id)?.orders.forEach((order_id: string) => {
        this.cancelOrder({
          action: "CANCEL_ORDER",
          user_id,
          order_id,
          market_id,
        });
      });

      this.accounts.get(user_id)?.orders.clear();

      const order_id = "odr_" + Math.random().toString();

      const side =
        position.type == PositionType.LONG ? OrderSide.SELL : OrderSide.BUY;

      const response = this.orderbooks
        .get(market_id)
        ?.matchToClose(user_id, order_id, side, position.quantity);

      const liquidation_risks = new Set<string>();
      let net_margin_recovered = 0n;
      response?.fills.forEach((fill: Fill) => {
        //handle taker position
        let margin_recovered = 0n;
        if (side == OrderSide.BUY) {
          margin_recovered = multiplyFixed(
            fill.price - position.avg_entry_price,
            fill.filled,
            "ceil"
          );
        } else {
          margin_recovered = multiplyFixed(
            position.avg_entry_price - fill.price,
            fill.filled,
            "ceil"
          );
        }
        net_margin_recovered += margin_recovered;

        //handle maker position
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
            type: position.type,
            quantity: 0n,
            reserved_margin: 0n,
            unrealized_pnl: 0n,
            avg_entry_price: 0n,
            funding_accrued: 0n,
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
          // maker_position.unrealized_pnl = calcUnrealisedPnL(
          //   maker_position.type,
          //   mark_price,
          //   maker_position.avg_entry_price,
          //   maker_position.quantity
          // );
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
                funding_accrued: 0n,
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
              // maker_position.unrealized_pnl = calcUnrealisedPnL(
              //   maker_position.type,
              //   mark_price,
              //   maker_position.avg_entry_price,
              //   rem_qty
              // );

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
            // maker_position.unrealized_pnl = calcUnrealisedPnL(
            //   maker_position.type,
            //   mark_price,
            //   maker_position.avg_entry_price,
            //   maker_position.quantity
            // );
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

      for (const affected_user_id of liquidation_risks) {
        this.liquidationCheck({ user_id: affected_user_id, market_id });
      }

      //release the prev margin + realise the PnL
      this.accounts.debitMargin(user_id, net_margin_recovered);
      position.reserved_margin -= net_margin_recovered!;

      if (response?.rem_qty != 0n) {
        position.quantity -= response?.filled!;
        position.unrealized_pnl = calcUnrealisedPnL(
          position.type,
          mark_price,
          position.avg_entry_price,
          position.quantity
        );
      } else {
        //delete the redundant position
        this.accounts.releaseMargin(user_id, position.reserved_margin);
        this.accounts.get(user_id)?.positions.delete(market_id);
        this.positionUsersByMarket.get(market_id)?.delete(user_id);
      }
    }
  }

  private markPriceUpdate(
    request: CommandOf<"MARK_PRICE_UPDATE">
  ): EngineResponse {
    const { market_id, mark_price, source_timestamp, producer_id, sequence } =
      request;

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
      sequence: parsed_sequence,
    });

    const users_with_position = this.positionUsersByMarket.get(market_id);

    if (!users_with_position?.size) {
      return engine_response("No positions to recalibrate", 1, {
        response: "res",
      });
    }

    for (const user_id of users_with_position) {
      this.liquidationCheck({ user_id, market_id });
    }
    return engine_response("Positions recalibrated successfully", 1, null);
  }
}

export default Engine;
