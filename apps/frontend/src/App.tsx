import { useRef, useState, type FormEvent } from "react";
import "./index.css";

type AuthMode = "signin" | "register";
type Section = "markets" | "balances";
type Session = { username: string; token: string };
type Balance = { available: string; reserved: string };
type ApiEnvelope = {
  status?: string;
  message?: string;
  data?: {
    token?: string;
    engine_response?: { status?: number; message?: string; data?: Balance };
  };
};

const API_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:8000/api/v1"
    : "/api/v1";

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand-mark brand-mark--compact" : "brand-mark"} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="m6 23 7-7 5 4 8-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 11h7v7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />
      {!visible && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

async function request(path: string, options: RequestInit): Promise<ApiEnvelope> {
  const response = await fetch(API_BASE + path, options);
  const payload = (await response.json().catch(() => null)) as ApiEnvelope | null;
  if (!response.ok || payload?.status === "FAILURE") {
    throw new Error(payload?.message || "Request failed (" + response.status + ")");
  }
  return payload ?? {};
}

function formatBalance(value: string) {
  const [whole, fraction] = value.split(".");
  if (whole === undefined) return value;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : grouped + "." + fraction;
}

export function App() {
  const [section, setSection] = useState<Section>("markets");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const usernameInput = useRef<HTMLInputElement>(null);

  async function loadBalance(token: string) {
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const result = await request("/user/balance", { method: "GET", headers: { token } });
      const engineResult = result.data?.engine_response;
      if (!engineResult?.status || !engineResult.data) {
        throw new Error(engineResult?.message || "Balance is not available yet.");
      }
      setBalance(engineResult.data);
    } catch (cause) {
      setBalance(null);
      setBalanceError(cause instanceof Error ? cause.message : "Could not load balance.");
    } finally {
      setBalanceLoading(false);
    }
  }

  function showBalances() {
    if (!session) {
      setMode("signin");
      setMessage("Sign in to view your balances.");
      usernameInput.current?.focus();
      return;
    }
    setSection("balances");
    void loadBalance(session.token);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const options: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      };
      if (mode === "register") await request("/auth/signup", options);
      const result = await request("/auth/signin", options);
      const token = result.data?.token;
      if (!token) throw new Error("Sign in succeeded, but no session token was returned.");
      setSession({ username: username.trim(), token });
      setPassword("");
      setMessage(mode === "register" ? "Account created. You are signed in." : "Signed in successfully.");
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Cannot reach the backend. Start it on port 8000 and try again."
          : cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setSession(null);
    setSection("markets");
    setBalance(null);
    setBalanceError("");
    setMessage("You have signed out.");
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="topbar__left">
          <button className="brand brand--header" type="button" onClick={() => setSection("markets")} aria-label="Apex Exchange home">
            <BrandMark compact /><span>APEX <span className="brand__muted">EXCHANGE</span></span>
          </button>
          <nav className="nav" aria-label="Main navigation">
            <button type="button" className={"nav__item" + (section === "markets" ? " is-active" : "")} onClick={() => setSection("markets")}>Markets</button>
            <button type="button" className={"nav__item" + (section === "balances" ? " is-active" : "")} onClick={showBalances}>Balances</button>
          </nav>
        </div>
        <div className="topbar__right">
          <span className="environment-badge"><span className="environment-badge__dot" /> Simulated trading</span>
          <span className="topbar__divider" />
          {session
            ? <button type="button" className="topbar__action topbar__action--outline" onClick={signOut}>Sign Out</button>
            : <button type="button" className="topbar__action" onClick={() => usernameInput.current?.focus()}>Sign In</button>}
        </div>
      </header>

      <main className="landing">
        <section className="hero-panel" aria-labelledby="hero-heading">
          <div className="hero-panel__glow" aria-hidden="true" />
          <div className="hero-panel__inner">
            <div className="hero-brand"><BrandMark /><span>APEX <span className="brand__muted">EXCHANGE</span></span></div>
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow__line" /> THE PERPETUAL TRADING DESK</div>
              <h1 id="hero-heading">
                {section === "balances" ? <>Your account.<br /><em>Your view.</em></> : <>Trade perpetuals<br />with <em>clarity.</em></>}
              </h1>
              <p>{section === "balances"
                ? "Keep your available and reserved collateral in one place. Your balances update as the engine processes your trades."
                : "A focused home for order placement, live market depth, and position tracking. Start with simulated collateral and explore the exchange as it takes shape."}</p>
              <div className="feature-grid" aria-label="Exchange features">
                <div className="feature-card">
                  <span className="feature-card__label">MATCHING MODEL</span>
                  <strong>Price-time priority</strong>
                  <span className="feature-card__sub">Limit order book</span>
                </div>
                <div className="feature-card">
                  <span className="feature-card__label">TRADING MODE</span>
                  <strong className="feature-card__accent">Simulated collateral</strong>
                  <span className="feature-card__sub">Development environment</span>
                </div>
              </div>
            </div>
            <div className="hero-footer"><span className="hero-footer__dot" /> Built for the next trade <span className="hero-footer__dash">—</span> APEX Exchange</div>
          </div>
        </section>

        <section className="access-panel" aria-label="Account access">
          <div className="access-panel__halo" aria-hidden="true" />
          <div className="account-card" id="account">
            {session ? (
              <>
                <div className="account-card__eyebrow">ACCOUNT CONNECTED</div>
                <div className="account-card__icon"><BrandMark compact /></div>
                <h2>Welcome, {session.username}</h2>
                <p className="account-card__intro">Your trading account is ready in this session.</p>
                {message && <p className="form-message form-message--success" role="status">{message}</p>}
                {section === "balances" ? (
                  <div className="balance-view">
                    <div className="balance-view__heading"><span>Collateral balance</span><button type="button" onClick={() => void loadBalance(session.token)} disabled={balanceLoading}>Refresh</button></div>
                    {balanceLoading ? <p className="balance-view__empty" role="status">Loading balance…</p> : balance ? (
                      <div className="balance-view__rows">
                        <div><span>Available</span><strong>{formatBalance(balance.available)}</strong></div>
                        <div><span>Reserved</span><strong>{formatBalance(balance.reserved)}</strong></div>
                      </div>
                    ) : <p className="balance-view__empty" role="status">{balanceError || "No balance available yet."}</p>}
                  </div>
                ) : <button type="button" className="primary-button" onClick={showBalances}>View Balances <span aria-hidden="true">↗</span></button>}
                <p className="account-card__footnote">Simulated trading environment</p>
              </>
            ) : (
              <>
                <div className="account-card__eyebrow">YOUR TRADING WORKSPACE</div>
                <h2>{mode === "signin" ? "Welcome back" : "Create an account"}</h2>
                <p className="account-card__intro">{mode === "signin" ? "Sign in to access your trading account." : "Get started with simulated perpetual trading."}</p>
                <div className="auth-tabs" role="group" aria-label="Account action">
                  <button type="button" aria-pressed={mode === "signin"} className={mode === "signin" ? "is-active" : ""} onClick={() => { setMode("signin"); setError(""); setMessage(""); }}>Sign In</button>
                  <button type="button" aria-pressed={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Register</button>
                </div>
                <form className="auth-form" onSubmit={submitAuth}>
                  <label htmlFor="username">USERNAME</label>
                  <input ref={usernameInput} id="username" name="username" type="text" autoComplete="username" placeholder="Enter your username" value={username} onChange={(event) => setUsername(event.target.value)} required />
                  <label htmlFor="password">PASSWORD</label>
                  <div className="password-field">
                    <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder={mode === "signin" ? "Enter your password" : "Create a password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
                    <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}><EyeIcon visible={showPassword} /></button>
                  </div>
                  {error && <p className="form-message form-message--error" role="alert">{error}</p>}
                  {message && <p className="form-message form-message--success" role="status">{message}</p>}
                  <button className="primary-button" type="submit" disabled={busy}>{busy ? "Connecting…" : mode === "signin" ? "Connect Account" : "Create Account"}<span aria-hidden="true">↗</span></button>
                </form>
                <p className="account-card__footnote">Simulated trading environment</p>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
