import { divideRounded, multiplyFixed, parseFixed, SCALE } from "./math/fixed-point";
import { calculateNotional } from "./math/financial-math";
import type Orderbook from "./orderbook";
import type { Position, UserAccount } from "./types";
import { PositionType } from "commons/src/order.type";

export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const FUNDING_RATE_CAP = parseFixed("0.005");
export const FUNDING_IMPACT_NOTIONAL = parseFixed("1000");
export const MIN_FUNDING_SAMPLES = 30;

export type FundingState = {
  lastSettledIntervalMs: number;
  fixedRate: bigint | null;
  premiumSum: bigint;
  premiumSamples: number;
  premiumIntervalMs: number;
  lastRate: bigint;
};

export function fundingIntervalEnd(timestampMs: number): number {
  return (Math.floor(timestampMs / FUNDING_INTERVAL_MS) + 1) * FUNDING_INTERVAL_MS;
}

export function clampFundingRate(rate: bigint): bigint {
  return rate > FUNDING_RATE_CAP ? FUNDING_RATE_CAP
    : rate < -FUNDING_RATE_CAP ? -FUNDING_RATE_CAP : rate;
}

export function samplePremium(orderbook: Orderbook, indexPrice: bigint): bigint | null {
  if (indexPrice <= 0n) return null;
  const targetQuantity = divideRounded(FUNDING_IMPACT_NOTIONAL * SCALE, indexPrice, "ceil");
  if (targetQuantity === 0n) return null;
  const impact = orderbook.getImpactPrices(targetQuantity);
  if (!impact || impact.bid >= impact.ask) return null;
  const { bid, ask } = impact;
  return divideRounded((bid + ask - 2n * indexPrice) * SCALE, 2n * indexPrice, "toward-zero");
}

export type FundingParticipant = { userId: string; account: UserAccount; position: Position };
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

/** Signed amount is positive for a recipient and negative for a payer. */
export function calculateFundingPayments(
  participants: FundingParticipant[], indexPrice: bigint, rate: bigint, insuranceAvailable = 0n,
): FundingBatch {
  if (rate === 0n) return { payments: [], insuranceUsed: 0n, uncoveredShortfall: 0n };
  const payingSide = rate > 0n ? PositionType.LONG : PositionType.SHORT;
  const payers = participants.filter(({ position }) => position.type === payingSide).sort((a, b) => a.userId.localeCompare(b.userId));
  const receivers = participants.filter(({ position }) => position.type !== payingSide).sort((a, b) => a.userId.localeCompare(b.userId));
  if (!payers.length || !receivers.length) return { payments: [], insuranceUsed: 0n, uncoveredShortfall: 0n };
  const absoluteRate = rate < 0n ? -rate : rate;
  const payerQuantity = payers.reduce((sum, item) => sum + item.position.quantity, 0n);
  const receiverQuantity = receivers.reduce((sum, item) => sum + item.position.quantity, 0n);
  const matchedQuantity = payerQuantity < receiverQuantity ? payerQuantity : receiverQuantity;
  const pool = multiplyFixed(calculateNotional(indexPrice, matchedQuantity), absoluteRate, "floor");
  const allocate = (side: FundingParticipant[], totalQuantity: bigint) => {
    let allocated = 0n;
    const amounts = side.map(({ position }) => {
      const amount = divideRounded(pool * position.quantity, totalQuantity, "floor");
      allocated += amount;
      return amount;
    });
    for (let i = 0; allocated < pool; i = (i + 1) % amounts.length) {
      amounts[i]! += 1n;
      allocated += 1n;
    }
    return amounts;
  };
  const payerAmounts = allocate(payers, payerQuantity);
  let remainingInsurance = insuranceAvailable;
  let insuranceUsed = 0n;
  let uncoveredShortfall = 0n;
  const payerPayments = payers.map(({ userId, account, position }, index) => {
    const requestedAmount = payerAmounts[index]!;
    const spendable = account.collateral.available > 0n ? account.collateral.available : 0n;
    const availableDebit = requestedAmount < spendable ? requestedAmount : spendable;
    const remaining = requestedAmount - availableDebit;
    const marginCapacity = position.reserved_margin < account.collateral.reserved
      ? position.reserved_margin : account.collateral.reserved;
    const marginDebit = remaining < marginCapacity ? remaining : marginCapacity;
    const shortfall = remaining - marginDebit;
    const insuranceCovered = shortfall < remainingInsurance ? shortfall : remainingInsurance;
    remainingInsurance -= insuranceCovered;
    insuranceUsed += insuranceCovered;
    const unpaid = shortfall - insuranceCovered;
    uncoveredShortfall += unpaid;
    return { userId, amount: -(availableDebit + marginDebit), requestedAmount,
      availableDebit, marginDebit, insuranceCovered, uncoveredShortfall: unpaid };
  });
  const receiverPool = pool - uncoveredShortfall;
  const receiverAmounts = (() => {
    let allocated = 0n;
    const amounts = receivers.map(({ position }) => {
      const amount = divideRounded(receiverPool * position.quantity, receiverQuantity, "floor");
      allocated += amount;
      return amount;
    });
    for (let i = 0; allocated < receiverPool; i = (i + 1) % amounts.length) {
      amounts[i]! += 1n;
      allocated += 1n;
    }
    return amounts;
  })();
  const receiverPayments = receivers.map(({ userId }, index) => ({
    userId, amount: receiverAmounts[index]!, requestedAmount: 0n,
    availableDebit: 0n, marginDebit: 0n, insuranceCovered: 0n, uncoveredShortfall: 0n,
  }));
  return { payments: [...payerPayments, ...receiverPayments].filter((payment) =>
    payment.amount !== 0n || payment.insuranceCovered !== 0n || payment.uncoveredShortfall !== 0n),
    insuranceUsed, uncoveredShortfall };
}
