import { prisma } from "..";

export const UserRepo = {
  newUser: async (username: string, passwordRaw: string) => {
    const hashedPassword = await Bun.password.hash(passwordRaw, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const response = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    return response;
  },

  getUserByUsername: async (username: string) => {
    const result = await prisma.user.findFirst({
      where: {
        username,
      },
    });

    return result || null;
  },

  getCollateral: async (user_id: string) => {
    const result = await prisma.collateral.findFirst({
      where: {
        user_id,
      },
    });

    return result || null;
  },

  upsertCollateral: async (
    user_id: string,
    available: bigint,
    reserved: bigint
  ) => {
    const result = await prisma.collateral.upsert({
      where: {
        user_id,
      },
      update: {
        available,
        reserved,
      },
      create: {
        user_id,
        available,
        reserved,
      },
    });

    return result || null;
  },
};

export default UserRepo;
