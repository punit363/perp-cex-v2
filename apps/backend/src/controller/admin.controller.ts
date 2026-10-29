import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";
import CONFIG from "../config";
import { AppError } from "../utils/error";
import { MarketRepo } from "db/repositories/market.repo";

async function addMarket(req: Request, res: Response): Promise<void> {
  try {
    const { market } = req.body;
    const { token } = req.headers;

    if (token != CONFIG.admin_token) {
      throw new AppError("Incorrect credentials", 411);
    }

    const response = await MarketRepo.newMarket(market, "");

    res.status(200).send(
      handleResponse("New market created successfully", 1, { id: response.id })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
}

export { addMarket };
