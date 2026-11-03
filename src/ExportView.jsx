import React, { useMemo, useState } from "react";
import { exportLaneRows, reverseName } from "../engine/lanes.mjs";

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

  const rows = useMemo(() => exportLaneRows(undefined, { restHours: num(rest) }), [rest]);
  const chosen = rows.find((r) => r.name === lane) ?? rows[0];

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
        <h2>Export build-up — Kenya side, priced to the destination port</h2>
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
            <tr style={{ fontWeight: 600 }}><td>CIF, destination port</td><td>{money(calc.cifUsd, "USD")}</td></tr>
            <tr><td>Inland to port</td><td>{money(calc.inland)}</td></tr>
            <tr><td>Export papers and clearance</td><td>{money(calc.papers)}</td></tr>
            <tr><td>Kenya-side costs, in dollars at {calc.fx || "—"}</td><td>{money(calc.kenyaSideUsd, "USD")}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>Total to the destination port</td><td>{money(calc.totalUsd, "USD")} · {money(calc.totalKes)}</td></tr>
            <tr><td className="hint">Destination duty, port charges and clearing</td><td className="hint">Not quoted — no destination tariff held</td></tr>
          </tbody>
        </table>

        <p className="hint" style={{ marginTop: 8 }}>
          A Kenyan export shipment pays no Kenyan import duty, which is why no duty line appears above. What the buyer
          pays on arrival is their own country's charge, and it is named as missing rather than filled with a guess.
        </p>
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
