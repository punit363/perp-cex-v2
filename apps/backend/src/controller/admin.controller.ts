import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";
import CONFIG from "../config";
import { AppError } from "../utils/error";
import { MarketRepo } from "db/repositories/market.repo";
import { loopback } from "../loopback";
import type { EngineResponse } from "commons/src";

async function addMarket(req: Request, res: Response): Promise<void> {
  try {
    const { market } = req.body;
    const { token } = req.headers;

    if (!CONFIG.admin_token || token != CONFIG.admin_token) {
      throw new AppError("Incorrect credentials", 411);
    }

    if (typeof market !== "string" || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(market)) {
      throw new AppError("Market must be an uppercase BASE-QUOTE pair", 400);
    }

    const response = await MarketRepo.ensureMarket(market, "");
    const registration = (await loopback({
      action: "REGISTER_MARKET",
      market_id: response.market_id,
      slug: response.slug,
    })) as EngineResponse;

    if (!registration.status) throw new AppError(registration.message, 503);

    res.status(200).send(
      handleResponse("New market created successfully", 1, {
        market_id: response.market_id,
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
}

async function setMarketRisk(req: Request, res: Response): Promise<void> {
  try {
    if (!CONFIG.admin_token || req.headers.token !== CONFIG.admin_token) {
      throw new AppError("Incorrect credentials", 401);
    }

    const market_id = req.params.market_id as string;
    const body = req.body as Record<string, unknown>;
    if (
      !market_id ||
      typeof body?.maintenance_margin_rate !== "string" ||
      typeof body?.liquidation_fee_rate !== "string" ||
      (body.max_leverage !== null && typeof body.max_leverage !== "string") ||
      (body.max_liquidation_quantity !== null &&
        typeof body.max_liquidation_quantity !== "string")
    ) {
      throw new AppError("Invalid market risk configuration", 400);
    }

    const result = (await loopback({
      action: "SET_MARKET_RISK",
      market_id,
      maintenance_margin_rate: body.maintenance_margin_rate,
      liquidation_fee_rate: body.liquidation_fee_rate,
      max_leverage: body.max_leverage,
      max_liquidation_quantity: body.max_liquidation_quantity,
    })) as EngineResponse;

    if (!result.status) {
      res.status(400).json(handleError(result.message, 0));
      return;
    }

    res
      .status(200)
      .json(handleResponse(result.message, 1, { engine_response: result }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .json(handleError(err.message, 0));
  }
}

async function setFundingRate(req: Request, res: Response): Promise<void> {
  try {
    if (!CONFIG.admin_token || req.headers.token !== CONFIG.admin_token) {
      throw new AppError("Incorrect credentials", 401);
    }

    const market_id = req.params.market_id as string;
    const funding_rate = (req.body as Record<string, unknown>)?.funding_rate;

    if (
      !market_id ||
      (funding_rate !== null && typeof funding_rate !== "string")
    ) {
      throw new AppError(
        "Expected funding_rate as a decimal string or null",
        400
      );
    }

    const result = (await loopback({
      action: "SET_FUNDING_RATE",
      market_id,
      funding_rate: funding_rate as string | null,
    })) as EngineResponse;
    if (!result.status) {
      res.status(400).json(handleError(result.message, 0));
      return;
    }
    res
      .status(200)
      .json(handleResponse(result.message, 1, { funding: result.data }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .json(handleError(err.message, 0));
  }
}

export { addMarket, setMarketRisk, setFundingRate };
