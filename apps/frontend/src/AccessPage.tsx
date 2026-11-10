import { useLayoutEffect, type FormEvent, type RefObject } from "react";
import gsap from "gsap";

export type AccessMode = "signin" | "register";

type AccessPageProps = {
  mode: AccessMode;
  username: string;
  password: string;
  showPassword: boolean;
  busy: boolean;
  message: string;
  error: string;
  sessionUsername: string | null;
  usernameInput: RefObject<HTMLInputElement | null>;
  onHome: () => void;
  onMarkets: () => void;
  onBalances: () => void;
  onModeChange: (mode: AccessMode) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function ApexMark() {
  return <span className="access-page__mark" aria-hidden="true">∧</span>;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />{!visible && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>;
}

export function AccessPage(props: AccessPageProps) {
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(".access-page__brand, .access-page__intro, .access-page__panel", { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.46, stagger: 0.08, ease: "power3.out", clearProps: "all" });
      gsap.fromTo(".access-page__signal i", { scaleY: 0.25, transformOrigin: "bottom" }, { scaleY: 1, duration: 0.55, stagger: 0.05, ease: "power2.out", delay: 0.2 });
    });
    return () => context.revert();
  }, []);

  const signedIn = Boolean(props.sessionUsername);
  return <main className="access-page">
    <div className="access-page__field" aria-hidden="true"><i /><i /><i /></div>
    <header className="access-page__header">
      <button type="button" className="access-page__brand" onClick={props.onHome}><ApexMark /> <span>APEX <small>EXCHANGE</small></span></button>
      <button type="button" className="access-page__markets" onClick={props.onMarkets}>View markets <span aria-hidden="true">↗</span></button>
    </header>
    <section className="access-page__content" aria-labelledby="access-page-title">
      <div className="access-page__intro">
        <span className="access-page__eyebrow">ACCOUNT / ACCESS</span>
        <h1 id="access-page-title">Your desk<br />starts here.</h1>
        <p>Connect to a simulated account to follow balances, orders, and positions from the same trading workspace.</p>
        <div className="access-page__signal" aria-hidden="true"><span>DESK STATUS</span><b>READY</b><div>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ height: `${26 + ((index * 17) % 68)}%` }} />)}</div></div>
      </div>
      <div className="access-page__panel">
        {signedIn ? <div className="access-page__connected"><span className="access-page__eyebrow">ACCOUNT CONNECTED</span><div className="access-page__connected-mark"><ApexMark /></div><h2>Welcome, {props.sessionUsername}</h2><p>Your trading account is available in this session.</p>{props.message && <p className="form-message form-message--success" role="status">{props.message}</p>}<button type="button" className="access-page__submit" onClick={props.onBalances}>View balances <span aria-hidden="true">↗</span></button></div> : <><span className="access-page__eyebrow">TRADING ACCOUNT</span><h2>{props.mode === "signin" ? "Sign in to continue." : "Create your account."}</h2><p className="access-page__panel-copy">{props.mode === "signin" ? "Use your credentials to access the trading workspace." : "Set up credentials for the simulated exchange."}</p><div className="access-page__tabs" role="group" aria-label="Account action"><button type="button" aria-pressed={props.mode === "signin"} className={props.mode === "signin" ? "is-active" : ""} onClick={() => props.onModeChange("signin")}>Sign in</button><button type="button" aria-pressed={props.mode === "register"} className={props.mode === "register" ? "is-active" : ""} onClick={() => props.onModeChange("register")}>Create account</button></div><form className="access-page__form" onSubmit={props.onSubmit}><label htmlFor="access-username">EMAIL OR USER ID</label><input ref={props.usernameInput} id="access-username" name="username" type="text" autoComplete="username" placeholder="Enter your username" value={props.username} onChange={(event) => props.onUsernameChange(event.target.value)} required /><label htmlFor="access-password">PASSWORD</label><div className="access-page__password"><input id="access-password" name="password" type={props.showPassword ? "text" : "password"} autoComplete={props.mode === "signin" ? "current-password" : "new-password"} placeholder={props.mode === "signin" ? "Enter your password" : "Create a password"} value={props.password} onChange={(event) => props.onPasswordChange(event.target.value)} required /><button type="button" aria-label={props.showPassword ? "Hide password" : "Show password"} aria-pressed={props.showPassword} onClick={props.onTogglePassword}><EyeIcon visible={props.showPassword} /></button></div>{props.error && <p className="form-message form-message--error" role="alert">{props.error}</p>}{props.message && <p className="form-message form-message--success" role="status">{props.message}</p>}<button className="access-page__submit" type="submit" disabled={props.busy}>{props.busy ? "Connecting…" : props.mode === "signin" ? "Connect account" : "Create account"}<span aria-hidden="true">↗</span></button></form><p className="access-page__note">Simulated trading environment</p></>}</div>
    </section>
  </main>;
}
