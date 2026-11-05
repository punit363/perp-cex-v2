import type { RequestToEngine, EngineResponse } from "commons/src";
import { handleError, handleResponse } from "../utils/handler";
import { loopback } from "../loopback";
import type { Request, Response } from "express";
import CONFIG from "../config";

async function on_ramp(req: Request, res: Response) {
  try {
    const user_id = req.user_id as string;
    const amount = req.body?.amount;
    if (typeof amount !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amount)) {
      return res.status(400).json(handleError("Enter a positive amount with up to 8 decimal places.", 0));
    }
    const [whole, fraction = ""] = amount.split(".");
    const scaled = BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
    if (scaled <= 0n || scaled > CONFIG.demo_max_top_up) {
      return res.status(400).json(handleError("Amount exceeds the allowed demo top-up.", 0));
    }

    const engine_request: RequestToEngine = {
      action: "ONRAMP",
      user_id,
      amount,
    };

    const engine_response = await loopback(engine_request) as EngineResponse;

    if (!engine_response.status) {
      return res.status(400).json(
        handleError(engine_response.message, 0)
      );
    }

    return res.status(200).json(
      handleResponse(engine_response.message, 1, {
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

async function get_balance(req: Request, res: Response) {
  try {
    const user_id = req.user_id as string;

    const engine_request: RequestToEngine = {
      action: "GET_BALANCE",
      user_id,
    };

    const engine_response = await loopback(engine_request) as EngineResponse;

    if (!engine_response.status) {
      return res.status(400).json(
        handleError(engine_response.message, 0)
      );
    }

    return res.status(200).json(
      handleResponse(engine_response.message, 1, {
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

export { on_ramp, get_balance };
