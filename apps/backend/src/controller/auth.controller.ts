import type { Request, Response } from "express";
import { handleError, handleResponse } from "../utils/handler";
import { AppError } from "../utils/error";
import { UserRepo } from "db/repositories/user.repo";
import jwt from "jsonwebtoken";
import CONFIG from "../config";

async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new AppError("Required user details missing!", 411);
    }

    const user = await UserRepo.getUserByUsername(username);

    if (user) {
      throw new AppError("User already exist with this phone or email", 400);
    }

    const newUser = await UserRepo.newUser(username, password);

    res.status(200).send(
      handleResponse("User successfully registered", 1, {
        username: newUser?.username || "",
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
}

async function signin(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new AppError("Required credentials missing", 411);
    }

    const user = await UserRepo.getUserByUsername(username);

    if (!user) {
      throw new AppError("User not found. Verify username", 404);
    }

    const verfied = await Bun.password.verify(password, user.password);

    if (!verfied) {
      throw new AppError("Incorrect password, verify credentials", 403);
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
      },
      CONFIG.jwt_secret_key,
      { expiresIn: "1d" }
    );
    res
      .status(200)
      .json(handleResponse("User successfully logged in", 1, { token }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
}

export { signup, signin };
