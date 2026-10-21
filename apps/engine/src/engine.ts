import type { EngineCommand } from "./zod/z";

const process_engine_order = async (request: EngineCommand) => {
  switch (request.action) {
    case "ONRAMP":
      break;
    case "PLACE_ORDER":
      break;
    case "CANCEL_ORDER":
      break;
    case "GET_DEPTH":
      break;
    case "SPOT_PRICE_UPDATE":
      break;
    case "GET_FUNDING_RATE":
      break;
  }
};

export default process_engine_order;
