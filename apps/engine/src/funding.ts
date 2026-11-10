import { divideRounded, multiplyFixed } from "./math/fixed-point";
import { FIXED_POINT_CONSTANTS, FUNDING_CONSTANTS } from "./config/constants";
import { calculateNotional } from "./math/financial-math";
import type Orderbook from "./orderbook";
import type { FundingBatch, FundingParticipant } from "./types";
import { PositionType } from "commons/src/order.type";

export const fundingIntervalEnd = (timestampMs: number): number => {
  return (
    (Math.floor(timestampMs / FUNDING_CONSTANTS.INTERVAL_MS) + 1) *
    FUNDING_CONSTANTS.INTERVAL_MS
  );
};

// apply a cap on +ve abd -ve funding rate
export const capFundingRate = (rate: bigint): bigint => {
  return rate > FUNDING_CONSTANTS.RATE_CAP
    ? FUNDING_CONSTANTS.RATE_CAP
    : rate < -FUNDING_CONSTANTS.RATE_CAP
      ? -FUNDING_CONSTANTS.RATE_CAP
      : rate;
};

/*
Sample Premium is the funding rate
A notional amount of 1000 is used to determine how many qty of asset can be bought at mark price giving us the targetQuantity
we use that targetQuantity to calculate average price for both bid and ask
this avg price is then used to find the premium that must be paid
+ve means longs pay short and -ve means short pays longs
*/

export const samplePremium = (
  orderbook: Orderbook,
  indexPrice: bigint
): bigint | null => {
  if (indexPrice <= 0n) return null;
  const targetQuantity = divideRounded(
    FUNDING_CONSTANTS.IMPACT_NOTIONAL * FIXED_POINT_CONSTANTS.SCALE,
    indexPrice,
    "ceil"
  );
  if (targetQuantity === 0n) return null;
  const impact = orderbook.getImpactPrices(targetQuantity);
  if (!impact || impact.bid >= impact.ask) return null; //coz if bid>=ask then trade should match
  const { bid, ask } = impact;
  return divideRounded(
    (bid + ask - 2n * indexPrice) * FIXED_POINT_CONSTANTS.SCALE,
    2n * indexPrice,
    "toward-zero"
  );
};

// Signed amount is positive for a recipient and negative for a payer.
export const calculateFundingPayments = (
  participants: FundingParticipant[],
  indexPrice: bigint,
  rate: bigint
): FundingBatch => {
  if (rate === 0n)
    return { payments: [], insuranceUsed: 0n, uncoveredShortfall: 0n };
  //set which side is paying and which side is recieving
  const payingSide = rate > 0n ? PositionType.LONG : PositionType.SHORT;

  const payers = participants
    .filter(({ position }) => position.type === payingSide)
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const receivers = participants
    .filter(({ position }) => position.type !== payingSide)
    .sort((a, b) => a.userId.localeCompare(b.userId));

  if (!payers.length || !receivers.length)
    return { payments: [], insuranceUsed: 0n, uncoveredShortfall: 0n };

  const absoluteRate = rate < 0n ? -rate : rate;
  //sums quantity of all positions on each side
  const payerQuantity = payers.reduce(
    (sum, item) => sum + item.position.quantity,
    0n
  );
  const receiverQuantity = receivers.reduce(
    (sum, item) => sum + item.position.quantity,
    0n
  );
  const matchedQuantity =
    payerQuantity < receiverQuantity ? payerQuantity : receiverQuantity;

  //create a pool of amount at current funding rate for least quantity
  const pool = multiplyFixed(
    calculateNotional(indexPrice, matchedQuantity),
    absoluteRate,
    "floor"
  );

  //allocate the average funding amount to each payer position owner based on their
  const allocate = (side: FundingParticipant[], totalQuantity: bigint) => {
    let allocated = 0n;
    const amounts = side.map(({ position }) => {
      const amount = divideRounded(
        pool * position.quantity,
        totalQuantity,
        "floor"
      );
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
  let uncoveredShortfall = 0n;
  const payerPayments = payers.map(({ userId, account, position }, index) => {
    const requestedAmount = payerAmounts[index]!;
    const spendable =
      account.collateral.available > 0n ? account.collateral.available : 0n;
      //calculate the payable funding amount available on user
    const availableDebit =
      requestedAmount < spendable ? requestedAmount : spendable;
    const remaining = requestedAmount - availableDebit; //deficit amount unavailble on user
    const marginCapacity =
      position.reserved_margin < account.collateral.reserved
        ? position.reserved_margin
        : account.collateral.reserved;
    const marginDebit = remaining < marginCapacity ? remaining : marginCapacity;
    //remove the margin from the deficit amount to check how mucht the user falls short
    const shortfall = remaining - marginDebit;
    const unpaid = shortfall;
    uncoveredShortfall += unpaid;
    return {
      userId,
      amount: -(availableDebit + marginDebit),
      requestedAmount,
      availableDebit,
      marginDebit,
      insuranceCovered: 0n,
      uncoveredShortfall: unpaid,
    };
  });
  //update the reciever side on the funding amount
  const receiverPool = pool - uncoveredShortfall;
  const receiverAmounts = (() => {
    let allocated = 0n;
    const amounts = receivers.map(({ position }) => {
      const amount = divideRounded(
        receiverPool * position.quantity,
        receiverQuantity,
        "floor"
      );
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
    userId,
    amount: receiverAmounts[index]!,
    requestedAmount: 0n,
    availableDebit: 0n,
    marginDebit: 0n,
    insuranceCovered: 0n,
    uncoveredShortfall: 0n,
  }));
  return {
    payments: [...payerPayments, ...receiverPayments].filter(
      (payment) =>
        payment.amount !== 0n ||
        payment.insuranceCovered !== 0n ||
        payment.uncoveredShortfall !== 0n
    ),
    insuranceUsed: 0n,
    uncoveredShortfall,
  };
};


/*
On every mark price update from the market_data service orderbook is sampled for a new funding rate
funding rate can be fixed by admin or can be calculated instead
on every 8th hour the market data service sends a request to engine to execute the funding
the samples collected are averaged and funding payment amounts are calculated
if a user does not have enough collateral they are liquidated
the calculated amounts are then transfered from payee to reciever

Positive premium: the perp book trades above spot, so longs will pay shorts.
Negative premium: the perp book trades below spot, so shorts will pay longs.
*/
