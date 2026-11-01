import { prisma } from "..";

export const LiquidationRepo = {
  listForUser: (user_id: string, market_id: string) =>
    prisma.liquidation.findMany({
      where: { user_id, market_id },
      orderBy: { created_at: "desc" },
      take: 50,
      include: {
        attempt_records: {
          orderBy: { attempt: "asc" },
        },
      },
    }),
};
