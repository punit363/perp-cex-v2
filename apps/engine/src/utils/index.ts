const engine_response = (message: string, status: number, data?: any) => {
  return {
    message: message || "Unrecognised engine request action",
    status: status || 0,
    data: data || null,
  };
};

const max = (a: bigint, b: bigint) => {
  return a > b ? a : b;
};

const min = (a: bigint, b: bigint) => {
  return a < b ? a : b;
};

const generate_trade_id = () => {
  return "tr_" + String(Math.random());
};

export { engine_response, max, min, generate_trade_id };
