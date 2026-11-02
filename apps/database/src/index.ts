import RedisHandler from "./redis";
import OrderRepo from "db/repositories/order.repo";
import { formatScaledInteger } from "commons/src/fixed";
import type { DBEvent } from "commons/src/engine-event";
import { OrderSide, OrderStatus, OrderType } from "commons/src/order.type";
import { projectEngineEvent } from "./project-event";

const redis = new RedisHandler();

async function publishPrivateAccountUpdates(event: DBEvent): Promise<void> {
  if (event.event_type === "MARK_PRICE_UPDATE" || event.event_type === "MARKET_RISK_UPDATE" || event.event_type === "FUNDING_CONFIG_UPDATE") return;

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
    const balance = [...event.changes.balances].reverse().find(
      (candidate) => candidate.user_id === user_id
    );
    const latestPositionChanges = new Map<string, typeof event.changes.positions[number]>();
    for (const change of event.changes.positions) {
      if (change.user_id === user_id) latestPositionChanges.set(change.market_id, change);
    }
    const positions = [...latestPositionChanges.values()]
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
        ),
        state: change.position.state,
        liquidation_id: change.position.liquidation_id,
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
        closed_position_markets: [...latestPositionChanges.values()]
          .filter((change) => change.position === null)
          .map((change) => change.market_id)
      }
    });
  }
}

let retryDelayMs = 1000;
while (true) {
  try {
    await redis.readEvents(async (event) => {
      const persistedCandles = await projectEngineEvent(event);
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
      retryDelayMs = 1000;
    });
    throw new Error("Redis event reader stopped unexpectedly");
  } catch (error) {
    console.error("Redis event reader stopped:", error);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    retryDelayMs = Math.min(retryDelayMs * 2, 10000);
  }
}
