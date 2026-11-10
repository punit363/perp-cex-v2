import { useEffect, useRef, useState, type FormEvent } from "react";
import { MarketDashboard, wsUrl } from "./MarketDashboard";
import { BalanceDashboard } from "./BalanceDashboard";
import { MarketTradePage } from "./MarketTradePage";
import { LandingPage } from "./LandingPage";
import { AccessPage, type AccessMode } from "./AccessPage";
import "./styles.css";

type AuthMode = AccessMode;
type Section = "home" | "access" | "markets" | "balances" | "trade";
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

function sectionFromPath(pathname: string): Section {
  const path = pathname.replace(/\/$/, "");
  if (path === "/markets") return "markets";
  if (path === "/access") return "access";
  if (path === "/balances") return "balances";
  if (path.startsWith("/market/") && path.length > 8) return "trade";
  return "home";
}

function marketIdFromPath(pathname: string) {
  try { return decodeURIComponent(pathname.slice(8)); }
  catch { return ""; }
}

const API_BASE =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
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

async function request(path: string, options: RequestInit): Promise<ApiEnvelope> {
  const response = await fetch(API_BASE + path, options);
  const payload = (await response.json().catch(() => null)) as ApiEnvelope | null;
  if (!response.ok || payload?.status === "FAILURE") {
    throw new Error(payload?.message || "Request failed (" + response.status + ")");
  }
  return payload ?? {};
}

export function App() {
  const [section, setSection] = useState<Section>(() => sectionFromPath(location.pathname));
  const [marketId, setMarketId] = useState(() => marketIdFromPath(location.pathname));
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
  const [accountEventRevision, setAccountEventRevision] = useState(0);
  const usernameInput = useRef<HTMLInputElement>(null);
  const activeToken = useRef<string | null>(null);
  const returnToMarket = useRef<string | null>(null);

  useEffect(() => {
    const syncPath = () => {
      setSection(sectionFromPath(location.pathname));
      if (location.pathname.startsWith("/market/")) setMarketId(marketIdFromPath(location.pathname));
    };
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  function navigate(next: Section) {
    if (next === "trade") return;
    const path = next === "home" ? "/" : `/${next}`;
    if (location.pathname !== path) window.history.pushState({}, "", path);
    setSection(next);
  }

  function navigateToMarket(id: string) {
    const path = `/market/${encodeURIComponent(id)}`;
    if (location.pathname !== path) window.history.pushState({}, "", path);
    setMarketId(id);
    setSection("trade");
  }

  async function loadBalance(token: string) {
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const result = await request("/user/balance", { method: "GET", headers: { token } });
      if (activeToken.current !== token) return;
      const engineResult = result.data?.engine_response;
      if (!engineResult?.status || !engineResult.data) {
        throw new Error(engineResult?.message || "Balance is not available yet.");
      }
      setBalance(engineResult.data);
    } catch (cause) {
      if (activeToken.current !== token) return;
      setBalance(null);
      setBalanceError(cause instanceof Error ? cause.message : "Could not load balance.");
    } finally {
      if (activeToken.current === token) setBalanceLoading(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => socket?.send(JSON.stringify({ action: "AUTHENTICATE", token: session.token }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.action === "AUTHENTICATED") {
            socket?.send(JSON.stringify({ action: "SUBSCRIBE", type: "ACCOUNT" }));
          } else if (message.event_type === "ACCOUNT") {
            setAccountEventRevision((value) => value + 1);
            void loadBalance(session.token);
          }
        } catch { /* Ignore socket greetings and malformed messages. */ }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3500);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [session]);

  function showBalances() {
    navigate("balances");
    if (session) void loadBalance(session.token);
  }

  function showDeposit() {
    showBalances();
    requestAnimationFrame(() => document.getElementById("wallet-add-amount")?.focus());
  }

  function showSignIn() {
    returnToMarket.current = section === "trade" ? marketId : null;
    navigate("access");
    setMode("signin");
    requestAnimationFrame(() => {
      usernameInput.current?.focus({ preventScroll: true });
    });
  }

  function showSignUp() {
    navigate("access");
    setMode("register");
    setError("");
    setMessage("");
    requestAnimationFrame(() => {
      usernameInput.current?.focus({ preventScroll: true });
    });
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
      activeToken.current = token;
      setSession({ username: username.trim(), token });
      setBalance(null);
      setPassword("");
      if (returnToMarket.current) navigateToMarket(returnToMarket.current);
      else navigate("markets");
      returnToMarket.current = null;
      setMessage("");
      void loadBalance(token);
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
    activeToken.current = null;
    setSession(null);
    setBalance(null);
    setBalanceLoading(false);
    setBalanceError("");
    setMessage("You have signed out.");
  }

  return (
    <div className="site-shell">
      {section === "balances" && <header className="topbar">
        <div className="topbar__left">
          <button className="brand brand--header" type="button" onClick={() => navigate("home")} aria-label="Apex Exchange home">
            <BrandMark compact /><span>APEX <span className="brand__muted">EXCHANGE</span></span>
          </button>
          <nav className="nav" aria-label="Main navigation">
            <button type="button" className="nav__item" onClick={() => navigate("markets")}>Markets</button>
            <button type="button" className={"nav__item" + (section === "balances" ? " is-active" : "")} onClick={showBalances}>Balances</button>
          </nav>
        </div>
        <div className="topbar__right">
          {session && <div className="topbar__wallet-actions"><button type="button" onClick={showDeposit}>Deposit</button><button type="button" disabled title="Withdrawals are not available yet">Withdraw</button></div>}
          <span className="environment-badge"><span className="environment-badge__dot" /> Simulated trading</span>
          <span className="topbar__divider" />
          {session
            ? <><div className="topbar__identity"><strong>{session.username}</strong><span>Trading account</span></div><button type="button" className="topbar__action topbar__action--outline" onClick={signOut}>Logout</button></>
            : <button type="button" className="topbar__action" onClick={showSignIn}>Sign In</button>}
        </div>
      </header>}

      {section === "markets" ? <MarketDashboard balance={balance} balanceLoading={balanceLoading} signedIn={Boolean(session)} onBalances={showBalances} onSignIn={showSignIn} onSelectMarket={navigateToMarket} onHome={() => navigate("home")} /> : section === "trade" ? <MarketTradePage marketId={marketId} token={session?.token ?? null} balance={balance} accountEventRevision={accountEventRevision} onSignIn={showSignIn} onMarkets={() => navigate("markets")} onBalances={showBalances} onHome={() => navigate("home")} onBalanceRefresh={() => { if (session) void loadBalance(session.token); }} /> : section === "balances" ? <BalanceDashboard key={session?.token ?? "guest"} balance={balance} loading={balanceLoading} error={balanceError} username={session?.username ?? null} token={session?.token ?? null} onRefresh={() => session ? loadBalance(session.token) : Promise.resolve()} onSignIn={showSignIn} /> : section === "access" ? <AccessPage mode={mode} username={username} password={password} showPassword={showPassword} busy={busy} message={message} error={error} sessionUsername={session?.username ?? null} usernameInput={usernameInput} onHome={() => navigate("home")} onMarkets={() => navigate("markets")} onBalances={showBalances} onModeChange={(nextMode) => { setMode(nextMode); setError(""); setMessage(""); }} onUsernameChange={setUsername} onPasswordChange={setPassword} onTogglePassword={() => setShowPassword((current) => !current)} onSubmit={submitAuth} /> : <LandingPage signedIn={Boolean(session)} username={session?.username ?? null} onMarkets={() => navigate("markets")} onMarket={navigateToMarket} onSignIn={showSignIn} onSignUp={showSignUp} onBalances={showBalances} />}
    </div>
  );
}

export default App;
