import BTree from "sorted-btree";
import type { Fill, Order, OrderNode, PriceLevel } from "./types";
import { divideFixed, formatFixed, multiplyFixed } from "./math/fixed-point";
import { generate_trade_id, min } from "./utils";
import { OrderSide, OrderStatus, OrderType } from "commons/src/order.type";
import {
  calculateInitialMargin,
  calculateNotional,
} from "./math/financial-math";

class Orderbook {
  private asks = new BTree<bigint, PriceLevel>(undefined, this.comparePrice);
  private bids = new BTree<bigint, PriceLevel>(undefined, this.comparePrice);
  private orders = new Map<string, OrderNode>();
  private lastTradedPrice: bigint;
  private lastTradeId: string;

  constructor(
    asks: BTree<bigint, PriceLevel>,
    bids: BTree<bigint, PriceLevel>,
    orders: Map<string, OrderNode>,
    lastTradedPrice: bigint,
    lastTradeId: string
  ) {
    this.asks = asks;
    this.bids = bids;
    this.orders = orders;
    this.lastTradedPrice = lastTradedPrice;
    this.lastTradeId = lastTradeId;
  }

  private comparePrice(a: bigint, b: bigint) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  private remainingOrderMargin(node: OrderNode): bigint {
    return calculateInitialMargin(
      calculateNotional(node.level.price, node.quantity - node.filled),
      node.leverage
    );
  }

  private updateMarketData(fills: Fill[]) {
    if (fills.length > 0) {
      const lastFill = fills[fills.length - 1];
      if (lastFill) {
        this.lastTradeId = lastFill.trade_id;
        this.lastTradedPrice = lastFill.price;
      }
    }
  }

  public fetchMarketData() {
    return {
      last_trade_id: this.lastTradeId,
      last_traded_price: this.lastTradedPrice,
    };
  }

  insertOrder(order: Order) {
    const price = order.price;
    const quantity = order.quantity;
    const filled = order.filled;

    if (order.type == OrderType.LIMIT) {
      if (price <= 0n || quantity <= 0n) {
        throw new Error("Price and Quatity cannot be negative");
      }
      let price_level;

      if (order.side == OrderSide.SELL) {
        price_level = this.asks.get(price);
        if (!price_level) {
          price_level = {
            price: order.price,
            remaining_qty: 0n,
            head: null,
            tail: null,
          };
          this.asks.set(price, price_level);
        }
      } else if (order.side == OrderSide.BUY) {
        price_level = this.bids.get(order.price);
        if (!price_level) {
          price_level = {
            price: order.price,
            remaining_qty: 0n,
            head: null,
            tail: null,
          };
        }
        this.bids.set(price, price_level);
      } else {
        throw new Error("Order side must be buy or sell");
      }

      price_level.remaining_qty += quantity - filled;

      const order_node: OrderNode = {
        order_id: order.order_id,
        user_id: order.user_id,
        quantity,
        filled: order.filled,
        leverage: order.leverage,
        level: price_level,
        side: order.side,
        prev: null,
        next: null,
      };

      order_node.prev = price_level.tail;
      if (price_level.tail) {
        price_level.tail.next = order_node;
      } else {
        price_level.head = order_node;
      }
      price_level.tail = order_node;

      this.orders.set(order_node.order_id, order_node);
    } else if (order.type == "MARKET") {
      //TODO:To be implemented
    } else {
      throw new Error("Order type must be limit or market");
    }
  }

  cancelOrder(cancel: { user_id: string; order_id: string }) {
    const { user_id, order_id } = cancel;

    const order = this.orders.get(order_id);
    if (!order) {
      throw new Error("This order does not exist");
    }

    if (user_id != order.user_id) {
      throw new Error("User can only create self created orders");
    }

    let price_level;

    if (order.side == "SELL") {
      price_level = this.asks.get(order.level.price);
    } else if (order.side == "BUY") {
      price_level = this.bids.get(order.level.price);
    } else {
      throw new Error("Order side must be buy or sell");
    }

    if (!price_level) {
      this.orders.delete(order_id);
      return;
    }

    const rem_qty = order.quantity - order.filled;
    const price = price_level.price;

    price_level.remaining_qty -= order.quantity - order.filled;
    if (price_level.remaining_qty <= 0) {
      order.side == "SELL"
        ? this.asks.delete(order.level.price)
        : this.bids.delete(order.level.price);
    } else {
      if (price_level.head == order) {
        price_level.head = order.next;
      }
      if (price_level.tail == order) {
        price_level.tail = order.prev;
      }
    }

    if (order.prev) {
      order.prev.next = order.next;
    }
    if (order.next) {
      order.next.prev = order.prev;
    }

    this.orders.delete(order_id);

    return {
      order_id,
      rem_qty,
      price,
      leverage: order.leverage,
    };
  }

  removeOrder(odr: OrderNode) {
    if (odr.prev) odr.prev.next = odr.next;
    if (odr.next) odr.next.prev = odr.prev;
    if (odr.level.head == odr) odr.level.head = odr.next;
    if (odr.level.tail == odr) odr.level.tail = odr.prev;
    this.orders.delete(odr.order_id);
  }

  getDepth() {
    let asks: {
      price: string;
      quantity: string;
    }[] = [];
    let bids: {
      price: string;
      quantity: string;
    }[] = [];

    for (const [price, level] of this.asks.entries()) {
      asks.push({
        price: formatFixed(price),
        quantity: formatFixed(level.remaining_qty),
      });
    }

    for (const [price, level] of this.bids.entriesReversed()) {
      bids.push({
        price: formatFixed(price),
        quantity: formatFixed(level.remaining_qty),
      });
    }

    let depth = {
      asks,
      bids,
    };

    return depth;
  }

  process_sell_order(order: Order) {
    const odr_price = order.price;
    const odr_quantity = order.quantity;
    let odr_filled = order.filled;

    const fills: Fill[] = [];

    if (order.type == "LIMIT") {
      let pair = this.bids.nextLowerPair(undefined);
      while (pair && odr_filled < odr_quantity) {
        const [price, level] = pair;
        if (price < odr_price) break;

        let current_node = level.head;

        while (odr_filled != odr_quantity) {
          if (!current_node) break;
          let { user_id, order_id, quantity, next } = current_node;

          const rem_odr_qty = odr_quantity - odr_filled;
          const fill_qty = min(rem_odr_qty, quantity - current_node.filled);
          const margin_before = this.remainingOrderMargin(current_node);

          odr_filled += fill_qty;
          current_node.filled += fill_qty;
          level.remaining_qty -= fill_qty;
          const maker_order_margin_consumed =
            margin_before - this.remainingOrderMargin(current_node);

          let maker_order_status = OrderStatus.OPEN;
          if (quantity == current_node.filled) {
            maker_order_status = OrderStatus.FILLED;
            this.removeOrder(current_node);
          } else if (current_node.filled > 0) {
            maker_order_status = OrderStatus.PARTIALLY_FILLED;
          }

          const fill: Fill = {
            trade_id: generate_trade_id(),
            maker_order_id: order_id,
            maker_user_id: user_id,
            taker_order_id: order.order_id,
            taker_user_id: order.user_id,
            price,
            maker_leverage: current_node.leverage,
            maker_order_margin_consumed,
            maker_order_status,
            filled: fill_qty,
          };
          fills.push(fill);

          current_node = next;
        }
        if (level.remaining_qty == 0n) {
          this.bids.delete(price);
        }
        pair = this.bids.nextLowerPair(price);
      }

      if (odr_quantity - odr_filled) {
        odr_filled == 0n
          ? (order.status = OrderStatus.OPEN)
          : (order.status = OrderStatus.PARTIALLY_FILLED);
        this.insertOrder({ ...order, filled: odr_filled });
      } else {
        order.status = OrderStatus.FILLED;
      }
    }

    let rem_qty: bigint = 0n;
    if (order.type == "MARKET" && order.quantity > 0n) {
      let pair = this.bids.nextLowerPair(undefined);

      while (pair) {
        const [price, level] = pair;
        if (odr_quantity == odr_filled) break;

        let current_node = level.head;

        while (odr_filled != odr_quantity) {
          if (!current_node) break;
          let { user_id, order_id, quantity, next } = current_node;

          const rem_odr_qty = odr_quantity - odr_filled;
          const fill_qty = min(rem_odr_qty, quantity - current_node.filled);
          const margin_before = this.remainingOrderMargin(current_node);

          odr_filled += fill_qty;
          current_node.filled += fill_qty;
          level.remaining_qty -= fill_qty;
          const maker_order_margin_consumed =
            margin_before - this.remainingOrderMargin(current_node);

          let maker_order_status = OrderStatus.OPEN;
          if (quantity == current_node.filled) {
            maker_order_status = OrderStatus.FILLED;
            this.removeOrder(current_node);
          } else if (current_node.filled > 0) {
            maker_order_status = OrderStatus.PARTIALLY_FILLED;
          }

          const fill: Fill = {
            trade_id: generate_trade_id(),
            maker_order_id: order_id,
            maker_user_id: user_id,
            taker_order_id: order.order_id,
            taker_user_id: order.user_id,
            price,
            maker_leverage: current_node.leverage,
            maker_order_margin_consumed,
            maker_order_status,
            filled: fill_qty,
          };
          fills.push(fill);

          current_node = next;
        }
        if (level.remaining_qty == 0n) {
          this.bids.delete(price);
        }
        pair = this.bids.nextLowerPair(price);
      }

      if (odr_quantity > odr_filled) {
        rem_qty += odr_quantity - odr_filled;
      }
      order.status = OrderStatus.FILLED;
    }

    this.updateMarketData(fills);
    return {
      order: {
        order_id: order.order_id,
        filled: odr_filled,
        status: order.status,
        rem_qty,
        rem_amt: 0n,
      },
      fills,
    };
  }

  process_buy_order(order: Order) {
    const odr_price = order.price;
    const odr_quantity = order.quantity;
    let odr_filled = order.filled;
    const fills: Fill[] = [];

    if (order.type == "LIMIT") {
      let pair = this.asks.nextHigherPair(undefined);
      while (pair && odr_filled < odr_quantity) {
        const [price, level] = pair;
        if (price > odr_price) break;

        let current_node = level.head;

        while (odr_filled != odr_quantity) {
          if (!current_node) break;
          let { user_id, order_id, quantity, next } = current_node;

          const rem_odr_qty = odr_quantity - odr_filled;
          const fill_qty = min(rem_odr_qty, quantity - current_node.filled);
          const margin_before = this.remainingOrderMargin(current_node);

          odr_filled += fill_qty;
          current_node.filled += fill_qty;
          level.remaining_qty -= fill_qty;
          const maker_order_margin_consumed =
            margin_before - this.remainingOrderMargin(current_node);
          let maker_order_status = OrderStatus.OPEN;
          if (quantity == current_node.filled) {
            maker_order_status = OrderStatus.FILLED;
            this.removeOrder(current_node);
          } else if (current_node.filled > 0) {
            maker_order_status = OrderStatus.PARTIALLY_FILLED;
          }

          const fill: Fill = {
            trade_id: generate_trade_id(),
            maker_order_id: order_id,
            maker_user_id: user_id,
            taker_order_id: order.order_id,
            taker_user_id: order.user_id,
            maker_leverage: current_node.leverage,
            maker_order_margin_consumed,
            price,
            maker_order_status,
            filled: fill_qty,
          };
          fills.push(fill);

          current_node = next;
        }
        if (level.remaining_qty == 0n) {
          this.asks.delete(price);
        }
        pair = this.asks.nextHigherPair(price);
      }

      if (odr_quantity - odr_filled) {
        odr_filled == 0n
          ? (order.status = OrderStatus.OPEN)
          : (order.status = OrderStatus.PARTIALLY_FILLED);

        this.insertOrder({ ...order, filled: odr_filled });
      } else {
        order.status = OrderStatus.FILLED;
      }
    }

    let odr_amount = odr_price;
    let rem_amt = 0n;
    if (order.type == "MARKET") {
      let pair = this.asks.nextHigherPair(undefined);

      marketBuyLevels: while (
        pair &&
        odr_amount > 0n &&
        odr_filled < odr_quantity
      ) {
        const [price, level] = pair;
        let current_node = level.head;

        while (odr_filled < odr_quantity) {
          if (!current_node) break;
          let { user_id, order_id, quantity, next } = current_node;

          const affordable_qty = divideFixed(odr_amount, price, "floor");
          if (affordable_qty === 0n) break marketBuyLevels;

          const remaining_qty = odr_quantity - odr_filled;
          const fill_qty = min(
            min(remaining_qty, affordable_qty),
            quantity - current_node.filled
          );
          if (fill_qty === 0n) {
            current_node = next;
            continue;
          }
          const margin_before = this.remainingOrderMargin(current_node);

          odr_filled += fill_qty;
          current_node.filled += fill_qty;
          level.remaining_qty -= fill_qty;
          odr_amount -= multiplyFixed(fill_qty, price, "ceil");
          const maker_order_margin_consumed =
            margin_before - this.remainingOrderMargin(current_node);

          let maker_order_status = OrderStatus.OPEN;
          if (quantity == current_node.filled) {
            maker_order_status = OrderStatus.FILLED;
            this.removeOrder(current_node);
          } else if (current_node.filled > 0) {
            maker_order_status = OrderStatus.PARTIALLY_FILLED;
          }

          const fill: Fill = {
            trade_id: generate_trade_id(),
            maker_order_id: order_id,
            maker_user_id: user_id,
            taker_order_id: order.order_id,
            taker_user_id: order.user_id,
            maker_leverage: current_node.leverage,
            maker_order_margin_consumed,
            price,
            maker_order_status,
            filled: fill_qty,
          };
          fills.push(fill);

          current_node = next;
        }
        if (level.remaining_qty == 0n) {
          this.asks.delete(price);
        }
        pair = this.asks.nextHigherPair(price);
        order.status = OrderStatus.FILLED;
      }

      if (odr_amount > 0) {
        rem_amt = odr_amount;
      }
    }

    this.updateMarketData(fills);
    return {
      order: {
        order_id: order.order_id,
        filled: odr_filled,
        status: order.status,
        rem_amt,
        rem_qty: 0n,
      },
      fills,
    };
  }

  place_order(order: Order) {
    if (this.orders.has(order.order_id)) {
      throw new Error("This Order ID already exists");
    }

    if (order.filled >= order.quantity || order.filled < 0) {
      throw new Error(
        "Filled cannot exceed or be eqaual to Quanitity while insertion"
      );
    }
    if (order.side == "BUY") {
      return this.process_buy_order(order);
    } else if (order.side == "SELL") {
      return this.process_sell_order(order);
    } else {
      throw new Error("Order can only be placed for buy and sell");
    }
  }
}

export default Orderbook;
