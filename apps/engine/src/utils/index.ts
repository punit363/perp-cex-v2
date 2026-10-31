const engine_response = (message: string, status: number, data?: unknown) => {
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

const generate_trade_id = (taker_order_id: string, fill_index: number) =>
  `tr_${taker_order_id}_${fill_index}`;

const generate_liquidation_order_id = (
  source_message_id: string,
  user_id: string,
  market_id: string,
  liquidation_index: number
) => `odr_liq_${source_message_id}_${liquidation_index}_${user_id}_${market_id}`;

export {
  engine_response,
  max,
  min,
  generate_trade_id,
  generate_liquidation_order_id,
};
