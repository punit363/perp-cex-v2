import type { PositionType } from "commons/src/order.type";

interface CollateralBalance {
  available: bigint;
  reserved: bigint;
}

interface Position {
  market_id: string;
  type: PositionType;
  quantity: bigint;
  reserved_margin: bigint;
  entry_price: bigint;
  realized_pnl: bigint;
  funding_accrued:bigint
}

interface UserAccount {
    user_id:string,
    collateral:CollateralBalance,
    position:Map<string,Position>, //market_id
    orders:Set<string>  //Order_id
}