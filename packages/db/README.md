# Database package

After starting PostgreSQL and applying the Prisma migrations, create the markets
represented by the frontend icons from this directory:

```sh
bun run seed:markets
```

The command creates 18 pairs. AAVE, DOT, GRT, MATIC, and SOL are quoted in ETH;
the remaining base assets are quoted in USDT. USD and USDT icons represent quote
or collateral assets. The command can be run again: it skips existing slugs and
updates their icon paths when needed.

To type check, run `bun check`.
