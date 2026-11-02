import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate, trucks } from "../lib/dashboards.mjs";
import { availableTrucks } from "../lib/truck-matching.mjs";

export default function MatchDashboard({ data }) {
  const d = data ?? {};
  const now = d.now ?? new Date();
  const partners = d.partners ?? [];
  const loads = (d.orders ?? []).filter((o) => ["confirmed", "sourcing", "purchased", "freight_booked"].includes(o.stage) && !o.carrier);

  const rows = loads.map((o) => {
    const kg = Math.round((o.lines ?? []).reduce((a, l) => a + Number(l.qty ?? 0) * Number(l.weightKg ?? 0), 0));
    const lane = o.destination?.lane ?? null;
    let candidates = [];
    try {
      candidates = availableTrucks(partners, { corridor: lane, weightKg: kg || null, at: now });
    } catch (err) {
      candidates = [];
    }
    return { ...o, weightKg: kg, lane: lane ?? "lane not stated", candidates: candidates.length, best: candidates[0]?.plate ?? "none" };
  });

  return (
    <DashboardShell specKey="match" data={data}>
      <Panel title="Loads without a truck" hint="Only a plate that is legal for the lane and rated for the weight may be offered.">
        <DashTable
          columns={[
            { k: "id", label: "Load" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "lane", label: "Lane" },
            { k: "weightKg", label: "Weight", align: "right", render: (r) => (r.weightKg ? `${r.weightKg} kg` : "not stated") },
            { k: "candidates", label: "Plates", align: "right", render: (r) => (r.candidates ? <Tag tone="teal">{r.candidates}</Tag> : <Tag tone="amber">0</Tag>) },
            { k: "best", label: "First offer", render: (r) => r.best },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={rows}
          empty="Every load has a carrier."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>
        {trucks(partners).length} plates on the register. A broker fee above 5% of the trip cost is refused by the engine, so it never reaches this board.
      </p>
    </DashboardShell>
  );
}
