import type {
  Position,
  SnapshotAccount,
  SnapshotPosition,
  UserAccount,
} from "./types";

class AccountStore {
  private accounts = new Map<string, UserAccount>();

  constructor(accounts: SnapshotAccount[]) {
    accounts.forEach((account) => {
      const positions = new Map<string, Position>(
        account.positions.map((position): [string, Position] => {
          const position_data: Position = {
            market_id: position.market_id,
            type: position.type,
            quantity: BigInt(position.quantity),
            reserved_margin: BigInt(position.reserved_margin),
            avg_entry_price: BigInt(position.avg_entry_price),
            unrealized_pnl: BigInt(position.unrealized_pnl),
            funding_accrued: BigInt(position.funding_accrued),
          };
          return [position.market_id, position_data];
        })
      );

      this.accounts.set(account.user_id, {
        user_id: account.user_id,
        collateral: {
          available: BigInt(account.collateral.available),
          reserved: BigInt(account.collateral.reserved),
        },
        positions,
        orders: new Set(),
      });
    });
  }

  get(user_id: string): UserAccount | undefined {
    return this.accounts.get(user_id);
  }

  getOrCreate(user_id: string): UserAccount {
    let account = this.accounts.get(user_id);
    if (!account) {
      account = {
        user_id,
        collateral: { available: 0n, reserved: 0n },
        positions: new Map(),
        orders: new Set<string>(),
      };
      this.accounts.set(user_id, account);
    }
    return account;
  }

  snapshotAccount(): SnapshotAccount[] {
    const accounts: SnapshotAccount[] = [];
    this.accounts.forEach((acc) => {
      const user: SnapshotAccount = {
        user_id: acc.user_id,
        collateral: {
          reserved: String(acc.collateral.reserved),
          available: String(acc.collateral.available),
        },
        positions: Array.from(acc.positions, ([_, position]) => {
          const position_data: SnapshotPosition = {
            market_id: position.market_id,
            type: position.type,
            quantity: String(position.quantity),
            reserved_margin: String(position.reserved_margin),
            avg_entry_price: String(position.avg_entry_price),
            unrealized_pnl: String(position.unrealized_pnl),
            funding_accrued: String(position.funding_accrued),
          };
          return position_data;
        }),
      };
      accounts.push(user);
    });
    return accounts;
  }

  credit(user_id: string, amount: bigint): void {
    const account = this.getOrCreate(user_id);
    account.collateral.available += amount;
  }

  debitMargin(user_id: string, amount: bigint): void {
    const account = this.getOrCreate(user_id);
    account.collateral.reserved -= amount;
  }

  reserveMargin(user_id: string, amount: bigint): void {
    const account = this.accounts.get(user_id);
    if (!account) {
      throw new Error("User not found");
    }
    if (account.collateral.available < amount) {
      throw new Error("Insufficient funds");
    }

    account.collateral.available -= amount;
    account.collateral.reserved += amount;
  }

  releaseMargin(user_id: string, amount: bigint): void {
    const account = this.accounts.get(user_id);
    if (!account) {
      throw new Error("User not found");
    }

    account.collateral.available += amount;
    account.collateral.reserved -= amount;
  }
}

export default AccountStore;
