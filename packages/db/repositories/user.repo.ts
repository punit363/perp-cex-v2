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
};
