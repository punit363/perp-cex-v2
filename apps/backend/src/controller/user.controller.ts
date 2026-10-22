import type { RequestToEngine, ResponseFromEngine } from "commons/src";
import { handleError, handleResponse } from "../utils/handler";
import { loopback } from "../loopback";
import type { Request, Response } from "express";

async function on_ramp(req: Request, res: Response) {
  try {
    const user_id = req.user_id as string;
    const request = req.body;

    const engine_request: RequestToEngine = {
      action: "ONRAMP",
      user_id,
      amount: request.amount,
    };

    const engine_response = await loopback(engine_request) as ResponseFromEngine;

    if (!engine_response.status) {
      return res.status(400).json(
        handleResponse(engine_response.message, 0, {
          engine_response,
        })
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

    const engine_response = await loopback(engine_request) as ResponseFromEngine;

    if (!engine_response.status) {
      return res.status(400).json(
        handleResponse(engine_response.message, 0, {
          engine_response,
        })
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
