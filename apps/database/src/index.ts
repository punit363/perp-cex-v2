import RedisHandler from "./redis";
import UserRepo from "db/repositories/user.repo";
import OrderRepo from "db/repositories/order.repo";
import { MarketRepo } from "db/repositories/market.repo";
import { formatScaledInteger } from "commons/src/fixed";
import type { CandleDBUpdate } from "db/repositories/order.repo";
import type { DBEvent } from "commons/src/engine-event";
import InsuranceFundRepo from "db/repositories/insurance-fund.repo";
import TradingFeeRepo from "db/repositories/trading-fee.repo";
import { OrderSide, OrderStatus, OrderType } from "commons/src/order.type";

const redis = new RedisHandler();

async function publishPrivateAccountUpdates(event: DBEvent): Promise<void> {
  if (event.event_type === "MARK_PRICE_UPDATE") return;

  const orderIds = new Set([
    ...event.changes.orders.map((order) => order.order_id),
    ...event.changes.order_updates.map((order) => order.order_id),
    ...event.changes.fills.flatMap((fill) => [
      fill.maker_order_id,
      fill.taker_order_id
    ])
  ]);
  const persistedOrders = await OrderRepo.listOrdersByIds([...orderIds]);
  const userIds = new Set([
    ...event.changes.balances.map((balance) => balance.user_id),
    ...persistedOrders.map((order) => order.user_id),
    ...event.changes.positions.map((position) => position.user_id),
    ...event.changes.insurance_fund.flatMap((fund) =>
      fund.entries.map((entry) => entry.user_id)
    )
  ]);

  for (const user_id of userIds) {
    const balance = event.changes.balances.find(
      (candidate) => candidate.user_id === user_id
    );
    const positions = event.changes.positions
      .filter(
        (
          change
        ): change is typeof change & {
          position: NonNullable<typeof change.position>;
        } => change.user_id === user_id && change.position !== null
      )
      .map((change) => ({
        market_id: change.market_id,
        type: change.position.type,
        quantity: formatScaledInteger(BigInt(change.position.quantity)),
        reserved_margin: formatScaledInteger(
          BigInt(change.position.reserved_margin)
        ),
        avg_entry_price: formatScaledInteger(
          BigInt(change.position.avg_entry_price)
        ),
        unrealized_pnl: formatScaledInteger(
          BigInt(change.position.unrealized_pnl)
        ),
        funding_accrued: formatScaledInteger(
          BigInt(change.position.funding_accrued)
        )
      }));

    await redis.publishPrivateAccountEvent({
      source_message_id: event.source_message_id,
      occurred_at_ms: Date.now(),
      event_type: "ACCOUNT",
      user_id,
      data: {
        reason: event.event_type,
        ...(balance && {
          balance: {
            available: formatScaledInteger(BigInt(balance.available)),
            reserved: formatScaledInteger(BigInt(balance.reserved))
          }
        }),
        orders: persistedOrders
          .filter((order) => order.user_id === user_id)
          .map((order) => ({
            order_id: order.order_id,
            market_id: order.market_id,
            type: order.type as OrderType,
            side: order.side as OrderSide,
            status: order.status as OrderStatus,
            price: formatScaledInteger(order.price),
            quantity: formatScaledInteger(order.quantity),
            filled: formatScaledInteger(order.filled),
            leverage: formatScaledInteger(order.leverage),
            initial_fee: formatScaledInteger(order.initial_fee),
            remaining_order_fee: formatScaledInteger(order.remaining_order_fee),
            created_at: order.created_at.toISOString(),
            updated_at: order.updated_at.toISOString()
          })),
        positions,
        closed_position_markets: event.changes.positions
          .filter(
            (change) => change.user_id === user_id && change.position === null
          )
          .map((change) => change.market_id)
      }
    });
  }
}

redis
  .readEvents(async (event) => {
    // Fills reference orders, so persist order changes first.
    for (const order of event.changes.orders) {
      await OrderRepo.insertOrder({
        order_id: order.order_id,
        user_id: order.user_id,
        market_id: order.market_id,
        type: order.type,
        side: order.side,
        price: BigInt(order.price),
        slippage: BigInt(order.slippage),
        quantity: BigInt(order.quantity),
        filled: BigInt(order.filled),
        initial_margin: BigInt(order.initial_margin),
        initial_fee: BigInt(order.initial_fee),
        leverage: BigInt(order.leverage),
        remaining_order_margin: BigInt(order.remaining_order_margin),
        remaining_order_fee: BigInt(order.remaining_order_fee),
        status: order.status
      });
    }

    const fills = event.changes.fills.map((fill) => ({
      trade_id: fill.trade_id,
      maker_order_id: fill.maker_order_id,
      taker_order_id: fill.taker_order_id,
      maker_user_id: fill.maker_user_id,
      taker_user_id: fill.taker_user_id,
      price: BigInt(fill.price),
      filled: BigInt(fill.filled),
      maker_leverage: BigInt(fill.maker_leverage),
      maker_order_margin_consumed: BigInt(fill.maker_order_margin_consumed),
      maker_order_fee_consumed: BigInt(fill.maker_order_fee_consumed),
      maker_order_fee_remaining: BigInt(fill.maker_order_fee_remaining),
      taker_fee: BigInt(fill.taker_fee),
      maker_order_status: fill.maker_order_status
    }));
    const candles: CandleDBUpdate[] = event.changes.candles.map((candle) => ({
      market_id: candle.market_id,
      start_ms: BigInt(candle.start_ms),
      open: BigInt(candle.open),
      high: BigInt(candle.high),
      low: BigInt(candle.low),
      close: BigInt(candle.close),
      base_volume: BigInt(candle.base_volume),
      quote_volume: BigInt(candle.quote_volume),
      trade_count: candle.trade_count
    }));
    const persistedCandles = await OrderRepo.applyFillsAndCandles(
      fills,
      candles
    );

    for (const update of event.changes.order_updates) {
      await OrderRepo.updateOrderStatus({
        order_id: update.order_id,
        user_id: update.user_id,
        market_id: update.market_id,
        status: update.status,
        remaining_order_margin: BigInt(update.remaining_order_margin),
        remaining_order_fee: BigInt(update.remaining_order_fee)
      });
    }

    for (const change of event.changes.positions) {
      if (change.position === null) {
        await OrderRepo.deletePosition(change.user_id, change.market_id);
        continue;
      }

      await OrderRepo.upsertPosition({
        user_id: change.user_id,
        market_id: change.market_id,
        type: change.position.type,
        quantity: BigInt(change.position.quantity),
        reserved_margin: BigInt(change.position.reserved_margin),
        avg_entry_price: BigInt(change.position.avg_entry_price),
        unrealized_pnl: BigInt(change.position.unrealized_pnl),
        funding_accrued: BigInt(change.position.funding_accrued)
      });
    }

    for (const balance of event.changes.balances) {
      await UserRepo.upsertCollateral(
        balance.user_id,
        BigInt(balance.available),
        BigInt(balance.reserved)
      );
    }

    for (const fundChange of event.changes.insurance_fund) {
      await InsuranceFundRepo.projectChange(fundChange);
    }
    for (const feeChange of event.changes.trading_fee_account) {
      await TradingFeeRepo.projectChange(feeChange);
    }

    for (const change of event.changes.market_data) {
      await MarketRepo.updateMarketData({
        market_id: change.market_id,
        ...(change.mark_price !== undefined && {
          mark_price: BigInt(change.mark_price)
        }),
        ...(change.last_traded_price !== undefined && {
          last_traded_price: BigInt(change.last_traded_price)
        }),
        ...(change.last_trade_id !== undefined && {
          last_trade_id: change.last_trade_id
        })
      });
    }
    for (const candle of persistedCandles) {
      await redis.publishCandle({
        source_message_id: event.source_message_id,
        market_id: candle.market_id,
        start_ms: Number(candle.start_ms),
        open: formatScaledInteger(candle.open),
        high: formatScaledInteger(candle.high),
        low: formatScaledInteger(candle.low),
        close: formatScaledInteger(candle.close),
        base_volume: formatScaledInteger(candle.base_volume),
        quote_volume: formatScaledInteger(candle.quote_volume),
        trade_count: candle.trade_count
      });
    }
    await publishPrivateAccountUpdates(event);
  })
  .catch((error) => {
    console.error("Redis event reader stopped:", error);
  });
