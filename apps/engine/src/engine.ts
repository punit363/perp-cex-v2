import { formatFixed } from "./math/fixed-point";
import type { Fill, UserAccount } from "./types";
import { engine_response } from "./utils";
import type { EngineCommand } from "./zod/z";
import Orderbook from "./orderbook";
import BTree from "sorted-btree";
import { calculateNotional } from "./math/financial-math";
import type { EngineResponse } from "commons/src/index";

//TODO: Add a crash recovery system that has orderbooks from all markets and also feeds the orderbooks
class Engine {
  private orderbooks = new Map<string, Orderbook>();
  private user_accounts = new Map<string, UserAccount>();

  constructor() {
    //Logic to read from recovery system
    this.orderbooks.set(
      "market123",
      new Orderbook(new BTree(), new BTree(), new Map(), 0n, "")
    );
    this.user_accounts.set("user123", {
      user_id: "user123",
      collateral: {
        available: 0n,
        reserved: 0n,
      },
      positions: new Map(),
      orders: new Set(),
    });
  }

  private updateCollateral(
    user_id: string,
    add_to_available: bigint,
    add_to_reserved: bigint
  ) {
    const user = this.user_accounts.get(user_id);
    if (!user) {
      throw new Error("User not found");
    }

    user.collateral.available += add_to_available;
    user.collateral.reserved += add_to_reserved;
  }

  processEngineOrder = (request: EngineCommand) => {
    switch (request.action) {
      case "ONRAMP": {
        try {
          const amount = request.amount;
          const user_id = request.user_id;

          if (amount <= 0) {
            return engine_response("Cannot ramp negative value", 0);
          }

          const user_acc = this.user_accounts.get(user_id);
          if (!user_acc) {
            const collateral = {
              reserved: 0n,
              available: amount,
            };

            const user = {
              user_id,
              collateral,
              positions: new Map(),
              orders: new Set<string>(),
            };

            this.user_accounts.set(user_id, user);
          } else {
            user_acc.collateral.available += amount;
          }

          return engine_response("Onramp successfull", 1);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          return engine_response(err.message, 0);
        }
      }

      case "GET_BALANCE": {
        try {
          const user_acc = this.user_accounts.get(request.user_id);
          if (!user_acc) {
            return engine_response("User Account does not exist", 0);
          }

          const balance = {
            available: formatFixed(user_acc.collateral.available),
            reserved: formatFixed(user_acc.collateral.reserved),
          };

          return engine_response("Balance Retrieved", 1, balance);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          return engine_response(err.message, 0);
        }
      }

      case "PLACE_ORDER": {
        try {
          const { action, equity, user_id, price, quantity, ...order } =
            request;

          const orderbook = this.orderbooks.get(order.market_id);

          if (!orderbook) {
            throw new Error("Incorrect Market ID");
          }

          const user_acc = this.user_accounts.get(request.user_id);
          if (!user_acc) {
            return engine_response("User Account does not exist", 0);
          }

          const notional = calculateNotional(price, quantity);
          if (user_acc.collateral.available < notional) {
            throw new Error("Insufficient funds");
          }

          const result = orderbook.place_order({
            user_id,
            price,
            quantity,
            ...order,
          });

          this.updateCollateral(user_id, -notional, notional);

          const response = {
            order: {
              ...result.order,
              filled: formatFixed(result.order.filled),
            },
            fills: result.fills.map((fill: Fill) => ({
              ...fill,
              price: formatFixed(fill.price),
              filled: formatFixed(fill.filled),
            })),
          };

          return engine_response("Order placed successfully", 1, response);
        } catch (error) {
          console.log(error);
          const err = error instanceof Error ? error : new Error(String(error));
          return engine_response(err.message, 0);
        }
      }

      case "CANCEL_ORDER": {
        try {
          const { action, ...cancel_request } = request;

          const orderbook = this.orderbooks.get(cancel_request.market_id);

          if (!orderbook) {
            throw new Error("Incorrect Market ID");
          }

          const cancelResult = orderbook.cancelOrder(cancel_request);

          if (!cancelResult) {
            throw new Error("Cancel order failed");
          }

          const { order_id, rem_qty, price } = cancelResult;

          this.updateCollateral(
            request.user_id,
            calculateNotional(price, rem_qty),
            -calculateNotional(price, rem_qty)
          );

          return engine_response("Order cancelled successfully", 1, {
            order_id,
            rem_qty: formatFixed(rem_qty),
            price: formatFixed(price),
          });
        } catch (error) {
          console.log(error);
          const err = error instanceof Error ? error : new Error(String(error));
          return engine_response(err.message, 0);
        }
      }

      case "GET_DEPTH": {
        return engine_response("Updating soon", 0);
      }
      case "SPOT_PRICE_UPDATE": {
        return engine_response("Updating soon", 0);
      }
      case "GET_FUNDING_RATE": {
        return engine_response("Updating soon", 0);
      }
      default:
        const response: EngineResponse = {
          message: "Unrecognised engine request action",
          status: 0,
          data: null,
        };

        return response;
    }
  };
}
export default Engine;
