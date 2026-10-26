import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";
import { AppError } from "../utils/error";
import { loopback } from "../loopback";
import type { EngineResponse } from "commons/src";

const get_depth = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;

    if (!market_id) {
      throw new AppError("Missing market ID", 400);
    }

    const engine_response = (await loopback({
      action: "GET_DEPTH",
      market_id,
    })) as EngineResponse;

    if (engine_response.status == 0) {
      return res.status(400).json(handleError(engine_response.message, 0));
    }

    return res.status(200).json(
      handleResponse("Depth fetched successfully.", 1, {
        engine_response,
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
};

const get_position = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const user_id = req.user_id as string;

    if (!market_id) {
      throw new AppError("Missing market ID", 400);
    }

    const engine_response = (await loopback({
      action: "GET_POSITION",
      market_id,
      user_id,
    })) as EngineResponse;

    if (engine_response.status == 0) {
      return res.status(400).json(handleError(engine_response.message, 0));
    }

    return res.status(200).json(
      handleResponse("Position fetched successfully.", 1, {
        engine_response,
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
};

export { get_depth, get_position };
