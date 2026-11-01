import { prisma } from "..";
import type {
  FillDBUpdate,
  OrderDBUpdate,
  PositionDBUpdate,
} from "commons/src/order.type";
import { OrderStatus } from "commons/src/order.type";

export type CandleDBUpdate = {
  market_id: string;
  start_ms: bigint;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  base_volume: bigint;
  quote_volume: bigint;
  trade_count: number;
};

const OrderRepo = {
  listUserOrders: async (user_id: string, market_id: string, view: "open" | "history") => {
    return prisma.order.findMany({
      where: {
        user_id,
        market_id,
        status: { in: view === "open"
          ? [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED]
          : [OrderStatus.FILLED, OrderStatus.CANCELLED] },
      },
      orderBy: { updated_at: "desc" },
      take: 50,
      select: {
        order_id: true,
        side: true,
        type: true,
        status: true,
        price: true,
        quantity: true,
        filled: true,
        leverage: true,
        created_at: true,
        updated_at: true,
      },
    });
  },

  listOrdersByIds: async (order_ids: string[]) => {
    if (order_ids.length === 0) return [];
    return prisma.order.findMany({
      where: { order_id: { in: order_ids } },
      select: {
        order_id: true,
        user_id: true,
        market_id: true,
        side: true,
        type: true,
        status: true,
        price: true,
        quantity: true,
        filled: true,
        leverage: true,
        created_at: true,
        updated_at: true,
      },
    });
  },

  insertOrder: async (order: OrderDBUpdate) => {
    await prisma.order.createMany({
      data: [order],
      skipDuplicates: true,
    });
  },

  updateOrderStatus: async (update: {
    order_id: string;
    user_id: string;
    market_id: string;
    status: OrderStatus;
    remaining_order_margin: bigint;
  }) => {
    await prisma.order.update({
      where: {
        order_id: update.order_id,
        user_id: update.user_id,
        market_id: update.market_id,
      },
      data: {
        status: update.status,
        remaining_order_margin: update.remaining_order_margin,
      },
    });
  },

  applyFillsAndCandles: async (fills: FillDBUpdate[], candles: CandleDBUpdate[]) => {
    if (candles.length && !fills.length) throw new Error("Candle update has no fills");
    return prisma.$transaction(async (tx) => {
      let insertedCount = 0;
      for (const fill of fills) {
        const inserted = await tx.fill.createMany({
          data: [{
            trade_id: fill.trade_id,
            maker_order_id: fill.maker_order_id,
            taker_order_id: fill.taker_order_id,
            maker_user_id: fill.maker_user_id,
            taker_user_id: fill.taker_user_id,
            price: fill.price,
            quantity: fill.filled,
          }],
          skipDuplicates: true,
        });
        if (!inserted.count) continue;
        insertedCount += 1;
        await tx.order.update({
          where: { order_id: fill.maker_order_id },
          data: {
            filled: { increment: fill.filled },
            remaining_order_margin: { decrement: fill.maker_order_margin_consumed },
            status: fill.maker_order_status,
          },
        });
      }

      if (insertedCount !== 0 && insertedCount !== fills.length) {
        throw new Error("Partial duplicate fill event cannot be projected safely");
      }
      if (insertedCount === fills.length) {
        for (const candle of candles) {
          await tx.$executeRaw`
            INSERT INTO "Candle" ("market_id", "start_ms", "open", "high", "low", "close", "base_volume", "quote_volume", "trade_count")
            VALUES (${candle.market_id}, ${candle.start_ms}, ${candle.open}, ${candle.high}, ${candle.low}, ${candle.close}, ${candle.base_volume}, ${candle.quote_volume}, ${candle.trade_count})
            ON CONFLICT ("market_id", "start_ms") DO UPDATE SET
              "high" = GREATEST("Candle"."high", EXCLUDED."high"),
              "low" = LEAST("Candle"."low", EXCLUDED."low"),
              "close" = EXCLUDED."close",
              "base_volume" = "Candle"."base_volume" + EXCLUDED."base_volume",
              "quote_volume" = "Candle"."quote_volume" + EXCLUDED."quote_volume",
              "trade_count" = "Candle"."trade_count" + EXCLUDED."trade_count"
          `;
        }
      }
      const persisted = await Promise.all(candles.map((candle) => tx.candle.findUnique({
        where: { market_id_start_ms: { market_id: candle.market_id, start_ms: candle.start_ms } },
      })));
      // A replayed pre-candle fill can already exist without a candle in its
      // original request-time bucket; historical backfill used fill insert time.
      return persisted.filter((candle) => candle !== null);
    });
  },

  upsertPosition: async (position: PositionDBUpdate) => {
    await prisma.position.upsert({
      where: {
        user_id_market_id: {
          user_id: position.user_id,
          market_id: position.market_id,
        },
      },
      update: position,
      create: position,
    });
  },

  deletePosition: async (user_id: string, market_id: string) => {
    await prisma.position.deleteMany({ where: { user_id, market_id } });
  },
};

export default OrderRepo;
