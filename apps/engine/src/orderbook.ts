import BTree from "sorted-btree";
import type { OrderNode, PriceLevel } from "./types";

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

}
