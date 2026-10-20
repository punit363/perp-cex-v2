import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import CONFIG from "../config";
import { handleError } from "../utils/handler";

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log("token", "++++++++");
    const token = req.headers.token as string;
    const decrypted = jwt.verify(token, CONFIG.jwt_secret_key) as JwtPayload;

    req.user_id = decrypted.id;
    next();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res
      .status((error as { status_code?: number })?.status_code || 500)
      .send(handleError(err.message, 0));
  }
};
