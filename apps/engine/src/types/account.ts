import type { PositionType } from 'commons/src/order.type';

export interface CollateralBalance {
  available: bigint;
  reserved: bigint;
}

export enum PositionState {
  HEALTHY = "HEALTHY",
  LIQUIDATING = "LIQUIDATING",
  BANKRUPT = "BANKRUPT",
}

export interface Position {
  market_id: string;
  type: PositionType;
  quantity: bigint;
  reserved_margin: bigint;
  avg_entry_price: bigint;
  unrealized_pnl: bigint;
  funding_accrued: bigint;
  state: PositionState;
  liquidation_id?: string;
  liquidation_attempts: number;
}

export interface UserAccount {
  user_id: string;
  collateral: CollateralBalance;
  positions: Map<string, Position>; //market_id
  orders: Set<string>; //Order_id
}
