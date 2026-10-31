export default function DashboardShell({ title, children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fa", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ background: "#071a33", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: "12px", borderBottom: "3px solid #d8a13a" }}>
        <span style={{ width: "32px", height: "32px", borderRadius: "8px", background: "#d8a13a", color: "#071a33", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>C</span>
        <div>
          <div style={{ fontSize: "12px", letterSpacing: "2px", color: "#d8a13a", fontWeight: 700 }}>CARGOLINX</div>
          <h1 style={{ margin: 0, fontSize: "18px" }}>{title}</h1>
        </div>
        <span style={{ marginLeft: "auto", fontSize: "12px", background: "#159a8c", padding: "4px 10px", borderRadius: "999px" }}>STUB</span>
      </header>
      <main style={{ padding: "20px", maxWidth: "1100px", margin: "0 auto" }}>{children}</main>
      {/* WIRED-LATER: Amanda chatbot FAB */}
      <button
        data-amanda-fab="true"
        data-wired="WIRED-LATER"
        aria-label="Chat with Amanda"
        style={{ position: "fixed", right: "20px", bottom: "20px", width: "56px", height: "56px", borderRadius: "50%", border: "none", background: "#159a8c", color: "#fff", fontSize: "24px", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.3)" }}
      >
        A
      </button>
    </div>
  );
}
