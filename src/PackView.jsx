import { useMemo, useState } from "react";
import {
  RUNGS,
  STAGES,
  measureConsignment,
  ladderFor,
  stageBoard,
} from "../engine/ladder.mjs";

/**
 * Pack and price.
 *
 * A client measures a carton, says how many there are, and the desk says: your carton is (or is not)
 * box-shaped and here is why, this is your cubic metres, this is the unit that carries it, this is
 * what it costs per consignment, per tonne and per cubic metre — and here is the whole chain the load
 * will walk, with who owns each step.
 */

const NAVY = "#0a1f3c";
const GOLD = "#c9a227";
const GOLD_LIGHT = "#f5e7bd";
const INK = "#22303f";
const LINE = "#dbe4ef";
const MUTED = "#5a6b80";
const GREEN = "#1c7a4a";
const AMBER = "#8a6100";

const card = {
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 14,
};

const label = { display: "block", fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 4 };

const input = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 11px",
  borderRadius: 8,
  border: `1px solid #c3cfdd`,
  fontSize: 15,
  color: INK,
  background: "#fff",
};

const num = (v) => (v === "" ? "" : Number(v));

export default function PackView() {
  const [dims, setDims] = useState({ lengthCm: 60, widthCm: 40, heightCm: 40 });
  const [weight, setWeight] = useState(20);
  const [count, setCount] = useState(40);
  const [km, setKm] = useState(500);

  const result = useMemo(() => {
    try {
      const consignment = measureConsignment({
        lengthCm: num(dims.lengthCm),
        widthCm: num(dims.widthCm),
        heightCm: num(dims.heightCm),
        weightKg: Number(weight),
        count: Number(count),
      });
      const ladder = ladderFor({
        weightKg: consignment.kg,
        cbm: consignment.cbm,
        distanceKm: Number(km),
      });
      return { consignment, ladder, error: null };
    } catch (e) {
      return { error: e.message, consignment: null, ladder: null };
    }
  }, [dims, weight, count, km]);

  const best = result.ladder?.rows.find((r) => r.isSmallestFit) ?? null;
  const board = stageBoard({ completed: ["onboard", "pack"], current: "source" });

  const set = (k) => (e) => setDims({ ...dims, [k]: e.target.value });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "8px 4px 40px", color: INK }}>
      <h1 style={{ fontSize: 22, margin: "6px 0 4px", color: NAVY }}>Pack it right, then price it honestly</h1>
      <p style={{ margin: "0 0 16px", color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
        Measure one carton in centimetres. The desk checks it is a box, works out the cubic metres for
        the whole consignment, and puts the load on the smallest unit that actually carries it — from a
        boda boda to a 30-tonne regional truck.
      </p>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <div>
            <label style={label} htmlFor="len">Length (cm)</label>
            <input id="len" style={input} inputMode="numeric" value={dims.lengthCm} onChange={set("lengthCm")} />
          </div>
          <div>
            <label style={label} htmlFor="wid">Width (cm)</label>
            <input id="wid" style={input} inputMode="numeric" value={dims.widthCm} onChange={set("widthCm")} />
          </div>
          <div>
            <label style={label} htmlFor="hei">Height (cm)</label>
            <input id="hei" style={input} inputMode="numeric" value={dims.heightCm} onChange={set("heightCm")} />
          </div>
          <div>
            <label style={label} htmlFor="kg">Weight each (kg)</label>
            <input id="kg" style={input} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="qty">Cartons</label>
            <input id="qty" style={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="km">Distance (km)</label>
            <input id="km" style={input} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
          </div>
        </div>
      </div>

      {result.error && (
        <div style={{ ...card, borderColor: "#c0392b", background: "#fdf1ef", color: "#8c2b1f" }}>
          <strong>That cannot be priced.</strong> {result.error}
        </div>
      )}

      {result.consignment && (
        <>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontSize: 16, margin: 0, color: NAVY }}>The carton</h2>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "4px 9px",
                  borderRadius: 999,
                  color: result.consignment.carton.boxShaped ? GREEN : AMBER,
                  background: result.consignment.carton.boxShaped ? "#e8f5ee" : "#fdf6e3",
                }}
              >
                {result.consignment.carton.boxShaped ? "box-shaped" : "not box-shaped"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginTop: 12 }}>
              <Figure k="Per carton" v={`${result.consignment.cbmPerCarton} m³`} />
              <Figure k="Consignment" v={`${result.consignment.cbm} m³`} />
              <Figure k="Actual weight" v={`${result.consignment.kg.toLocaleString()} kg`} />
              <Figure k="Chargeable" v={`${result.consignment.chargeableKg.toLocaleString()} kg`} sub={`on ${result.consignment.chargeableBasis}`} />
              <Figure k="Density" v={`${result.consignment.carton.densityKgPerM3} kg/m³`} />
            </div>

            <p style={{ margin: "12px 0 0", fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
              Void allowance {Math.round(result.consignment.voidAllowance * 100)}% is added once for stacking.
              Road freight charges on the greater of actual and volume weight, at 250 kg per cubic metre.
            </p>

            {result.consignment.carton.problems.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: "#7a4b00", lineHeight: 1.55 }}>
                {result.consignment.carton.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>

          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px", color: NAVY }}>The unit that carries it</h2>
            {best ? (
              <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.55 }}>
                <strong style={{ color: NAVY }}>{best.label}</strong> — KES{" "}
                {best.payableKes.toLocaleString()} for the load, KES {best.perTonneKes.toLocaleString()} a
                tonne, KES {best.perCbmKes.toLocaleString()} a cubic metre over {km} km.
              </p>
            ) : (
              <p style={{ margin: "0 0 12px", fontSize: 14, color: "#8c2b1f" }}>
                Nothing on the ladder carries this load in one unit — split it, or send a convoy.
              </p>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: MUTED, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    <th style={{ padding: "6px 8px" }}>Unit</th>
                    <th style={{ padding: "6px 8px" }}>Carries</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Load</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Per tonne</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Per m³</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Fill</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ladder.rows.map((row) => {
                    const rung = RUNGS.find((r) => r.code === row.code);
                    return (
                      <tr
                        key={row.code}
                        style={{
                          borderTop: `1px solid ${LINE}`,
                          background: row.isSmallestFit ? "#f7f2df" : "transparent",
                          opacity: row.fits ? 1 : 0.55,
                        }}
                      >
                        <td style={{ padding: "7px 8px", fontWeight: row.isSmallestFit ? 700 : 500 }}>
                          {row.isSmallestFit ? "★ " : ""}
                          {rung.label}
                        </td>
                        <td style={{ padding: "7px 8px", color: MUTED }}>
                          {rung.payloadKg.toLocaleString()} kg · {rung.volumeM3} m³
                        </td>
                        <td style={{ padding: "7px 8px", textAlign: "right" }}>{row.fits ? row.payableKes.toLocaleString() : "—"}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right" }}>{row.fits ? row.perTonneKes.toLocaleString() : "—"}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right" }}>{row.fits ? row.perCbmKes.toLocaleString() : "—"}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: MUTED }}>
                          {row.fits ? `${Math.max(row.utilisation.weightPct, row.utilisation.volumePct)}%` : "too big"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p style={{ margin: "10px 0 0", fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
              Rates are the desk's internal planning rates in KES per kilometre for the whole vehicle and
              are replaced with a signed carrier rate before any figure is issued. A half-full truck still
              costs a truck, so the load is priced on the greater of its weight share and its volume share.
            </p>
          </div>
        </>
      )}

      <div style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 4px", color: NAVY }}>The whole chain, every stage owned</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
          Sixteen stages from onboarding to the client's signature on the delivery form. A green tick means
          the desk has the fields, the checklist and the document to run that stage today — never that an
          agency has approved anything, which is the agency's record, not ours.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {board.rows.map((stage, i) => {
            const tone = stage.state === "done" ? GREEN : stage.state === "current" ? AMBER : MUTED;
            return (
              <div key={stage.code} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 13.5, color: NAVY }}>
                    {i + 1}. {stage.label}
                  </strong>
                  <span style={{ fontSize: 11, color: tone, fontWeight: 700 }}>{stage.state}</span>
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>
                  {stage.where === "desk" ? "run by the desk" : stage.where === "agency" ? "institution or agency" : "client"}
                  {stage.green ? " · ready" : ""}
                </div>
                <p style={{ margin: "5px 0 0", fontSize: 12.5, color: INK, lineHeight: 1.5 }}>{stage.note}</p>
              </div>
            );
          })}
        </div>

        <p style={{ margin: "12px 0 0", fontSize: 12, color: MUTED }}>
          {board.done} of {board.total} stages complete on this job. The board closes only on the client's
          signature, and a stage cannot be marked done without its reference.
        </p>
      </div>

      <p style={{ fontSize: 11.5, color: MUTED, textAlign: "center", marginTop: 6 }}>
        {STAGES.length} stages · 7 units · box-shape check, cubic metres and chargeable weight computed here
      </p>
    </div>
  );
}

function Figure({ k, v, sub }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>}
    </div>
  );
}
