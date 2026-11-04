/**
 * Contact — verified channels only.
 *
 * Rule for this page: nothing appears here that the desk cannot answer on. Handles that are not live
 * are named as being set up rather than linked to a dead account, because a contact page that fails
 * to answer costs more trust than one that admits it is still being built.
 */
export default function ContactPage() {
  const navy = "#071a33";
  const gold = "#c9a227";
  const teal = "#159a8c";
  const cardBg = "#0d2547";
  const textLight = "#eaf0f7";
  const textMuted = "#9fb0c7";

  const card = { background: cardBg, border: "1px solid rgba(201,162,39,0.28)", borderRadius: 12, padding: 22 };
  const label = { color: gold, fontSize: 12, letterSpacing: 2, fontWeight: 700, margin: "0 0 10px" };
  const row = { margin: "7px 0", fontSize: 15, color: textLight, lineHeight: 1.45 };
  const link = { color: teal, textDecoration: "none" };
  const live = { display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "3px 10px", borderRadius: 999, background: teal, color: "#04231f" };
  const soon = { display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "3px 10px", borderRadius: 999, border: `1px solid ${gold}`, color: gold };

  return (
    <div style={{ background: navy, minHeight: "100vh", padding: "32px 20px 72px", color: textLight, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          <img src="/brand/altovex.svg" alt="Altovex Global Logistics" height="34" style={{ height: 34, width: "auto" }} />
          <img src="/brand/cargolinx.svg" alt="CargoLinx freight desk" height="34" style={{ height: 34, width: "auto" }} />
        </div>

        <h1 style={{ margin: "0 0 8px", fontSize: 32 }}>Contact us</h1>
        <p style={{ color: textMuted, margin: "0 0 26px", fontSize: 15 }}>
          One desk for sourcing, ocean freight, clearing, warehousing and last mile — DDP across East Africa.
        </p>

        <div style={{ display: "grid", gap: 16 }}>
          <div style={card}>
            <p style={label}>ALTOVEX GLOBAL LOGISTICS</p>
            <p style={row}>
              <a style={link} href="tel:+254718554383">+254 718 554 383</a>
              {" · "}
              <a style={link} href="tel:+254753005989">+254 753 005 989</a>
            </p>
            <p style={row}>
              <a style={link} href="mailto:altovexgl@gmail.com">altovexgl@gmail.com</a>
            </p>
            <p style={row}>P.O. Box 3515-00100, Nairobi, Kenya</p>
            <p style={row}>Cooperative Bank of Kenya · SWIFT COOPKENA</p>
            <p style={row}>M-PESA paybill 400200 · account 40045731</p>
          </div>

          <div style={card}>
            <p style={label}>THE DESK, LIVE NOW</p>
            <p style={row}>
              <a style={link} href="#/desk/new">Open the freight desk</a> — quote a shipment, read a rate card, track a load.
            </p>
            <p style={row}>
              <a style={link} href="https://wa.me/254718554383" target="_blank" rel="noreferrer">WhatsApp click-to-chat</a>{" "}
              <span style={live}>LIVE</span>
            </p>
            <p style={row}>
              <a style={link} href="mailto:altovexgl@gmail.com?subject=Freight%20enquiry">Email an enquiry</a> — answered the same working day.
            </p>
          </div>

          <div style={card}>
            <p style={label}>SOCIAL</p>
            <p style={row}>
              WhatsApp <span style={live}>LIVE</span>
            </p>
            <p style={row}>
              Instagram · LinkedIn · Facebook · X · TikTok <span style={soon}>BEING SET UP</span>
            </p>
            <p style={{ ...row, color: textMuted, fontSize: 13.5 }}>
              The handles are being registered under the company name. They will be published here the day
              they are live; the desk will not link an account nobody answers.
            </p>
          </div>

          <div style={card}>
            <p style={label}>DREAMTEAM CONSULTING</p>
            <p style={row}>
              <a style={link} href="mailto:dreamteamconsult@gmx.com">dreamteamconsult@gmx.com</a>
              {" · "}
              <a style={link} href="https://www.dreamteamea.com" target="_blank" rel="noreferrer">www.dreamteamea.com</a>
            </p>
            <p style={{ ...row, color: textMuted, fontSize: 13.5 }}>
              The software company behind the platform: CargoLinx, the DigitalDen and the document suite.
            </p>
          </div>
        </div>

        <p style={{ color: textMuted, fontSize: 13, marginTop: 24 }}>
          Ask Amanda, the assistant in the corner of every page, for lanes, transit times, documents and indicative
          rates. Prices and bookings are confirmed by the desk in writing.
        </p>
      </div>
    </div>
  );
}
