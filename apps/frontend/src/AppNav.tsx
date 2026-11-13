import { useEffect, useState } from "react";
import { wsUrl } from "./MarketDashboard";

type Page = "access" | "markets" | "balances" | "trade";

export function AppNav({ page, accessMode, marketLabel, signedIn, onHome, onMarkets, onWallet, onSignIn }: {
  page: Page;
  accessMode: "signin" | "register";
  marketLabel: string | null;
  signedIn: boolean;
  onHome: () => void;
  onMarkets: () => void;
  onWallet: () => void;
  onSignIn: () => void;
}) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      if (closed) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  const current = page === "access" ? accessMode === "signin" ? "Sign in" : "Create account"
    : page === "balances" ? "Balances"
      : page === "trade" ? marketLabel ?? "Trade"
        : "Markets";

  return <header className="app-nav">
    <div className="app-nav__left">
      <button type="button" className="app-nav__brand" onClick={onHome} aria-label="Apex Exchange overview">
        <strong>PEX</strong><span>EXCHANGE</span>
      </button>
      <span className="app-nav__divider" aria-hidden="true" />
      <nav className="app-nav__breadcrumbs" aria-label="Breadcrumb">
        <button type="button" onClick={onHome}><span aria-hidden="true">⌂</span> Overview</button>
        <span className="app-nav__slash" aria-hidden="true">/</span>
        {page === "trade" && <><button type="button" onClick={onMarkets}>Markets</button><span className="app-nav__slash" aria-hidden="true">/</span></>}
        <span className="app-nav__current" aria-current="page">{current}</span>
      </nav>
    </div>
    <div className="app-nav__right">
      <span className={`app-nav__status ${connected ? "is-live" : ""}`} title={connected ? "Market WebSocket connected" : "Market WebSocket disconnected"} role="status"><i />{connected ? "Live" : "Offline"}</span>
      <button type="button" className="app-nav__wallet" onClick={signedIn ? onWallet : onSignIn}>{signedIn ? "Your wallet" : "Sign in"}<span aria-hidden="true">↗</span></button>
    </div>
  </header>;
}
