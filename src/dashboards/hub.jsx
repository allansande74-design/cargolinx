import React, { Suspense, lazy, useEffect, useState } from "react";
import { DASHBOARD_SPECS, canOpen } from "../lib/dashboards.mjs";
import { ensureDemoBook } from "../lib/demo-book.mjs";
import { useDashBook, C, Tag } from "./_data.jsx";

const SCREENS = {
  overview: lazy(() => import("./overview.jsx")),
  admin: lazy(() => import("./admin.jsx")),
  operations: lazy(() => import("./operations.jsx")),
  user: lazy(() => import("./user.jsx")),
  buyer: lazy(() => import("./buyer.jsx")),
  seller: lazy(() => import("./seller.jsx")),
  driver: lazy(() => import("./driver.jsx")),
  transporter: lazy(() => import("./transporter.jsx")),
  "clearing-agent": lazy(() => import("./clearing-agent.jsx")),
  insurer: lazy(() => import("./insurer.jsx")),
  "finance-partner": lazy(() => import("./finance-partner.jsx")),
  "trade-finance-escrow": lazy(() => import("./trade-finance-escrow.jsx")),
  sourcing: lazy(() => import("./sourcing.jsx")),
  procurement: lazy(() => import("./procurement.jsx")),
  crm: lazy(() => import("./crm.jsx")),
  "sales-marketing": lazy(() => import("./sales-marketing.jsx")),
  hr: lazy(() => import("./hr.jsx")),
  match: lazy(() => import("./match.jsx")),
};

const hashKey = () => {
  const m = /^#\/hub\/([a-z-]+)/.exec(window.location.hash || "");
  return m ? m[1] : null;
};

export default function DashboardHub({ user }) {
  const { data, reload } = useDashBook();
  const [key, setKey] = useState(hashKey);

  useEffect(() => {
    const onHash = () => setKey(hashKey());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    ensureDemoBook()
      .then((res) => { if (res.seeded) reload(); })
      .catch((err) => console.warn("demo book not seeded:", err && err.message ? err.message : err));
  }, [reload]);

  const open = (k) => {
    window.location.hash = `#/hub/${k}`;
    setKey(k);
  };
  const close = () => {
    window.location.hash = "#/hub";
    setKey(null);
  };

  if (key) {
    const gate = canOpen(user ?? data?.user ?? null, key);
    const Screen = SCREENS[key];
    if (!Screen) {
      return (
        <Frame onClose={close} title="Dashboard not built" sub={`No screen is registered for "${key}".`}>
          <p style={{ fontSize: 13.5, color: C.soft }}>The register lists {DASHBOARD_SPECS.length} dashboards; this key is not one of them.</p>
        </Frame>
      );
    }
    if (!gate.allowed) {
      return (
        <Frame onClose={close} title="Not your desk" sub={gate.reason}>
          <p style={{ fontSize: 13.5, color: C.soft }}>Ask a platform administrator to change the role on your account if this is your work.</p>
        </Frame>
      );
    }
    return (
      <Suspense fallback={<Frame onClose={close} title="Opening" sub="Loading the screen for this role."><p style={{ fontSize: 13.5, color: C.soft }}>Loading…</p></Frame>}>
        <Screen data={data} reload={reload} />
      </Suspense>
    );
  }

  const who = data?.user ? `${data.user.name ?? data.user.email} · ${data.user.role}` : "Demonstration session — every desk is open";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "16px", borderBottom: `3px solid ${C.gold}` }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ fontSize: 10.5, letterSpacing: 2, color: C.gold, fontWeight: 700 }}>CARGOLINX · STAKEHOLDER DASHBOARDS</div>
          <h1 style={{ margin: "4px 0 2px", fontSize: 21 }}>Choose the desk you work at</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: "#c9d6e5" }}>{who}</p>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
          {DASHBOARD_SPECS.map((spec) => {
            const gate = canOpen(user ?? data?.user ?? null, spec.key);
            return (
              <button
                key={spec.key}
                onClick={() => (gate.allowed ? open(spec.key) : null)}
                title={gate.allowed ? spec.sub : gate.reason}
                style={{
                  textAlign: "left",
                  font: "inherit",
                  background: "#fff",
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  padding: "13px 14px",
                  cursor: gate.allowed ? "pointer" : "not-allowed",
                  opacity: gate.allowed ? 1 : 0.55,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 14.5, color: C.ink }}>{spec.title}</span>
                  <span style={{ marginLeft: "auto" }}>
                    <Tag tone={gate.allowed ? "teal" : "amber"}>{gate.allowed ? "open" : "restricted"}</Tag>
                  </span>
                </div>
                <span style={{ fontSize: 12.5, color: C.soft, lineHeight: 1.4 }}>{spec.sub}</span>
                <span style={{ fontSize: 11, color: C.soft, letterSpacing: 0.4, textTransform: "uppercase", fontWeight: 700 }}>{String(spec.role).replace(/-/g, " ")}</span>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: C.soft, marginTop: 14 }}>
          Each desk reads this device's book and shows only the rows its role may see. Nothing is sent anywhere by opening one.
        </p>
      </main>
    </div>
  );
}

function Frame({ title, sub, onClose, children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "14px 16px", borderBottom: `3px solid ${C.gold}` }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: 2, color: C.gold, fontWeight: 700 }}>CARGOLINX</div>
            <h1 style={{ margin: 0, fontSize: 17 }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 12, color: "#c9d6e5" }}>{sub}</p>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", font: "inherit", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,.35)", background: "transparent", color: "#fff", cursor: "pointer" }}>
            All dashboards
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>{children}</main>
    </div>
  );
}
