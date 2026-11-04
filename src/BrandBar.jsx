import React from "react";

/**
 * BrandBar — both companies, every page.
 *
 * Altovex Global Logistics is the operating company; CargoLinx is its freight desk. The strip is
 * fixed at 46px so a judge landing on any page, including a deep desk tab, can see whose platform
 * this is and reach the contact page in one click.
 *
 * The logos are drawn as SVG in /public/brand so they stay sharp, weigh nothing, and never depend on
 * an external host at demo time.
 */
const NAVY = "#0a1f3c";
const GOLD = "#c9a227";

export default function BrandBar() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 46,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "0 14px",
        background: NAVY,
        borderBottom: `2px solid ${GOLD}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, overflow: "hidden" }}>
        <a href="#/desk/new" aria-label="Altovex CargoLinx desk" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src="/brand/altovex.svg" alt="Altovex Global Logistics" height="30" style={{ height: 30, width: "auto", display: "block" }} />
          <span aria-hidden="true" style={{ width: 1, height: 22, background: "rgba(201,162,39,.45)" }} />
          <img src="/brand/cargolinx.svg" alt="CargoLinx freight desk" height="30" style={{ height: 30, width: "auto", display: "block" }} />
        </a>
        <span className="brand-suffix" style={{ color: "#9fb0c7", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          Nairobi · East Africa
        </span>
      </div>

      <nav style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <a href="#/contact" style={pill}>Contact us</a>
        <a href="https://wa.me/254718554383" target="_blank" rel="noreferrer" style={pill}>WhatsApp</a>
        <a href="#/desk/new" style={{ ...pill, background: GOLD, color: NAVY, fontWeight: 700 }}>Open the desk</a>
      </nav>
    </div>
  );
}

const pill = {
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(201,162,39,.7)",
  color: "#eaf0f7",
  textDecoration: "none",
  whiteSpace: "nowrap",
};
