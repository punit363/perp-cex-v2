import BTree from "sorted-btree";
import type { Order, OrderNode, PriceLevel, UserAccount } from "./types";
import type { bigint, number } from "zod";
import { formatFixed } from "./math/fixed-point";

class Orderbook {
  private asks = new BTree<bigint, PriceLevel>(undefined, this.comparePrice);
  private bids = new BTree<bigint, PriceLevel>(undefined, this.comparePrice);
  private orders = new Map<string, OrderNode>();

  constructor(
    asks: BTree<bigint, PriceLevel>,
    bids: BTree<bigint, PriceLevel>,
    orders: Map<string, OrderNode>
  ) {
    this.asks = asks;
    this.bids = bids;
    this.orders = orders;
  }

  private comparePrice(a: bigint, b: bigint) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  insertOrder(order: Order) {
    const price = order.price;
    const quanity = order.quantity;
    const filled = order.filled;

    if (this.orders.has(order.order_id)) {
      throw new Error("This Order ID already exists");
    }

    if (filled >= quanity || filled < 0) {
      throw new Error(
        "Filled cannot exceed or be eqaual to Quanitity while insertion"
      );
    }

    if (order.type == "LIMIT") {
      if (price <= 0n || quanity <= 0n) {
        throw new Error("Price and Quatity cannot be negative");
      }
      let price_level;

      if (order.side == "SELL") {
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
      } else if (order.side == "BUY") {
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

      price_level.remaining_qty += quanity - filled;

      const order_node: OrderNode = {
        order_id: order.order_id,
        user_id: order.user_id,
        quanity,
        filled: order.filled,
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

    price_level.remaining_qty -= order.quanity - order.filled;
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

    //TODO: Handle balances in engine.ts after orderbook is modified
    // user.collateral.reserved -= order.quanity * price;
    // user.collateral.available += order.quanity * price;

    this.orders.delete(order_id);
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
}
