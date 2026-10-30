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

  upsertOrder: async (order: OrderDBUpdate) => {
    const {
      user_id,
      order_id,
      market_id,
      type,
      side,
      price,
      slippage,
      quantity,
      filled,
      initial_margin,
      leverage,
      remaining_order_margin,
      status,
      arrival_seq,
    } = order;

    const response = await prisma.order.upsert({
      where: {
        order_id,
      },
      update: {
        user_id,
        order_id,
        market_id,
        type,
        side,
        price,
        slippage,
        quantity,
        filled,
        initial_margin,
        leverage,
        remaining_order_margin,
        status,
        arrival_seq,
      },
      create: order,
    });

    return response;
  },

  insertFill: async (fill: FillDBUpdate) => {
    await prisma.fill.upsert({
      where: { trade_id: fill.trade_id },
      update: fill,
      create: fill,
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
