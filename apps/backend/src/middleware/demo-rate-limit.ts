import type { NextFunction, Request, Response } from "express";
import { handleError } from "../utils/handler";

type Window = { count: number; expiresAt: number };

//limit : max no of request allowed in window time 
//windowMs : window time in milisec
//keyFor : to decide what is used for rate limiting, user_id, ipor api key
export function demoRateLimit(limit: number, windowMs: number, keyFor: (request: Request) => string) {
  const windows = new Map<string, Window>();

  //after every window interval revisit each key and delete if expiry time is past the present time
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, window] of windows) {
      if (window.expiresAt <= now) windows.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return (request: Request, response: Response, next: NextFunction) => {
    const key = keyFor(request);
    const now = Date.now();
    let window = windows.get(key);
    if (!window || window.expiresAt <= now) {
      //create a window of expiry time and no req allowed keyed to the unique id(ip/user_id etc) available in that request
      window = { count: 0, expiresAt: now + windowMs };
      windows.set(key, window);
    }

    if (window.count >= limit) {
      //block request if the allowed limit is exceeded
      response.setHeader("Retry-After", Math.ceil((window.expiresAt - now) / 1000));
      response.status(429).json(handleError("Too many requests. Please try again later.", 0));
      return;
    }

    window.count += 1;
    next();
  };
}
//NOTE: good enough for start but too many drawbacks