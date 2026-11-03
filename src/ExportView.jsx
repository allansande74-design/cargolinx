import React, { useEffect, useMemo, useState } from "react";
import { exportLaneRows, reverseName, reverseShipment, corridorToChina, chinaLaneRows, CHINA_PORTS } from "../engine/lanes.mjs";
import { all, STORES } from "./lib/db.js";

/**
 * The export desk.
 *
 * Same tarmac as the import lanes, driven the other way: Kampala to Mombasa, Kigali to Mombasa, Nairobi
 * to Mombasa. The kilometres are the lanes' own, not a second table somebody typed, so the two directions
 * can never drift apart.
 *
 * The money is the part that must not be symmetrical. An export quote from Kenya carries no Kenyan import
 * duty, and the desk holds no destination tariff, so it prices what it can see - the goods, the inland leg,
 * the export papers, the ocean freight and the insurance - and stops at the destination port. Destination
 * duty is named as missing rather than estimated. Every figure except the lane distances is typed by the
 * operator, so nothing here is a rate the desk invented.
 */

const money = (n, ccy = "KES") =>
  `${ccy} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v));

export default function ExportView() {
  const [rest, setRest] = useState(0);
  const [lane, setLane] = useState("Kampala - Mombasa");
  const [port, setPort] = useState("Shanghai");

  const rows = useMemo(() => exportLaneRows(undefined, { restHours: num(rest) }), [rest]);
  const chosen = rows.find((r) => r.name === lane) ?? rows[0];
  const corridor = corridorToChina(lane, port);
  const sea = chinaLaneRows();

  const [carried, setCarried] = useState([]);
  const [pick, setPick] = useState("");
  useEffect(() => {
    let live = true;
    all(STORES.shipments)
      .then((rows) => { if (live) setCarried((rows ?? []).slice(0, 40)); })
      .catch(() => { if (live) setCarried([]); });
    return () => { live = false; };
  }, []);
  const chosenLoad = carried.find((s) => s.id === pick) ?? null;
  const rev = chosenLoad ? reverseShipment(chosenLoad) : null;

  const [f, setF] = useState({
    goodsUsd: 18500,
    freightUsd: 2900,
    insurancePct: 0.5,
    inlandKes: 0,
    papersKes: 0,
    fx: 129.83,
  });
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  const calc = useMemo(() => {
    const goods = num(f.goodsUsd);
    const freight = num(f.freightUsd);
    const insurance = ((goods + freight) * num(f.insurancePct)) / 100;
    const cifUsd = goods + freight + insurance;
    const inland = num(f.inlandKes);
    const papers = num(f.papersKes);
    const fx = num(f.fx) || 0;
    const kenyaSideUsd = fx > 0 ? (inland + papers) / fx : 0;
    return {
      goods,
      freight,
      insurance,
      cifUsd,
      inland,
      papers,
      fx,
      kenyaSideUsd,
      totalUsd: cifUsd + kenyaSideUsd,
      totalKes: (cifUsd + kenyaSideUsd) * fx,
    };
  }, [f]);

  return (
    <>
      <section className="card">
        <h2>Export lanes — the same roads, the other way round</h2>
        <p className="muted">
          Distances and speeds are the import lanes' own, reversed, so the two directions cannot disagree. Driving
          hours are the printed planning speeds — a laden truck, not a tracked vehicle — plus any rest the operator
          allows.
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="hint" htmlFor="ex-rest">Rest allowance (hours)</label>
          <input id="ex-rest" type="number" min="0" step="1" value={rest} onChange={(e) => setRest(e.target.value)} style={{ maxWidth: 90 }} />
        </div>
        <table className="lines">
          <thead>
            <tr>
              <th>Export lane</th>
              <th>Km</th>
              <th>Driving hours</th>
              <th>Borders</th>
              <th>Route</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} style={r.name === chosen?.name ? { fontWeight: 600 } : undefined}>
                <td>{r.name}</td>
                <td>{r.km}</td>
                <td>{r.hours}</td>
                <td>{r.borders}</td>
                <td className="hint">{r.route}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 8 }}>
          The symmetry stops at the border. An export declaration is lodged in Kenya <em>before</em> the truck reaches
          the post; an import entry is lodged after it. The lane is the same length either way — the paperwork is not.
        </p>
      </section>

      <section className="card">
        <h2>A load you already carried, read the other way</h2>
        <p className="muted">
          Pick a job the desk already holds. Its two ends swap and the lane is looked up by name in the same table, so
          the answer is the road it would run back and how long it is — not a guess at a new route.
        </p>
        {carried.length === 0 ? (
          <p className="hint">No shipments on this desk yet. Create one under New shipment, then come back.</p>
        ) : (
          <>
            <label className="field">Job
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Job to read the other way">
                <option value="">Choose a job…</option>
                {carried.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.ref || s.id).toString().slice(0, 18)} · {s.origin} → {s.destination} · {s.cargo}
                  </option>
                ))}
              </select>
            </label>
            {rev && (
              <>
                <table className="lines" style={{ marginTop: 10 }}>
                  <tbody>
                    <tr><td>As carried</td><td>{rev.asCarried}</td></tr>
                    <tr style={{ fontWeight: 600 }}><td>Read the other way</td><td>{rev.reversed}</td></tr>
                    <tr><td>Cargo on the record</td><td>{rev.cargo || "—"}{rev.weightKg ? ` · ${rev.weightKg} kg` : ""}</td></tr>
                    <tr><td>Lane</td><td>{rev.laneName ?? "none in the table"}</td></tr>
                    <tr><td>Distance and driving</td><td>{rev.km == null ? "not claimed" : `${rev.km} km · ${rev.hours} h at planning speeds · ${rev.borders} border${rev.borders === 1 ? "" : "s"}`}</td></tr>
                  </tbody>
                </table>
                {rev.reason && <p className="warning">{rev.reason}</p>}
                {rev.laneName && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => { setLane(rev.laneName); if (rev.goodsUsd) setF((prev) => ({ ...prev, goodsUsd: rev.goodsUsd })); }}>
                      Use this lane in the build-up
                    </button>
                    <span className="hint">Cargo and money stay as the export quote states them; only the lane and the goods value move across.</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Export build-up — priced to {port}, Kenya side</h2>
        <p className="muted">
          What the desk can see: the goods, the inland leg to the port, the export papers, the ocean freight and the
          insurance. What it will not do is guess the destination's import duty, its port charges or its clearing
          costs — the desk holds no tariff for another country, and a number invented there would follow the container
          all the way to a customer.
        </p>

        <div className="grid">
          <label className="field">Lane
            <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Export lane">
              {rows.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <label className="field">Goods value (USD) <input type="number" value={f.goodsUsd} onChange={set("goodsUsd")} /></label>
          <label className="field">Ocean freight (USD) <input type="number" value={f.freightUsd} onChange={set("freightUsd")} /></label>
          <label className="field">Marine insurance (%) <input type="number" step="0.05" value={f.insurancePct} onChange={set("insurancePct")} /></label>
          <label className="field">Inland to port (KES) <input type="number" value={f.inlandKes} onChange={set("inlandKes")} /></label>
          <label className="field">Export papers and clearance (KES) <input type="number" value={f.papersKes} onChange={set("papersKes")} /></label>
          <label className="field">Exchange rate (KES per USD) <input type="number" step="0.01" value={f.fx} onChange={set("fx")} /></label>
        </div>

        <table className="lines" style={{ marginTop: 12 }}>
          <tbody>
            <tr><td>Goods, as declared</td><td>{money(calc.goods, "USD")}</td></tr>
            <tr><td>Ocean freight</td><td>{money(calc.freight, "USD")}</td></tr>
            <tr><td>Marine insurance at {Number(num(f.insurancePct)).toFixed(2)}% of goods plus freight</td><td>{money(calc.insurance, "USD")}</td></tr>
            <tr style={{ fontWeight: 600 }}><td>CIF, {port}</td><td>{money(calc.cifUsd, "USD")}</td></tr>
            <tr><td>Inland to port</td><td>{money(calc.inland)}</td></tr>
            <tr><td>Export papers and clearance</td><td>{money(calc.papers)}</td></tr>
            <tr><td>Kenya-side costs, in dollars at {calc.fx || "—"}</td><td>{money(calc.kenyaSideUsd, "USD")}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>Total to {port}</td><td>{money(calc.totalUsd, "USD")} · {money(calc.totalKes)}</td></tr>
            <tr><td className="hint">Destination duty, port charges and clearing</td><td className="hint">Not quoted — no destination tariff held</td></tr>
          </tbody>
        </table>

        <p className="hint" style={{ marginTop: 8 }}>
          A Kenyan export shipment pays no Kenyan import duty, which is why no duty line appears above. What the buyer
          pays on arrival is their own country's charge, and it is named as missing rather than filled with a guess.
        </p>
      </section>


      <section className="card">
        <h2>…and on to China</h2>
        <p className="muted">
          Imports come from China, so the export corridor is the whole chain the other way: inland to Mombasa, then
          across the water. The sea distance is computed from the two ports' coordinates — great circle plus a routing
          allowance for the fact that a ship does not sail the straight line — and the passage is that distance at a
          stated service speed.
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="field">Chinese port
            <select value={port} onChange={(e) => setPort(e.target.value)} aria-label="Chinese port">
              {sea.map((p) => <option key={p.name} value={p.name.replace("Mombasa - ", "")}>{p.name.replace("Mombasa - ", "")}</option>)}
            </select>
          </label>
          <label className="field">Inland lane
            <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Inland export lane">
              {rows.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
        </div>
        {corridor && (
          <table className="lines">
            <tbody>
              <tr><td>Road: {corridor.laneName}</td><td>{corridor.inlandKm} km · {corridor.drivingHours} h · {corridor.borders} border{corridor.borders === 1 ? "" : "s"}</td></tr>
              <tr><td>Sea: Mombasa to {port}</td><td>{corridor.nm.toLocaleString("en-KE")} nm planning distance · great circle {corridor.greatCircleNm.toLocaleString("en-KE")} nm</td></tr>
              <tr><td>Sea passage at 16 knots</td><td>{corridor.seaDays.toFixed(1)} days</td></tr>
              <tr style={{ fontWeight: 600 }}><td>Whole corridor, {corridor.laneName.split(" - ")[0]} to {port}</td><td>{corridor.inlandKm} km road, then {corridor.nm.toLocaleString("en-KE")} nm sea</td></tr>
              <tr><td className="hint">Port calls, canal, berthing and the carrier's own transit</td><td className="hint">Not included — the service's quoted transit goes here</td></tr>
              <tr><td className="hint">Chinese import duty and destination charges</td><td className="hint">Not quoted — no Chinese tariff held</td></tr>
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          Kilometres on the road and nautical miles at sea are kept apart on purpose: adding them would give a number
          that means nothing. China's import duty is named as missing, for the same reason the destination port duty
          is on the build-up above.
        </p>
        <details style={{ marginTop: 10 }}>
          <summary className="hint">Every Chinese port the desk measures ({sea.length})</summary>
          <table className="lines" style={{ marginTop: 8 }}>
            <thead><tr><th>Port</th><th>Planning nm</th><th>Great circle</th><th>Sea days at 16 kn</th></tr></thead>
            <tbody>
              {sea.map((p) => (
                <tr key={p.name}><td>{p.name}</td><td>{p.nm.toLocaleString("en-KE")}</td><td>{p.greatCircleNm.toLocaleString("en-KE")}</td><td>{p.seaDays.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="card">
        <h2>What reverses, and what does not</h2>
        <ul className="hint" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><strong>Reverses:</strong> the road, the kilometres, the driving hours, the border posts, the lane name (
            {reverseName("Mombasa - Kampala")} instead of Mombasa - Kampala).</li>
          <li><strong>Reverses:</strong> who lodges first. Export entry before the post, import entry after it.</li>
          <li><strong>Does not reverse:</strong> duty. Kenya taxes imports, not exports, so the export build-up carries no duty line.</li>
          <li><strong>Does not reverse:</strong> empty running. The truck that delivers into Kampala comes back light unless a
            return load is booked, and the export quote for that road is where the return leg is paid for.</li>
        </ul>
      </section>
    </>
  );
}
