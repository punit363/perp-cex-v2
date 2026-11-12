import { useState, type FormEvent } from "react";
import { apiBase } from "./MarketDashboard";

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

export function BalanceDashboard({ balance, loading, error, username, token, onRefresh, onSignIn, onSignOut }: {
  balance: Balance | null;
  loading: boolean;
  error: string;
  username: string | null;
  token: string | null;
  onRefresh: () => Promise<void>;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  const available = balance ? parseAmount(balance.available) : null;
  const reserved = balance ? parseAmount(balance.reserved) : null;
  const hasBalance = available !== null && reserved !== null;
  const total = hasBalance ? available + reserved : null;
  const reservedPercent = total && total > 0n && reserved !== null
    ? Math.min(100, Math.max(0, Number((reserved * 10_000n) / total) / 100))
    : 0;
  const availablePercent = hasBalance && total && total > 0n ? 100 - reservedPercent : 0;
  const display = (amount: bigint | null) => amount === null ? "–" : `$${formatAmount(amount)}`;

  async function addBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return onSignIn();

    const value = amount.trim();
    const parsed = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value) ? parseAmount(value) : null;
    if (parsed === null || parsed <= 0n) {
      setAddError("Enter a positive amount with up to 8 decimal places.");
      setAddSuccess("");
      return;
    }

    setAdding(true);
    setAddError("");
    setAddSuccess("");
    try {
      const response = await fetch(`${apiBase}/user/onramp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ amount: value }),
      });
      const payload = await response.json().catch(() => null) as {
        status?: string;
        message?: string;
        data?: { engine_response?: { status?: number; message?: string } };
      } | null;
      if (!response.ok || payload?.status === "FAILURE" || payload?.data?.engine_response?.status !== 1) {
        throw new Error(payload?.data?.engine_response?.message || payload?.message || `Request failed (${response.status})`);
      }

      setAmount("");
      await onRefresh();
      setAddSuccess(`Added $${formatAmount(parsed)} to your simulated balance.`);
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : "Could not add balance. Try again.");
    } finally {
      setAdding(false);
    }
  }

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
            {username && <button type="button" className="wallet-page__refresh" onClick={() => void onRefresh()} disabled={loading} aria-label="Refresh balances" title="Refresh balances"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.2-5.5M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
            {username && <button type="button" className="wallet-page__signout" onClick={onSignOut}>Sign out</button>}
          </div>
        </div>

        <div className="wallet-overview">
          <section className="wallet-total" aria-label="Total collateral">
            <div className="wallet-total__light" aria-hidden="true" />
            <div className="wallet-total__rings" aria-hidden="true"><span /><span /><span /></div>
            <div className="wallet-total__content">
              <div className="wallet-total__label"><span className="wallet-icon wallet-icon--total"><WalletIcon type="total" /></span><span>Total collateral</span></div>
              <strong>{loading && username ? "Loading…" : display(total)}</strong>
              <p>{username ? "Available and reserved collateral in your trading account." : "Sign in to sync your account balance with the engine."}</p>
              {username ? <span className="wallet-total__foot"><span className="status-dot is-online" /> Simulated trading balance</span> : <button type="button" className="wallet-total__connect" onClick={onSignIn}>Connect account <span aria-hidden="true">↗</span></button>}
            </div>
          </section>

          <section className="wallet-allocation" aria-label="Collateral allocation">
            <div className="wallet-allocation__top"><span>Collateral allocation</span><span>{hasBalance ? "Live account view" : "Awaiting account"}</span></div>
            <div className="wallet-allocation__body">
            <div className={`wallet-allocation__ring ${total && total > 0n ? "" : "is-empty"}`}>
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="#303937" strokeWidth="7" />
                  {total && total > 0n && <circle cx="50" cy="50" r="44" fill="none" stroke="#59c989" strokeWidth="7" pathLength="100" strokeDasharray={`${availablePercent} ${100 - availablePercent}`} transform="rotate(-90 50 50)" />}
                </svg>
                <div><strong>{hasBalance ? `${availablePercent.toFixed(0)}%` : "–"}</strong><span>Available</span></div>
              </div>
              <div className="wallet-allocation__legend">
                <div><span className="wallet-allocation__dot is-available" /><span>Available</span><strong>{display(available)}</strong></div>
                <div><span className="wallet-allocation__dot is-reserved" /><span>Reserved</span><strong>{display(reserved)}</strong></div>
              </div>
            </div>
          </section>
        </div>

        <section className="wallet-add" aria-labelledby="wallet-add-title">
          <div className="wallet-add__copy">
            <span className="wallet-explainer__eyebrow">Fund your account</span>
            <h2 id="wallet-add-title">Add simulated balance</h2>
            <p>Credit collateral for testing orders and positions. No real funds move.</p>
          </div>
          {token ? <form className="wallet-add__form" onSubmit={addBalance} noValidate>
            <label htmlFor="wallet-add-amount">Amount</label>
            <div className="wallet-add__controls">
              <div className="wallet-add__input"><span aria-hidden="true">$</span><input id="wallet-add-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setAddError(""); setAddSuccess(""); }} disabled={adding} aria-describedby="wallet-add-hint" /></div>
              <button type="submit" disabled={adding}>{adding ? "Adding…" : "Add balance"}</button>
            </div>
            <span id="wallet-add-hint" className="wallet-add__hint">Positive amount · up to 8 decimal places</span>
            {addError && <p className="wallet-add__error" role="alert">{addError}</p>}
            {addSuccess && <p className="wallet-add__success" role="status">{addSuccess}</p>}
          </form> : <button type="button" className="wallet-add__signin" onClick={onSignIn}>Sign in to add balance <span aria-hidden="true">↗</span></button>}
        </section>

        {username && error && <div className="wallet-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void onRefresh()}>Try again</button></div>}

        <div className="wallet-metrics" aria-label="Collateral breakdown">
          <article className="wallet-metric">
            <div className="wallet-metric__top"><span className="wallet-icon wallet-icon--available"><WalletIcon type="available" /></span><span>01 / 02</span></div>
            <span className="wallet-metric__label">Available collateral</span>
            <strong>{loading && username ? "Loading…" : display(available)}</strong>
            <p>Funds available for new orders and margin.</p>
            <div className="wallet-metric__line wallet-metric__line--available" />
          </article>
          <article className="wallet-metric">
            <div className="wallet-metric__top"><span className="wallet-icon wallet-icon--reserved"><WalletIcon type="reserved" /></span><span>02 / 02</span></div>
            <span className="wallet-metric__label">Reserved collateral</span>
            <strong>{loading && username ? "Loading…" : display(reserved)}</strong>
            <p>Funds set aside for open orders and positions.</p>
            <div className="wallet-metric__line wallet-metric__line--reserved" />
          </article>
        </div>

        <section className="wallet-explainer" aria-label="Understanding your balance">
          <div><span className="wallet-explainer__eyebrow">A simple breakdown</span><h2>Where your collateral goes</h2><p>Placing an order moves required margin from available to reserved. As your orders and positions change, these balances change with them.</p></div>
          <div className="wallet-explainer__flow"><span>Available</span><i aria-hidden="true">→</i><span>Reserved for trading</span><i aria-hidden="true">→</i><span>Released or settled</span></div>
        </section>
      </div>
    </main>
  );
}
