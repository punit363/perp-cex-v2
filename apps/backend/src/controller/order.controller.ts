import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";

import type { EngineResponse, RequestToEngine } from "commons/src/index";
import { loopback } from "../loopback";
import { OrderStatus } from "commons/src/order.type";
import OrderRepo from "db/repositories/order.repo";

async function list_orders(req: Request, res: Response) {
  try {
    const user_id = req.user_id as string;
    const market_id = req.query.market_id;
    const view = req.query.view;
    if (typeof market_id !== "string" || !market_id || (view !== "open" && view !== "history")) {
      return res.status(400).json(handleError("Valid market_id and view are required", 0));
    }
    const orders = await OrderRepo.listUserOrders(user_id, market_id, view);
    return res.status(200).json(handleResponse("Orders fetched successfully.", 1, {
      orders: orders.map((order) => ({
        ...order,
        price: order.price.toString(),
        quantity: order.quantity.toString(),
        filled: order.filled.toString(),
        leverage: order.leverage.toString(),
      })),
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
}

async function place_order(req: Request, res: Response) {
  try {
    const user_id = req.user_id as string;

    const { market_id, price, quantity, side, type, leverage } = req.body;
    const order_id = "odr_" + Math.random().toString();

    const engine_request: RequestToEngine = {
      action: "PLACE_ORDER",
      user_id,
      order_id,
      market_id,
      price,
      quantity,
      filled: "0",
      status: OrderStatus.OPEN,
      side,
      type,
      leverage,
    };

    const engine_response = await loopback(engine_request) as EngineResponse;

    if (engine_response.status == 0) {
      return res.status(400).json(handleError(engine_response.message, 0));
    }

    return res.status(200).json(
      handleResponse("Order placed successfully.", 1, {
        engine_response,
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
}

async function cancel_order(req: Request, res: Response) {
  try {
    const user_id = req.user_id as string;

    const { order_id, market_id } = req.body;

    const engine_request: RequestToEngine = {
      action: "CANCEL_ORDER",
      user_id,
      order_id,
      market_id,
    };

    const engine_response = await loopback(engine_request) as EngineResponse;

    if (engine_response.status == 0) {
      return res.status(400).json(handleError(engine_response.message, 0));
    }

    return res.status(200).json(
      handleResponse("Order cancelled successfully.", 1, {
        engine_response,
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
}

export { list_orders, place_order, cancel_order };
