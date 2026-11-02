import { specFor, kpisFor, attentionFor, money, shortDate } from "../lib/dashboards.mjs";
import { C, Panel, Tag } from "./_data.jsx";

function Kpi({ item }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: C.soft, fontWeight: 700 }}>{item.k}</div>
      <div style={{ fontSize: item.money ? 20 : 24, fontWeight: 800, color: C.ink, marginTop: 4 }}>{item.v}</div>
      {item.hint ? <div style={{ fontSize: 11.5, color: C.soft, marginTop: 2 }}>{item.hint}</div> : null}
    </div>
  );
}

const SEVERITY = { high: "red", medium: "amber", low: "teal" };

export default function DashboardShell({ specKey, data, actions, children }) {
  const spec = specFor(specKey);
  const kpis = data ? kpisFor(spec.role, data) : [];
  const work = data ? attentionFor(spec.role, data) : [];
  const who = data?.user ? `${data.user.name ?? data.user.email ?? "Signed in"} · ${data.user.role}` : "Demonstration session";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "12px 16px", borderBottom: `3px solid ${C.gold}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 1180, margin: "0 auto" }}>
          <a href="#/hub" style={{ width: 34, height: 34, borderRadius: 9, background: C.gold, color: C.navy, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, textDecoration: "none", flex: "0 0 auto" }}>C</a>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 2, color: C.gold, fontWeight: 700 }}>CARGOLINX · {String(spec.role).replace(/-/g, " ").toUpperCase()}</div>
            <h1 style={{ margin: 0, fontSize: 17, lineHeight: 1.25 }}>{spec.title}</h1>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "#c9d6e5", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
            <span style={{ fontSize: 11, background: C.teal, padding: "4px 9px", borderRadius: 999, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
      </header>

      <main style={{ padding: "16px", maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <a href="#/hub" style={{ fontSize: 12.5, color: C.teal, textDecoration: "none", fontWeight: 700 }}>← All dashboards</a>
          <span style={{ fontSize: 12.5, color: C.soft }}>{spec.sub}</span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.soft }}>
            {data ? `Read ${new Date(data.loadedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })} · ${data.orderNote}` : "Loading the book…"}
          </span>
          {actions}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          {kpis.map((k) => <Kpi key={k.k} item={k} />)}
        </div>

        {work.length ? (
          <Panel title="Needs attention" hint="One reason per row, in the order an operator should work it.">
            <div style={{ display: "grid", gap: 8 }}>
              {work.map((w, i) => (
                <div key={`${w.ref}-${i}`} style={{ display: "flex", gap: 10, alignItems: "flex-start", borderLeft: `3px solid ${w.severity === "high" ? C.red : w.severity === "medium" ? C.gold : C.teal}`, padding: "6px 10px", background: "#fbfcfe", borderRadius: 8 }}>
                  <Tag tone={SEVERITY[w.severity]}>{w.severity}</Tag>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{w.title}</div>
                    <div style={{ fontSize: 12.5, color: C.soft }}>{w.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        {children}
      </main>
    </div>
  );
}

export { money, shortDate };
