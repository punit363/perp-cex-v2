import RedisHandler from "./redis";
import UserRepo from "db/repositories/user.repo";
import OrderRepo from "db/repositories/order.repo";
import { MarketRepo } from "db/repositories/market.repo";

const redis = new RedisHandler();

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
        leverage: BigInt(order.leverage),
        remaining_order_margin: BigInt(order.remaining_order_margin),
        status: order.status,
      });
    }

    for (const fill of event.changes.fills) {
      await OrderRepo.applyFill({
        trade_id: fill.trade_id,
        maker_order_id: fill.maker_order_id,
        taker_order_id: fill.taker_order_id,
        maker_user_id: fill.maker_user_id,
        taker_user_id: fill.taker_user_id,
        price: BigInt(fill.price),
        filled: BigInt(fill.filled),
        maker_leverage: BigInt(fill.maker_leverage),
        maker_order_margin_consumed: BigInt(fill.maker_order_margin_consumed),
        maker_order_status: fill.maker_order_status,
      });
    }

    for (const update of event.changes.order_updates) {
      await OrderRepo.updateOrderStatus({
        order_id: update.order_id,
        user_id: update.user_id,
        market_id: update.market_id,
        status: update.status,
        remaining_order_margin: BigInt(update.remaining_order_margin),
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
        funding_accrued: BigInt(change.position.funding_accrued),
      });
    }

    for (const balance of event.changes.balances) {
      await UserRepo.upsertCollateral(
        balance.user_id,
        BigInt(balance.available),
        BigInt(balance.reserved)
      );
    }

    for (const change of event.changes.market_data) {
      await MarketRepo.updateMarketData({
        market_id: change.market_id,
        ...(change.mark_price !== undefined && {
          mark_price: BigInt(change.mark_price),
        }),
        ...(change.last_traded_price !== undefined && {
          last_traded_price: BigInt(change.last_traded_price),
        }),
        ...(change.last_trade_id !== undefined && {
          last_trade_id: change.last_trade_id,
        }),
      });
    }
  })
  .catch((error) => {
    console.error("Redis event reader stopped:", error);
  });
