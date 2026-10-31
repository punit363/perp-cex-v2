import { prisma } from "..";
import type {
  FillDBUpdate,
  OrderDBUpdate,
  PositionDBUpdate,
} from "commons/src/order.type";
import { OrderStatus } from "commons/src/order.type";

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

  applyFill: async (fill: FillDBUpdate) => {
    await prisma.$transaction(async (tx) => {
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

      if (inserted.count === 0) return;
      await tx.order.update({
        where: { order_id: fill.maker_order_id },
        data: {
          filled: { increment: fill.filled },
          remaining_order_margin: {
            decrement: fill.maker_order_margin_consumed,
          },
          status: fill.maker_order_status,
        },
      });
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
