import { prisma } from "..";

export const UserRepo = {
  new_user: async (username: string, passwordRaw: string) => {
    const hashedPassword = await Bun.password.hash(passwordRaw, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const respone = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    return respone;
  },

  get_user_by_username: async (username: string) => {
    const result = await prisma.user.findFirst({
      where: {
        username,
      },
    });

    return result || null;
  },

  getCollateral: async (user_id: string, market_id: string) => {
    const result = await prisma.collateral.findFirst({
      where: {
        user_id,
      },
    });

    return result || null;
  },

  createCollateral: async (user_id: string) => {
    const result = await prisma.collateral.create({
      data: {
        user_id,
        available: 0n,
        reserved: 0n,
      },
    });

    return result || null;
  },

  creditAvailableCollateral: async (user_id: string, amt: bigint) => {
    const result = await prisma.collateral.update({
      where: {
        user_id,
      },
      data: {
        available: {
          increment: amt,
        },
      },
    });

    return result || null;
  },

  debitAvailableCollateral: async (user_id: string, amt: bigint) => {
    const result = await prisma.collateral.update({
      where: {
        user_id,
      },
      data: {
        available: {
          decrement: amt,
        },
      },
    });

    return result || null;
  },

  debitMarginCollateral: async (user_id: string, amt: bigint) => {
    const result = await prisma.collateral.update({
      where: {
        user_id,
      },
      data: {
        reserved: {
          decrement: amt,
        },
      },
    });

    return result || null;
  },

  reserveMarginCollateral: async (user_id: string, amt: bigint) => {
    const result = await prisma.collateral.update({
      where: {
        user_id,
      },
      data: {
        available: {
          decrement: amt,
        },
        reserved: {
          increment: amt,
        },
      },
    });

    return result || null;
  },

  releaseMarginCollateral: async (user_id: string, amt: bigint) => {
    const result = await prisma.collateral.update({
      where: {
        user_id,
      },
      data: {
        available: {
          increment: amt,
        },
        reserved: {
          decrement: amt,
        },
      },
    });

    return result || null;
  },
};

export default UserRepo;
