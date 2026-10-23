import { formatFixed } from "./math/fixed-point";
import type { EngineResponse, UserAccount } from "./types";
import { engine_response } from "./utils";
import type { EngineCommand } from "./zod/z";

const user_accounts = new Map<string, UserAccount>();

const process_engine_order = (request: EngineCommand) => {
  switch (request.action) {
    case "ONRAMP": {
      const amount = request.amount;
      const user_id = request.user_id;

      if (amount <= 0) {
        return engine_response("Cannot ramp negative value", 0);
      }

      const user_acc = user_accounts.get(user_id);
      if (!user_acc) {
        const collateral = {
          reserved: 0n,
          available: amount,
        };

        const user = {
          user_id,
          collateral,
          positions: new Map(),
          orders: new Set<string>(),
        };

        user_accounts.set(user_id, user);
      } else {
        user_acc.collateral.available += amount;
      }

      return engine_response("Onramp successfull", 1);
    }
    case "GET_BALANCE": {
      const user_acc = user_accounts.get(request.user_id);
      if (!user_acc) {
        return engine_response("User Account does not exist", 0);
      }

      const balance = {
        available: formatFixed(user_acc.collateral.available),
        reserved: formatFixed(user_acc.collateral.reserved),
      };

      return engine_response("Balance Retrieved", 1, balance);
    }
    case "PLACE_ORDER": {
      return engine_response("Updating soon", 0);
    }
    case "CANCEL_ORDER": {
      return engine_response("Updating soon", 0);
    }
    case "GET_DEPTH": {
      return engine_response("Updating soon", 0);
    }
    case "SPOT_PRICE_UPDATE": {
      return engine_response("Updating soon", 0);
    }
    case "GET_FUNDING_RATE": {
      return engine_response("Updating soon", 0);
    }
    default:
      const response: EngineResponse = {
        message: "Unrecognised engine request action",
        status: 0,
        data: null,
      };

      return response;
  }
};

export default process_engine_order;
