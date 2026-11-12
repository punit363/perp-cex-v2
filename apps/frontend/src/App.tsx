import { useEffect, useRef, useState, type FormEvent } from "react";
import { MarketDashboard, apiBase, wsUrl } from "./MarketDashboard";
import { BalanceDashboard } from "./BalanceDashboard";
import { MarketTradePage } from "./MarketTradePage";
import { LandingPage } from "./LandingPage";
import { AccessPage, type AccessMode } from "./AccessPage";
import { AppNav } from "./AppNav";
import "./styles.css";

type AuthMode = AccessMode;
type Section = "home" | "access" | "markets" | "balances" | "trade";
type Session = { username: string; token: string };
type Balance = { available: string; reserved: string };
const SESSION_KEY = "apex.exchange.session";

function readSession(): Session | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const session: unknown = JSON.parse(value);
    if (typeof session === "object" && session !== null &&
      "username" in session && typeof session.username === "string" && session.username &&
      "token" in session && typeof session.token === "string" && session.token) {
      return { username: session.username, token: session.token };
    }
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return null;
}

function storeSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Continue with the in-memory session if storage is unavailable.
  }
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
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

const API_BASE = apiBase;

async function request(path: string, options: RequestInit): Promise<ApiEnvelope> {
  const response = await fetch(API_BASE + path, options);
  const payload = (await response.json().catch(() => null)) as ApiEnvelope | null;
  if (!response.ok || payload?.status === "FAILURE") {
    throw new ApiError(payload?.message || "Request failed (" + response.status + ")", response.status);
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
  const [session, setSession] = useState<Session | null>(readSession);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [accountEventRevision, setAccountEventRevision] = useState(0);
  const [marketLabel, setMarketLabel] = useState<string | null>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const activeToken = useRef<string | null>(session?.token ?? null);
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
    setMarketLabel(null);
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
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        activeToken.current = null;
        storeSession(null);
        setSession(null);
        setBalance(null);
        setBalanceLoading(false);
        setMessage("Your session expired. Sign in again.");
        return;
      }
      setBalance(null);
      setBalanceError(cause instanceof Error ? cause.message : "Could not load balance.");
    } finally {
      if (activeToken.current === token) setBalanceLoading(false);
    }
  }

  useEffect(() => {
    if (session) void loadBalance(session.token);
  }, [session?.token]);

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
      const nextSession = { username: username.trim(), token };
      storeSession(nextSession);
      setSession(nextSession);
      setBalance(null);
      setPassword("");
      if (returnToMarket.current) navigateToMarket(returnToMarket.current);
      else navigate("markets");
      returnToMarket.current = null;
      setMessage("");
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
    storeSession(null);
    setSession(null);
    setBalance(null);
    setBalanceLoading(false);
    setBalanceError("");
    setMessage("You have signed out.");
  }

  return (
    <div className="site-shell">
      {section !== "home" && <AppNav page={section} accessMode={mode} marketLabel={marketLabel} signedIn={Boolean(session)} onHome={() => navigate("home")} onMarkets={() => navigate("markets")} onWallet={showBalances} onSignIn={showSignIn} />}

      {section === "markets" ? <MarketDashboard onSelectMarket={navigateToMarket} /> : section === "trade" ? <MarketTradePage marketId={marketId} token={session?.token ?? null} balance={balance} accountEventRevision={accountEventRevision} onSignIn={showSignIn} onMarkets={() => navigate("markets")} onMarketLabelChange={setMarketLabel} onBalanceRefresh={() => { if (session) void loadBalance(session.token); }} /> : section === "balances" ? <BalanceDashboard key={session?.token ?? "guest"} balance={balance} loading={balanceLoading} error={balanceError} username={session?.username ?? null} token={session?.token ?? null} onRefresh={() => session ? loadBalance(session.token) : Promise.resolve()} onSignIn={showSignIn} onSignOut={signOut} /> : section === "access" ? <AccessPage mode={mode} username={username} password={password} showPassword={showPassword} busy={busy} message={message} error={error} sessionUsername={session?.username ?? null} usernameInput={usernameInput} onBalances={showBalances} onModeChange={(nextMode) => { setMode(nextMode); setError(""); setMessage(""); }} onUsernameChange={setUsername} onPasswordChange={setPassword} onTogglePassword={() => setShowPassword((current) => !current)} onSubmit={submitAuth} /> : <LandingPage signedIn={Boolean(session)} username={session?.username ?? null} onMarkets={() => navigate("markets")} onMarket={navigateToMarket} onSignIn={showSignIn} onSignUp={showSignUp} onBalances={showBalances} />}
    </div>
  );
}

export default App;
