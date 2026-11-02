import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { orderTotal, money, shortDate, trucks, truckState } from "../lib/dashboards.mjs";
import { truckReadiness } from "../lib/truck-matching.mjs";

export default function TransporterDashboard({ data }) {
  const d = data ?? {};
  const partners = d.partners ?? [];
  const fleet = trucks(partners);
  const now = d.now ?? new Date();

  const readiness = (truck) => {
    try {
      return truckReadiness(partners, { plate: truck.plate, corridor: (truck.corridors ?? [])[0], at: now });
    } catch (err) {
      return { ready: false, blockers: [String(err.message ?? err)] };
    }
  };

  const trips = (d.orders ?? []).filter((o) => ["freight_booked", "in_transit", "dispatched"].includes(o.stage));

  return (
    <DashboardShell specKey="transporter" data={data}>
      <Panel title="Fleet readiness" hint="A plate is ready only for the lane it is legal and able to run today.">
        <DashTable
          columns={[
            { k: "plate", label: "Plate" },
            { k: "owner", label: "Owner" },
            { k: "classCode", label: "Class", render: (r) => String(r.classCode ?? "—").replace(/_/g, " ") },
            { k: "capacityKg", label: "Capacity", align: "right", render: (r) => `${Math.round(Number(r.capacityKg ?? 0) / 1000)} t` },
            { k: "lane", label: "Lane", render: (r) => (r.corridors ?? []).join(", ") || "—" },
            {
              k: "ready",
              label: "Today",
              render: (r) => {
                const res = readiness(r);
                return res.ready ? <Tag tone="teal">ready</Tag> : <Tag tone="amber">{(res.blockers ?? []).length} blocker{(res.blockers ?? []).length === 1 ? "" : "s"}</Tag>;
              },
            },
          ]}
          rows={fleet}
          empty="No plates registered. Onboard a truck from the Network screen."
        />
      </Panel>

      <Panel title="Cargo on our plates" hint="Loads that are booked with a carrier and not yet delivered.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "carrier", label: "Carrier", render: (r) => r.carrier ?? "—" },
            { k: "transportRef", label: "Trip ref", render: (r) => r.transportRef ?? "—" },
            { k: "stage", label: "Stage", render: (r) => <Tag>{String(r.stage).replace(/_/g, " ")}</Tag> },
            { k: "valueKes", label: "Cargo value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={trips}
          empty="No loads booked to this fleet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>
        {fleet.filter((t) => truckState(partners, t, now).eligible).length} of {fleet.length} plates are eligible on their primary lane today.
      </p>
    </DashboardShell>
  );
}
