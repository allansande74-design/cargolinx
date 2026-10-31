export default function Admin() {
  const navy = "#071a33";
  const gold = "#d8a13a";
  const teal = "#159a8c";
  const cardBg = "#0d2547";
  const textLight = "#eaf0f7";
  const textMuted = "#9fb0c7";

  const modules = [
    { name: "Finance", desc: "Invoices, M-PESA reconciliation, paybill ledger.", status: "PLANNED" },
    { name: "Warehouse", desc: "Stock in/out, bin locations, cycle counts.", status: "PLANNED" },
    { name: "Fleet", desc: "Vehicles, drivers, routes, fuel and maintenance.", status: "PLANNED" },
    { name: "SMM/SEO automation", desc: "Scheduled posts, keyword tracking, content queue.", status: "PLANNED" },
    { name: "Ads automation", desc: "Campaign budgets, creatives, ROAS tracking.", status: "PLANNED" },
  ];

  const badge = (s) => ({
    display: "inline-block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    padding: "3px 10px",
    borderRadius: 999,
    background: s === "PLANNED" ? "transparent" : teal,
    color: s === "PLANNED" ? gold : "#fff",
    border: `1px solid ${s === "PLANNED" ? gold : teal}`,
  });

  return (
    <div style={{ background: navy, minHeight: "100vh", padding: "40px 24px", color: textLight, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <p style={{ color: gold, fontSize: 12, letterSpacing: 2, fontWeight: 700, margin: "0 0 8px" }}>CARGOLINX ERP</p>
        <h1 style={{ margin: "0 0 8px", fontSize: 32 }}>Modules overview</h1>
        <p style={{ color: textMuted, margin: "0 0 28px", fontSize: 15 }}>
          All modules below are <span style={badge("PLANNED")}>PLANNED</span> — not yet built or measured.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {modules.map((m) => (
            <div
              key={m.name}
              style={{ background: cardBg, border: "1px solid rgba(216,161,58,0.25)", borderRadius: 12, padding: 20 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{m.name}</h2>
                <span style={badge(m.status)}>{m.status}</span>
              </div>
              <p style={{ margin: 0, color: textMuted, fontSize: 14, lineHeight: 1.5 }}>{m.desc}</p>
            </div>
          ))}
        </div>
        <p style={{ color: textMuted, fontSize: 12, marginTop: 24 }}>
          Owner: Mr. Allan. Status truth rule: every figure labelled VERIFIED (measured) or PLANNED.
        </p>
      </div>
    </div>
  );
}
