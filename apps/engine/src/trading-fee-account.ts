import type {
  SnapshotTradingFeeAccount,
  TradingFeeSettlement,
  FeeCharge,
} from "./types";

class TradingFeeAccount {
  private balance: bigint;
  private totalMakerFees: bigint;
  private totalTakerFees: bigint;

  constructor(
    private readonly collateralAsset: string,
    snapshot?: SnapshotTradingFeeAccount
  ) {
    if (snapshot && snapshot.collateral_asset !== collateralAsset) {
      throw new Error(
        `Trading fee collateral mismatch: expected ${collateralAsset}, received ${snapshot.collateral_asset}`
      );
    }
    this.balance = snapshot ? BigInt(snapshot.balance) : 0n;
    this.totalMakerFees = snapshot ? BigInt(snapshot.total_maker_fees) : 0n;
    this.totalTakerFees = snapshot ? BigInt(snapshot.total_taker_fees) : 0n;
  }

  collect = (charges: FeeCharge[]): TradingFeeSettlement => {
    const entries = charges
      .filter((charge) => charge.amount > 0n)
      .map((charge) => {
        this.balance += charge.amount;
        if (charge.role === "MAKER") {
          this.totalMakerFees += charge.amount;
        } else {
          this.totalTakerFees += charge.amount;
        }
        return {
          entry_id: `${charge.trade_id}:${charge.role}`,
          ...charge,
          balance_after: this.balance
        };
      });

    return {
      collateral_asset: this.collateralAsset,
      balance: this.balance,
      total_maker_fees: this.totalMakerFees,
      total_taker_fees: this.totalTakerFees,
      entries
    };
  };

  snapshot = (): SnapshotTradingFeeAccount => {
    return {
      collateral_asset: this.collateralAsset,
      balance: String(this.balance),
      total_maker_fees: String(this.totalMakerFees),
      total_taker_fees: String(this.totalTakerFees)
    };
  };
}

export default TradingFeeAccount;
