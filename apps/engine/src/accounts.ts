import type { UserAccount } from "./types";

class AccountStore {
  private accounts = new Map<string, UserAccount>();

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
