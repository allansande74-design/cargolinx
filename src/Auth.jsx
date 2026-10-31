import React, { useState } from "react";
import { kvSet } from "./lib/db.js";

const TICK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

const ROLES = [
  ["owner", "Owner", "Full desk"],
  ["ops", "Operations", "Shipments & POD"],
  ["finance", "Finance", "Quotes & invoices"],
];

export default function Auth({ onEnter, onHome }) {
  const [role, setRole] = useState("owner");
  const [busy, setBusy] = useState(false);

  async function enterDemo() {
    setBusy(true);
    const label = ROLES.find(([k]) => k === role)?.[1] ?? "Owner";
    await kvSet("session", {
      id: "demo_" + role,
      name: "Demo operator",
      role,
      label,
      email: "demo@altovex.local",
      demo: true,
      since: new Date().toISOString(),
    });
    setBusy(false);
    onEnter();
  }

  return (
    <div className="site">
      <div className="auth">
        <aside className="auth-aside">
          <a className="logo" href="#/" onClick={(e) => { e.preventDefault(); onHome(); }}>
            <span className="mark">AX</span>
            <strong>Altovex <span>CargoLinx</span></strong>
          </a>
          <div>
            <h2>The freight desk that works where the signal does not.</h2>
            <p>Sign in to your workspace, or step straight into a local demo session with the full desk unlocked.</p>
            <ul className="auth-list">
              <li>{TICK}<span>Landed cost and quotes computed on this device</span></li>
              <li>{TICK}<span>Shipments, compliance and proof of delivery in one ledger</span></li>
              <li>{TICK}<span>Nothing leaves the device until you choose to sync</span></li>
            </ul>
          </div>
          <div style={{ fontSize: 12.5, color: "#8fa6c4" }}>Altovex Global Logistics · Nairobi, Kenya</div>
        </aside>

        <main className="auth-main">
          <div className="auth-card">
            <h1>Sign in</h1>
            <p className="sub">Accounts are not required for this build. Choose how you want to enter the desk.</p>

            <label htmlFor="email">Work email</label>
            <input className="input" id="email" type="email" placeholder="you@company.com" disabled />

            <label htmlFor="password">Password</label>
            <input className="input" id="password" type="password" placeholder="••••••••" disabled />

            <div className="auth-note">
              <span aria-hidden="true">ⓘ</span>
              <span>Credential sign-in is disabled in this demo build. No account exists to log in with, so you are not being asked for a password you would have to invent.</span>
            </div>

            <label>Enter as</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {ROLES.map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRole(k)}
                  aria-pressed={role === k}
                  className={"btn " + (role === k ? "btn-navy" : "btn-line")}
                  style={{ flex: 1, flexDirection: "column", gap: 3, padding: "11px 8px", fontSize: 13.5 }}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>

            <button className="btn btn-gold btn-lg" onClick={enterDemo} disabled={busy}>
              {busy ? "Opening the desk…" : "Continue without credentials"}
            </button>

            <div className="divider">or</div>
            <button className="btn btn-line" onClick={onHome}>Back to the site</button>

            <div className="auth-foot">
              Demo session · data stays in this browser · <a href="#/desk/new" onClick={(e) => { e.preventDefault(); enterDemo(); }}>skip straight in</a>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
