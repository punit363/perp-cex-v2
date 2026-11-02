import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";
import { AppError } from "../utils/error";
import { loopback } from "../loopback";
import type { EngineResponse } from "commons/src";
import { MarketRepo } from "db/repositories/market.repo";
import { TradeRepo } from "db/repositories/trade.repo";
import { CandleRepo } from "db/repositories/candle.repo";
import { LiquidationRepo } from "db/repositories/liquidation.repo";
import { formatScaledInteger } from "commons/src/fixed";
import { FundingRepo } from "db/repositories/funding.repo";

const list_markets = async (_req: Request, res: Response) => {
  try {
    const markets = await MarketRepo.listMarkets();
    return res.status(200).json(handleResponse("Markets fetched successfully.", 1, {
      markets: markets.map((market) => ({
        ...market,
        mark_price: market.mark_price?.toString() ?? null,
        last_traded_price: market.last_traded_price?.toString() ?? null,
        maintenance_margin_rate: market.maintenance_margin_rate?.toString() ?? null,
        liquidation_fee_rate: market.liquidation_fee_rate?.toString() ?? null,
        max_leverage: market.max_leverage?.toString() ?? null,
        max_liquidation_quantity: market.max_liquidation_quantity?.toString() ?? null,
        funding_fixed_rate: market.funding_fixed_rate?.toString() ?? null,
        funding_last_rate: market.funding_last_rate?.toString() ?? null,
        last_funding_ms: market.last_funding_ms?.toString() ?? null,
        next_funding_ms: market.next_funding_ms?.toString() ?? null,
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
        maintenance_margin_rate: market.maintenance_margin_rate?.toString() ?? null,
        liquidation_fee_rate: market.liquidation_fee_rate?.toString() ?? null,
        max_leverage: market.max_leverage?.toString() ?? null,
        max_liquidation_quantity: market.max_liquidation_quantity?.toString() ?? null,
        funding_fixed_rate: market.funding_fixed_rate?.toString() ?? null,
        funding_last_rate: market.funding_last_rate?.toString() ?? null,
        last_funding_ms: market.last_funding_ms?.toString() ?? null,
        next_funding_ms: market.next_funding_ms?.toString() ?? null,
      },
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

const get_market_trades = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const trades = await TradeRepo.listMarketTrades(market_id);
    return res.status(200).json(handleResponse("Market trades fetched successfully.", 1, {
      trades: trades.map((trade) => ({
        trade_id: trade.trade_id,
        price: trade.price.toString(),
        quantity: trade.quantity.toString(),
        taker_side: trade.taker_order.side,
        created_at: trade.created_at.toISOString(),
      })),
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

const get_market_candles = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const candles = await CandleRepo.listMarketCandles(market_id);
    return res.status(200).json(handleResponse("Market candles fetched successfully.", 1, {
      candles: candles.map((candle) => ({
        market_id: candle.market_id,
        start_ms: Number(candle.start_ms),
        open: candle.open.toString(),
        high: candle.high.toString(),
        low: candle.low.toString(),
        close: candle.close.toString(),
        base_volume: candle.base_volume.toString(),
        quote_volume: candle.quote_volume.toString(),
        trade_count: candle.trade_count,
      })),
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

const get_liquidations = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const user_id = req.user_id as string;
    if (!market_id) throw new AppError("Missing market ID", 400);
    const rows = await LiquidationRepo.listForUser(user_id, market_id);
    const amount = (value: bigint) => formatScaledInteger(value);
    return res.status(200).json(handleResponse("Liquidations fetched successfully.", 1, {
      liquidations: rows.map((row) => ({
        liquidation_id: row.liquidation_id,
        market_id: row.market_id,
        status: row.status,
        initial_quantity: amount(row.initial_quantity),
        remaining_quantity: amount(row.remaining_quantity),
        total_filled: amount(row.total_filled),
        total_realized_pnl: amount(row.total_realized_pnl),
        total_liquidation_fee: amount(row.total_liquidation_fee),
        total_user_refund: amount(row.total_user_refund),
        total_shortfall_covered: amount(row.total_shortfall_covered),
        total_uncovered_shortfall: amount(row.total_uncovered_shortfall),
        attempts: row.attempts,
        created_at: row.created_at.toISOString(),
        attempt_records: row.attempt_records.map((attempt) => ({
          attempt_id: attempt.attempt_id,
          attempt: attempt.attempt,
          status: attempt.status,
          filled_quantity: amount(attempt.filled_quantity),
          remaining_quantity: amount(attempt.remaining_quantity),
          mark_price: amount(attempt.mark_price),
          liquidation_fee: amount(attempt.liquidation_fee),
          shortfall_covered: amount(attempt.shortfall_covered),
          uncovered_shortfall: amount(attempt.uncovered_shortfall),
          created_at: attempt.created_at.toISOString(),
        })),
      })),
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status((error as { status_code?: number })?.status_code || 500)
      .json(handleError(err.message, 0));
  }
};

const get_funding_rate = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const result = await loopback({ action: "GET_FUNDING_RATE", market_id }) as EngineResponse;
    if (!result.status) return res.status(400).json(handleError(result.message, 0));
    return res.status(200).json(handleResponse("Funding state fetched", 1, { funding: result.data }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

const get_funding_history = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const intervals = await FundingRepo.listIntervals(market_id);
    return res.status(200).json(handleResponse("Funding intervals fetched", 1, {
      intervals: intervals.map((row) => ({
        market_id: row.market_id, interval_end_ms: Number(row.interval_end_ms),
        index_price: formatScaledInteger(row.index_price), rate: formatScaledInteger(row.rate),
        sample_count: row.sample_count, status: row.status,
        total_paid: formatScaledInteger(row.total_paid),
        insurance_used: formatScaledInteger(row.insurance_used),
        uncovered_shortfall: formatScaledInteger(row.uncovered_shortfall),
      })),
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

const get_funding_payments = async (req: Request, res: Response) => {
  try {
    const market_id = req.params.market_id as string;
    const rows = await FundingRepo.listPayments(req.user_id as string, market_id);
    return res.status(200).json(handleResponse("Funding payments fetched", 1, {
      payments: rows.map((row) => ({
        interval_end_ms: Number(row.interval_end_ms), amount: formatScaledInteger(row.amount),
        requested_amount: formatScaledInteger(row.requested_amount),
        available_debit: formatScaledInteger(row.available_debit),
        margin_debit: formatScaledInteger(row.margin_debit),
        insurance_covered: formatScaledInteger(row.insurance_covered),
        uncovered_shortfall: formatScaledInteger(row.uncovered_shortfall),
      })),
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json(handleError(err.message, 0));
  }
};

export { list_markets, get_market, get_market_trades, get_market_candles, get_depth, get_position, get_liquidations, get_funding_rate, get_funding_history, get_funding_payments };
