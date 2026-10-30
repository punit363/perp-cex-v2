import type { CSSProperties } from "react";

type Balance = { available: string; reserved: string };

function parseAmount(value: string) {
  const match = /^(-?\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) return null;
  const fraction = BigInt((match[2] || "").padEnd(8, "0") || "0");
  return BigInt(match[1]!) * 100_000_000n + (value.startsWith("-") ? -fraction : fraction);
}

function formatAmount(value: bigint) {
  const absolute = value < 0n ? -value : value;
  const whole = (absolute / 100_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${value < 0n ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function WalletIcon({ type }: { type: "available" | "reserved" | "total" }) {
  if (type === "reserved") return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="7" y="14" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M11 14v-4a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="16" cy="20.5" r="1.5" fill="currentColor" /></svg>;
  if (type === "available") return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="5" y="9" width="22" height="17" rx="4" stroke="currentColor" strokeWidth="1.8" /><path d="M6 13h21M21 20h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 23V9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" stroke="currentColor" strokeWidth="1.8" /><path d="M11 19.5 15 15l3 2.5 4-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function BalanceDashboard({ balance, loading, error, username, onRefresh, onSignIn }: {
  balance: Balance | null;
  loading: boolean;
  error: string;
  username: string | null;
  onRefresh: () => void;
  onSignIn: () => void;
}) {
  const available = balance ? parseAmount(balance.available) : null;
  const reserved = balance ? parseAmount(balance.reserved) : null;
  const hasBalance = available !== null && reserved !== null;
  const total = hasBalance ? available + reserved : null;
  const reservedPercent = total && total > 0n && reserved !== null
    ? Math.min(100, Math.max(0, Number((reserved * 10_000n) / total) / 100))
    : 0;
  const availablePercent = hasBalance && total && total > 0n ? 100 - reservedPercent : 0;
  const display = (amount: bigint | null) => amount === null ? "—" : `$${formatAmount(amount)}`;

  return (
    <main className="wallet-page">
      <div className="wallet-page__inner">
        <div className="wallet-page__heading">
          <div>
            <span className="wallet-page__eyebrow"><span /> YOUR TRADING ACCOUNT</span>
            <h1>Balances<span>.</span></h1>
            <p>A clear view of the collateral you can use and the amount reserved for trading.</p>
          </div>
          <div className="wallet-page__actions">
            <span className={`wallet-page__session ${username ? "is-connected" : ""}`}><i />{username ? `${username}'s account` : "Account not connected"}</span>
            {username && <button type="button" className="wallet-page__refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh balances" title="Refresh balances"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.2-5.5M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
          </div>
        </div>

        <div className="wallet-overview">
          <section className="wallet-total" aria-label="Total collateral">
            <div className="wallet-total__light" aria-hidden="true" />
            <div className="wallet-total__rings" aria-hidden="true"><span /><span /><span /></div>
            <div className="wallet-total__content">
              <div className="wallet-total__label"><span className="wallet-icon wallet-icon--total"><WalletIcon type="total" /></span><span>TOTAL COLLATERAL</span></div>
              <strong>{loading && username ? "Loading…" : display(total)}</strong>
              <p>{username ? "Available and reserved collateral in your trading account." : "Sign in to sync your account balance with the engine."}</p>
              {username ? <span className="wallet-total__foot"><span className="status-dot is-online" /> Simulated trading balance</span> : <button type="button" className="wallet-total__connect" onClick={onSignIn}>Connect account <span aria-hidden="true">↗</span></button>}
            </div>
          </section>

          <section className="wallet-allocation" aria-label="Collateral allocation">
            <div className="wallet-allocation__top"><span>COLLATERAL ALLOCATION</span><span>{hasBalance ? "LIVE ACCOUNT VIEW" : "AWAITING ACCOUNT"}</span></div>
            <div className="wallet-allocation__body">
              <div className={`wallet-allocation__ring ${total && total > 0n ? "" : "is-empty"}`} style={{ "--reserved-percent": `${reservedPercent}%` } as CSSProperties}>
                <div><strong>{hasBalance ? `${availablePercent.toFixed(0)}%` : "—"}</strong><span>AVAILABLE</span></div>
              </div>
              <div className="wallet-allocation__legend">
                <div><span className="wallet-allocation__dot is-available" /><span>Available</span><strong>{display(available)}</strong></div>
                <div><span className="wallet-allocation__dot is-reserved" /><span>Reserved</span><strong>{display(reserved)}</strong></div>
              </div>
            </div>
          </section>
        </div>

        {username && error && <div className="wallet-alert" role="alert"><span>{error}</span><button type="button" onClick={onRefresh}>Try again</button></div>}

        <div className="wallet-metrics" aria-label="Collateral breakdown">
          <article className="wallet-metric">
            <div className="wallet-metric__top"><span className="wallet-icon wallet-icon--available"><WalletIcon type="available" /></span><span>01 / 02</span></div>
            <span className="wallet-metric__label">AVAILABLE COLLATERAL</span>
            <strong>{loading && username ? "Loading…" : display(available)}</strong>
            <p>Funds available for new orders and margin.</p>
            <div className="wallet-metric__line wallet-metric__line--available" />
          </article>
          <article className="wallet-metric">
            <div className="wallet-metric__top"><span className="wallet-icon wallet-icon--reserved"><WalletIcon type="reserved" /></span><span>02 / 02</span></div>
            <span className="wallet-metric__label">RESERVED COLLATERAL</span>
            <strong>{loading && username ? "Loading…" : display(reserved)}</strong>
            <p>Funds set aside for open orders and positions.</p>
            <div className="wallet-metric__line wallet-metric__line--reserved" />
          </article>
        </div>

        <section className="wallet-explainer" aria-label="Understanding your balance">
          <div><span className="wallet-explainer__eyebrow">A SIMPLE BREAKDOWN</span><h2>Where your collateral goes</h2><p>Placing an order moves required margin from available to reserved. As your orders and positions change, these balances change with them.</p></div>
          <div className="wallet-explainer__flow"><span>Available</span><i aria-hidden="true">→</i><span>Reserved for trading</span><i aria-hidden="true">→</i><span>Released or settled</span></div>
        </section>
      </div>
    </main>
  );
}
