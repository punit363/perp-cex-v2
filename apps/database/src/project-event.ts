import type { DBEvent } from "commons/src/engine-event";
import { prisma } from "db";

export const projectEngineEvent = async (event: DBEvent) => {
  //create a trx to prevent data inconsistency during crash
  return prisma.$transaction(
    async (tx) => {
      //add new engine event
      const marker = await tx.processedEngineEvent.createMany({
        data: [{ source_message_id: event.source_message_id }],
        skipDuplicates: true,
      });

      // if engine event already exist skip to no procees same event twice
      if (marker.count === 0) {
        return Promise.all(
          event.changes.candles.map((candle) =>
            tx.candle.findUnique({
              where: {
                market_id_start_ms: {
                  market_id: candle.market_id,
                  start_ms: BigInt(candle.start_ms),
                },
              },
            })
          )
        ).then((candles) => candles.filter((candle) => candle !== null));
      }

      //update new orders
      for (const order of event.changes.orders) {
        await tx.order.createMany({
          data: [
            {
              order_id: order.order_id,
              user_id: order.user_id,
              market_id: order.market_id,
              type: order.type,
              side: order.side,
              status: order.status,
              price: BigInt(order.price),
              slippage: BigInt(order.slippage),
              quantity: BigInt(order.quantity),
              filled: BigInt(order.filled),
              leverage: BigInt(order.leverage),
              initial_margin: BigInt(order.initial_margin),
              initial_fee: BigInt(order.initial_fee),
              remaining_order_margin: BigInt(order.remaining_order_margin),
              remaining_order_fee: BigInt(order.remaining_order_fee),
            },
          ],
          skipDuplicates: true,
        });
      }

      // update new fills
      for (const fill of event.changes.fills) {
        const inserted = await tx.fill.createMany({
          data: [
            {
              trade_id: fill.trade_id,
              maker_order_id: fill.maker_order_id,
              taker_order_id: fill.taker_order_id,
              maker_user_id: fill.maker_user_id,
              taker_user_id: fill.taker_user_id,
              price: BigInt(fill.price),
              quantity: BigInt(fill.filled),
              maker_fee: BigInt(fill.maker_order_fee_consumed),
              taker_fee: BigInt(fill.taker_fee),
            },
          ],
          skipDuplicates: true,
        });

        //fill can never be updated as it is unique
        if (inserted.count !== 1) {
          throw new Error(
            `Duplicate fill in new event ${event.source_message_id}`
          );
        }
        //update orders that had changes due to a fill/trade
        await tx.order.update({
          where: { order_id: fill.maker_order_id },
          data: {
            filled: { increment: BigInt(fill.filled) },
            remaining_order_margin: {
              decrement: BigInt(fill.maker_order_margin_consumed),
            },
            remaining_order_fee: BigInt(fill.maker_order_fee_remaining),
            status: fill.maker_order_status,
          },
        });
      }

      //insert candle data
      for (const candle of event.changes.candles) {
        await tx.$executeRaw`
        INSERT INTO "Candle" ("market_id", "start_ms", "open", "high", "low", "close", "base_volume", "quote_volume", "trade_count")
        VALUES (${candle.market_id}, ${BigInt(candle.start_ms)}, ${BigInt(candle.open)}, ${BigInt(candle.high)}, ${BigInt(candle.low)}, ${BigInt(candle.close)}, ${BigInt(candle.base_volume)}, ${BigInt(candle.quote_volume)}, ${candle.trade_count})
        ON CONFLICT ("market_id", "start_ms") DO UPDATE SET
          "high" = GREATEST("Candle"."high", EXCLUDED."high"),
          "low" = LEAST("Candle"."low", EXCLUDED."low"),
          "close" = EXCLUDED."close",
          "base_volume" = "Candle"."base_volume" + EXCLUDED."base_volume",
          "quote_volume" = "Candle"."quote_volume" + EXCLUDED."quote_volume",
          "trade_count" = "Candle"."trade_count" + EXCLUDED."trade_count"
      `;
      }

      //update changes in existing order mostly due to cancellation/liquidation
      for (const update of event.changes.order_updates) {
        await tx.order.update({
          where: {
            order_id: update.order_id,
            user_id: update.user_id,
            market_id: update.market_id,
          },
          data: {
            status: update.status,
            remaining_order_margin: BigInt(update.remaining_order_margin),
            remaining_order_fee: BigInt(update.remaining_order_fee),
          },
        });
      }

      //update positions
      for (const change of event.changes.positions) {
        if (change.position === null) {
          //if a change does not provide current position delete the existing position from db
          await tx.position.deleteMany({
            where: { user_id: change.user_id, market_id: change.market_id },
          });
          continue;
        }
        const position = change.position;
        const data = {
          user_id: change.user_id,
          market_id: change.market_id,
          type: position.type,
          quantity: BigInt(position.quantity),
          reserved_margin: BigInt(position.reserved_margin),
          avg_entry_price: BigInt(position.avg_entry_price),
          unrealized_pnl: BigInt(position.unrealized_pnl),
          funding_accrued: BigInt(position.funding_accrued),
          state: position.state,
          liquidation_id: position.liquidation_id ?? null,
          liquidation_attempts: position.liquidation_attempts,
        };
        //add or update positions
        await tx.position.upsert({
          where: {
            user_id_market_id: {
              user_id: change.user_id,
              market_id: change.market_id,
            },
          },
          update: data,
          create: data,
        });
      }

      //add or update user collateral
      for (const balance of event.changes.balances) {
        await tx.collateral.upsert({
          where: { user_id: balance.user_id },
          update: {
            available: BigInt(balance.available),
            reserved: BigInt(balance.reserved),
          },
          create: {
            user_id: balance.user_id,
            available: BigInt(balance.available),
            reserved: BigInt(balance.reserved),
          },
        });
      }

      //update funding interval event details after each occurence
      for (const interval of event.changes.funding_intervals) {
        const inserted = await tx.fundingInterval.createMany({
          data: [
            {
              market_id: interval.market_id,
              interval_end_ms: BigInt(interval.interval_end_ms),
              index_price: BigInt(interval.index_price),
              rate: BigInt(interval.rate),
              sample_count: interval.sample_count,
              status: interval.status,
              total_paid: BigInt(interval.total_paid),
              insurance_used: BigInt(interval.insurance_used),
              uncovered_shortfall: BigInt(interval.uncovered_shortfall),
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count !== 1)
          throw new Error(
            `Duplicate funding interval ${interval.market_id}:${interval.interval_end_ms}`
          );
      }

      //update payment details for each user during funding interval
      if (event.changes.funding_payments.length) {
        await tx.fundingPayment.createMany({
          data: event.changes.funding_payments.map((payment) => ({
            market_id: payment.market_id,
            interval_end_ms: BigInt(payment.interval_end_ms),
            user_id: payment.user_id,
            amount: BigInt(payment.amount),
            requested_amount: BigInt(payment.requested_amount),
            available_debit: BigInt(payment.available_debit),
            margin_debit: BigInt(payment.margin_debit),
            insurance_covered: BigInt(payment.insurance_covered),
            uncovered_shortfall: BigInt(payment.uncovered_shortfall),
          })),
        });
      }

      //update insurance fund data
      for (const change of event.changes.insurance_fund) {
        const data = {
          balance: BigInt(change.balance),
          total_liquidation_fees: BigInt(change.total_liquidation_fees),
          total_trading_fees: BigInt(change.total_trading_fees),
          total_liquidation_surplus: BigInt(change.total_liquidation_surplus),
          total_shortfall_covered: BigInt(change.total_shortfall_covered),
          total_uncovered_shortfall: BigInt(change.total_uncovered_shortfall),
        };
        await tx.insuranceFund.upsert({
          where: { collateral_asset: change.collateral_asset },
          update: data,
          create: { collateral_asset: change.collateral_asset, ...data },
        });

        //update the ledger of insurance fund
        if (change.entries.length) {
          await tx.insuranceFundLedgerEntry.createMany({
            data: change.entries.map((entry) => ({
              entry_id: entry.entry_id,
              collateral_asset: change.collateral_asset,
              market_id: entry.market_id,
              user_id: entry.user_id,
              liquidation_order_id: entry.liquidation_order_id,
              funding_interval_end_ms:
                entry.funding_interval_end_ms == null
                  ? null
                  : BigInt(entry.funding_interval_end_ms),
              type: entry.type,
              amount: BigInt(entry.amount),
              balance_after: BigInt(entry.balance_after),
              uncovered_shortfall: BigInt(entry.uncovered_shortfall),
            })),
            skipDuplicates: true,
          });
        }
      }

      //update trading fee
      for (const change of event.changes.trading_fee_account) {
        const data = {
          balance: BigInt(change.balance),
          total_maker_fees: BigInt(change.total_maker_fees),
          total_taker_fees: BigInt(change.total_taker_fees),
        };

        //update trading fee account
        await tx.tradingFeeAccount.upsert({
          where: { collateral_asset: change.collateral_asset },
          update: data,
          create: { collateral_asset: change.collateral_asset, ...data },
        });

        //update trading fee ledger
        if (change.entries.length) {
          await tx.tradingFeeLedgerEntry.createMany({
            data: change.entries.map((entry) => ({
              entry_id: entry.entry_id,
              collateral_asset: change.collateral_asset,
              trade_id: entry.trade_id,
              order_id: entry.order_id,
              market_id: entry.market_id,
              user_id: entry.user_id,
              role: entry.role,
              amount: BigInt(entry.amount),
              balance_after: BigInt(entry.balance_after),
            })),
            skipDuplicates: true,
          });
        }
      }

      //log liquidation
      for (const attempt of event.changes.liquidation_attempts) {
        const totals = {
          total_filled: BigInt(attempt.filled_quantity),
          total_realized_pnl: BigInt(attempt.realized_pnl),
          total_liquidation_fee: BigInt(attempt.liquidation_fee),
          total_user_refund: BigInt(attempt.user_refund),
          total_shortfall_covered: BigInt(attempt.shortfall_covered),
          total_uncovered_shortfall: BigInt(attempt.uncovered_shortfall),
        };

        //update/create liquidation on user position
        await tx.liquidation.upsert({
          where: { liquidation_id: attempt.liquidation_id },
          create: {
            liquidation_id: attempt.liquidation_id,
            user_id: attempt.user_id,
            market_id: attempt.market_id,
            status: attempt.status,
            initial_quantity: BigInt(attempt.initial_quantity),
            remaining_quantity: BigInt(attempt.remaining_quantity),
            attempts: attempt.attempt,
            ...totals,
          },
          update: {
            status: attempt.status,
            remaining_quantity: BigInt(attempt.remaining_quantity),
            attempts: attempt.attempt,
            total_filled: { increment: totals.total_filled },
            total_realized_pnl: { increment: totals.total_realized_pnl },
            total_liquidation_fee: { increment: totals.total_liquidation_fee },
            total_user_refund: { increment: totals.total_user_refund },
            total_shortfall_covered: {
              increment: totals.total_shortfall_covered,
            },
            total_uncovered_shortfall: {
              increment: totals.total_uncovered_shortfall,
            },
          },
        });

        //record each liquidation attempt
        await tx.liquidationAttempt.create({
          data: {
            attempt_id: attempt.attempt_id,
            liquidation_id: attempt.liquidation_id,
            user_id: attempt.user_id,
            market_id: attempt.market_id,
            status: attempt.status,
            attempt: attempt.attempt,
            initial_quantity: BigInt(attempt.initial_quantity),
            filled_quantity: BigInt(attempt.filled_quantity),
            remaining_quantity: BigInt(attempt.remaining_quantity),
            mark_price: BigInt(attempt.mark_price),
            realized_pnl: BigInt(attempt.realized_pnl),
            liquidation_fee: BigInt(attempt.liquidation_fee),
            user_refund: BigInt(attempt.user_refund),
            shortfall_covered: BigInt(attempt.shortfall_covered),
            uncovered_shortfall: BigInt(attempt.uncovered_shortfall),
          },
        });
      }

      //update market data
      for (const change of event.changes.market_data) {
        await tx.market.update({
          where: { market_id: change.market_id },
          data: {
            ...(change.mark_price !== undefined && {
              mark_price: BigInt(change.mark_price),
            }),
            ...(change.last_traded_price !== undefined && {
              last_traded_price: BigInt(change.last_traded_price),
            }),
            ...(change.last_trade_id !== undefined && {
              last_trade_id: change.last_trade_id,
            }),
            ...(change.trading_halted !== undefined && {
              trading_halted: change.trading_halted,
            }),
            ...(change.maintenance_margin_rate !== undefined && {
              maintenance_margin_rate: BigInt(change.maintenance_margin_rate),
            }),
            ...(change.liquidation_fee_rate !== undefined && {
              liquidation_fee_rate: BigInt(change.liquidation_fee_rate),
            }),
            ...(change.max_leverage !== undefined && {
              max_leverage:
                change.max_leverage === null
                  ? null
                  : BigInt(change.max_leverage),
            }),
            ...(change.max_liquidation_quantity !== undefined && {
              max_liquidation_quantity:
                change.max_liquidation_quantity === null
                  ? null
                  : BigInt(change.max_liquidation_quantity),
            }),
            ...(change.funding_fixed_rate !== undefined && {
              funding_fixed_rate:
                change.funding_fixed_rate === null
                  ? null
                  : BigInt(change.funding_fixed_rate),
            }),
            ...(change.funding_last_rate !== undefined && {
              funding_last_rate: BigInt(change.funding_last_rate),
            }),
            ...(change.last_funding_ms !== undefined && {
              last_funding_ms: BigInt(change.last_funding_ms),
            }),
            ...(change.next_funding_ms !== undefined && {
              next_funding_ms: BigInt(change.next_funding_ms),
            }),
          },
        });
      }

      //fetch market candle data
      const persisted = await Promise.all(
        event.changes.candles.map((candle) =>
          tx.candle.findUnique({
            where: {
              market_id_start_ms: {
                market_id: candle.market_id,
                start_ms: BigInt(candle.start_ms),
              },
            },
          })
        )
      );
      return persisted.filter((candle) => candle !== null);
    },
    { timeout: 30000 }
  );
};
