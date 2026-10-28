import { divideRounded, formatFixed } from "./math/fixed-point";
import type { Fill } from "./types";
import { engine_response } from "./utils";
import type { EngineCommand } from "./zod/z";
import Orderbook from "./orderbook";
import AccountStore from "./accounts";
import BTree from "sorted-btree";
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

type CommandOf<Action extends EngineCommand["action"]> = Extract<
  EngineCommand,
  { action: Action }
>;

//TODO: Add a crash recovery system that has orderbooks from all markets and also feeds the orderbooks
class Engine {
  private orderbooks = new Map<string, Orderbook>();
  private accounts = new AccountStore();
  private markPrices = new Map<string, bigint>();
  private markPriceMetadata = new Map<
    string,
    { producer_id: string; source_timestamp: number; sequence: bigint }
  >();
  private readonly MAX_MARK_PRICE_AGE_MS = 5_000;
  private readonly MAX_MARK_PRICE_CLOCK_SKEW_MS = 1_000;
  private MAINTENANCE_MARGIN_RATE: bigint;
  private positionUsersByMarket = new Map<string, Set<string>>(); //market->users>

  constructor() {
    //Logic to read from recovery system
    this.orderbooks.set(
      "market123",
      new Orderbook(new BTree(), new BTree(), new Map(), 0n, "")
    );
    this.accounts.getOrCreate("user123");
    this.positionUsersByMarket.set(
      "market123",
      new Set(["user-1", "user-2", "user-3"])
    );
    this.MAINTENANCE_MARGIN_RATE = MARKET_CONFIG.MAINTENANCE_MARGIN_RATE;
  }

  processEngineOrder = (request: EngineCommand): EngineResponse => {
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
      Date.now() - mark_price_metadata?.source_timestamp >
        this.MAX_MARK_PRICE_AGE_MS
    ) {
      throw new Error("Fresh mark price does not exist");
    }

    return mark_price;
  }

  private placeOrder(request: CommandOf<"PLACE_ORDER">): EngineResponse {
    const { action, market_id, leverage, user_id, price, quantity, ...order } =
      request;

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
    const initial_margin = calculateInitialMargin(notional, leverage);
    if (account.collateral.available < initial_margin) {
      throw new Error("Insufficient funds");
    }

    this.accounts.reserveMargin(user_id, initial_margin);

    const result = orderbook.place_order({
      user_id,
      market_id,
      price,
      quantity,
      leverage,
      ...order,
    });

    if (
      result.order.status == OrderStatus.OPEN ||
      result.order.status == OrderStatus.PARTIALLY_FILLED
    ) {
      account.orders.add(result.order.order_id);
    } else if (result.order.status === OrderStatus.FILLED) {
      account.orders.delete(result.order.order_id);
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
              this.positionUsersByMarket.get(market_id)?.add(taker_acc.user_id);
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

        this.settleFilledOrderMargin(
          taker_acc.user_id,
          taker_order_margin_consumed,
          taker_position_margin_added
        );

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
      }

      for (const affected_user_id of liquidation_risks) {
        this.liquidationCheck({ user_id: affected_user_id, market_id });
      }
    }
    const response = {
      order: {
        ...result.order,
        filled: formatFixed(result.order.filled),
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

      //TODO: Uncomment after market order is implemented
      // this.placeOrder({
      //   action: "PLACE_ORDER",
      //   user_id,
      //   market_id,
      //   order_id,
      //   price: 0n,
      //   quantity: position.quantity,
      //   leverage: 1n,
      //   filled: 0n,
      //   type: OrderType.MARKET,
      //   status: OrderStatus.OPEN,
      //   side,
      // });

      //release the prev margin + realise the PnL
      // this.accounts.releaseMargin(user_id, position.reserved_margin);

      // this.accounts.credit(user_id, position.unrealized_pnl);

      //delete the redundant position
      // this.accounts.get(user_id)?.positions.delete(market_id);
      // this.positionUsersByMarket.get(market_id)?.delete(user_id);
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
    const now = Date.now();

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
