import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";
import { AppError } from "../utils/error";
import { loopback } from "../loopback";
import type { EngineResponse } from "commons/src";
import { MarketRepo } from "db/repositories/market.repo";

const list_markets = async (_req: Request, res: Response) => {
  try {
    const markets = await MarketRepo.listMarkets();
    return res.status(200).json(handleResponse("Markets fetched successfully.", 1, {
      markets: markets.map((market) => ({
        ...market,
        mark_price: market.mark_price?.toString() ?? null,
        last_traded_price: market.last_traded_price?.toString() ?? null,
      })),
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

const get_market = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const market = await MarketRepo.getMarket(market_id);
    if (!market) return res.status(404).json(handleError("Market not found", 0));
    return res.status(200).json(handleResponse("Market fetched successfully.", 1, {
      market: {
        ...market,
        mark_price: market.mark_price?.toString() ?? null,
        last_traded_price: market.last_traded_price?.toString() ?? null,
      },
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

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

export { list_markets, get_market, get_depth, get_position };
