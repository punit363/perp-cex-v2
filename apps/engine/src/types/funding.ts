import type { Position, UserAccount } from "./account";

export type FundingState = {
  lastSettledIntervalMs: number;
  fixedRate: bigint | null;
  premiumSum: bigint;// sum of all the premium sample whose funding rate is to be averaged
  premiumSamples: number; // no of premium samples
  premiumIntervalMs: number;
  lastRate: bigint;
};

export type FundingParticipant = {
  userId: string;
  account: UserAccount;
  position: Position;
};

export type FundingPayment = {
  userId: string;
  amount: bigint;
  requestedAmount: bigint;
  availableDebit: bigint;
  marginDebit: bigint;
  insuranceCovered: bigint;
  uncoveredShortfall: bigint;
};

export type FundingBatch = {
  payments: FundingPayment[];
  insuranceUsed: bigint;
  uncoveredShortfall: bigint;
};
