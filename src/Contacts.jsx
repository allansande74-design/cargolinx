export default function Contacts() {
  const navy = "#071a33";
  const gold = "#d8a13a";
  const teal = "#159a8c";
  const cardBg = "#0d2547";
  const textLight = "#eaf0f7";
  const textMuted = "#9fb0c7";

  const card = {
    background: cardBg,
    border: "1px solid rgba(216,161,58,0.25)",
    borderRadius: 12,
    padding: 22,
  };
  const label = { color: gold, fontSize: 12, letterSpacing: 2, fontWeight: 700, margin: "0 0 10px" };
  const row = { margin: "6px 0", fontSize: 15, color: textLight };
  const link = { color: teal, textDecoration: "none" };
  const badgePending = {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    padding: "3px 10px",
    borderRadius: 999,
    border: `1px solid ${gold}`,
    color: gold,
  };

  return (
    <div style={{ background: navy, minHeight: "100vh", padding: "40px 24px", color: textLight, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ color: gold, fontSize: 12, letterSpacing: 2, fontWeight: 700, margin: "0 0 8px" }}>CARGOLINX</p>
        <h1 style={{ margin: "0 0 8px", fontSize: 32 }}>Contact</h1>
        <p style={{ color: textMuted, margin: "0 0 28px", fontSize: 15 }}>Verified contacts only.</p>

        <div style={{ display: "grid", gap: 16 }}>
          <div style={card}>
            <p style={label}>DREAMTEAM</p>
            <p style={row}>
              <a style={link} href="tel:+254718554383">+254 718 554 383</a>
            </p>
            <p style={row}>
              <a style={link} href="mailto:dreamteamconsult@gmx.com">dreamteamconsult@gmx.com</a>
            </p>
            <p style={row}>
              <a style={link} href="https://www.dreamteamea.com" target="_blank" rel="noreferrer">www.dreamteamea.com</a>
            </p>
          </div>

          <div style={card}>
            <p style={label}>ALTOVEX</p>
            <p style={row}>P.O. Box 3515-00100 Nairobi</p>
            <p style={row}>
              <a style={link} href="mailto:altovexgl@gmail.com">altovexgl@gmail.com</a>
            </p>
            <p style={row}>M-PESA paybill 400200 · acct 40045731</p>
          </div>

          <div style={card}>
            <p style={label}>WHATSAPP</p>
            <p style={row}>
              WhatsApp Business API <span style={badgePending}>PENDING</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
