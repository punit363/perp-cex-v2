import type {
  InsuranceFundLedgerEntry,
  InsuranceFundSettlement,
  SnapshotInsuranceFund,
  SettlementInput,
  FeeCharge,
} from "../types";

class InsuranceFund {
  private balance: bigint; // total insurance fund
  private totalLiquidationFees: bigint; // total funds from liquidation fee
  private totalTradingFees: bigint; // maker and taker fee shares received
  private totalLiquidationSurplus: bigint;
  private totalShortfallCovered: bigint; // funds used to cover funding and liquidation shortfall
  private totalUncoveredShortfall: bigint; // shortfall the fund could not cover

  constructor(
    private readonly collateralAsset: string,
    initialBalance: bigint,
    snapshot?: SnapshotInsuranceFund
  ) {
    if (initialBalance < 0n) {
      throw new Error("Insurance fund initial balance cannot be negative");
    }
    if (snapshot && snapshot.collateral_asset !== collateralAsset) {
      throw new Error(
        `Insurance fund collateral mismatch: expected ${collateralAsset}, received ${snapshot.collateral_asset}`
      );
    }

    this.balance = snapshot ? BigInt(snapshot.balance) : initialBalance;
    this.totalLiquidationFees = snapshot
      ? BigInt(snapshot.total_liquidation_fees)
      : 0n;
    this.totalTradingFees = BigInt(snapshot?.total_trading_fees ?? "0");
    this.totalLiquidationSurplus = snapshot
      ? BigInt(snapshot.total_liquidation_surplus)
      : 0n;
    this.totalShortfallCovered = snapshot
      ? BigInt(snapshot.total_shortfall_covered)
      : 0n;
    this.totalUncoveredShortfall = snapshot
      ? BigInt(snapshot.total_uncovered_shortfall)
      : 0n;
  }

  settleLiquidation = (input: SettlementInput): InsuranceFundSettlement => {
    const entries: InsuranceFundLedgerEntry[] = [];
    let liquidation_fee = 0n;
    let liquidation_surplus = 0n;
    let user_refund = 0n;
    let shortfall_covered = 0n;
    let uncovered_shortfall = 0n;

    //execution_equity = allocatedMargin + realizedPnl + allocatedFunding for each fill
    // it basically tells wheather each fill trade was a loss or a profit
    // if the trade was profit take liquidation fee in insurance fund
    if (input.execution_equity >= 0n) {
      liquidation_fee =
        input.requested_liquidation_fee < input.execution_equity
          ? input.requested_liquidation_fee
          : input.execution_equity;
      user_refund = input.execution_equity - liquidation_fee;

      if (liquidation_fee > 0n) {
        this.balance += liquidation_fee;
        this.totalLiquidationFees += liquidation_fee;
        entries.push(
          this.createEntry(
            input,
            "LIQUIDATION_FEE",
            liquidation_fee,
            this.balance
          )
        );
      }
      //else use insurance fund to cover shortfall
    } else {
      const shortfall = -input.execution_equity;
      shortfall_covered = this.balance < shortfall ? this.balance : shortfall;
      uncovered_shortfall = shortfall - shortfall_covered;

      if (shortfall_covered > 0n) {
        this.balance -= shortfall_covered;
        this.totalShortfallCovered += shortfall_covered;
        entries.push(
          this.createEntry(
            input,
            "SHORTFALL_COVER",
            -shortfall_covered,
            this.balance
          )
        );
      }
      if (uncovered_shortfall > 0n) {
        this.totalUncoveredShortfall += uncovered_shortfall;
        entries.push(
          this.createEntry(
            input,
            "UNCOVERED_SHORTFALL",
            0n,
            this.balance,
            uncovered_shortfall
          )
        );
      }
    }

    return {
      collateral_asset: this.collateralAsset,
      balance: this.balance,
      total_liquidation_fees: this.totalLiquidationFees,
      total_trading_fees: this.totalTradingFees,
      total_liquidation_surplus: this.totalLiquidationSurplus,
      total_shortfall_covered: this.totalShortfallCovered,
      total_uncovered_shortfall: this.totalUncoveredShortfall,
      liquidation_fee,
      liquidation_surplus,
      user_refund,
      shortfall_covered,
      uncovered_shortfall,
      entries,
    };
  };

  available = (): bigint => {
    return this.balance;
  };

  //add half trading fee to insurance fund
  collectTradingFeeShares = (
    shares: FeeCharge[]
  ): SnapshotInsuranceFund & { entries: InsuranceFundLedgerEntry[] } => {
    const entries: InsuranceFundLedgerEntry[] = [];
    for (const share of shares) {
      if (share.amount < 0n)
        throw new Error("Trading fee share cannot be negative");
      if (share.amount === 0n) continue;
      this.balance += share.amount;
      this.totalTradingFees += share.amount;
      entries.push({
        entry_id: `${share.trade_id}:${share.role}:insurance`,
        market_id: share.market_id,
        user_id: share.user_id,
        liquidation_order_id: null,
        type: share.role === "MAKER" ? "MAKER_FEE_SHARE" : "TAKER_FEE_SHARE",
        amount: share.amount,
        balance_after: this.balance,
        uncovered_shortfall: 0n,
      });
    }
    return { ...this.snapshot(), entries };
  };

  // incase there is a shortfall during funding
  coverFundingShortfall = (
    amount: bigint,
    market_id: string,
    user_id: string,
    interval_end_ms: number
  ): SnapshotInsuranceFund & { entries: InsuranceFundLedgerEntry[] } => {
    if (amount < 0n || amount > this.balance) {
      throw new Error("Funding shortfall exceeds insurance fund balance");
    }
    this.balance -= amount;
    this.totalShortfallCovered += amount;
    return {
      ...this.snapshot(),
      entries: [
        {
          entry_id: `funding:${market_id}:${interval_end_ms}:${user_id}:cover`,
          market_id,
          user_id,
          liquidation_order_id: null,
          funding_interval_end_ms: interval_end_ms,
          type: "FUNDING_SHORTFALL_COVER",
          amount: -amount,
          balance_after: this.balance,
          uncovered_shortfall: 0n,
        },
      ],
    };
  };

  snapshot = (): SnapshotInsuranceFund => {
    return {
      collateral_asset: this.collateralAsset,
      balance: String(this.balance),
      total_liquidation_fees: String(this.totalLiquidationFees),
      total_trading_fees: String(this.totalTradingFees),
      total_liquidation_surplus: String(this.totalLiquidationSurplus),
      total_shortfall_covered: String(this.totalShortfallCovered),
      total_uncovered_shortfall: String(this.totalUncoveredShortfall),
    };
  };

  //format for insurance fund reply
  private createEntry = (
    input: SettlementInput,
    type: InsuranceFundLedgerEntry["type"],
    amount: bigint,
    balance_after: bigint,
    uncovered_shortfall = 0n
  ): InsuranceFundLedgerEntry => {
    return {
      entry_id: `${input.entry_id_prefix}:${type}`,
      market_id: input.market_id,
      user_id: input.user_id,
      liquidation_order_id: input.liquidation_order_id,
      type,
      amount,
      balance_after,
      uncovered_shortfall,
    };
  };
}

export default InsuranceFund;

/*
Insurance fund is created with all of the liquidation fee and half of both maker and taker fee
on liquidation users final equity for each trade is checked if -ve it is compensated by fund else a liquidation fee is cut from the final equity
for each funding session the deficit(if any) is insured by this fund
*/
