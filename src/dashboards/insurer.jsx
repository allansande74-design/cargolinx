import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate, atRisk, stageIndex } from "../lib/dashboards.mjs";

export default function InsurerDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const inTransit = orders.filter((o) => {
    const i = stageIndex(o.stage);
    return i >= stageIndex("freight_booked") && i < stageIndex("delivered");
  });
  const risk = atRisk(orders, d.now ?? new Date()).filter((r) => stageIndex(r.order.stage) < stageIndex("delivered"));

  return (
    <DashboardShell specKey="insurer" data={data}>
      <Panel title="Cargo in transit" hint="Declared value and carrier for every load currently on the road or at the border.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Assured", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "carrier", label: "Carrier", render: (r) => r.carrier ?? "—" },
            { k: "vehicleId", label: "Plate", render: (r) => r.vehicleId ?? "—" },
            { k: "valueKes", label: "Declared value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Due", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={inTransit}
          empty="Nothing in transit."
        />
      </Panel>

      <Panel title="Open exceptions" hint="Late against the promise, or delivered late — the two conditions that produce a claim.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "sla", label: "Condition", render: (r) => <Tag tone="red">{r.sla.status}</Tag> },
            { k: "stage", label: "Stage", render: (r) => String(r.stage).replace(/_/g, " ") },
            { k: "hours", label: "Hours late", align: "right", render: (r) => r.sla.lateByHours ?? "—" },
            { k: "valueKes", label: "Exposure", align: "right", render: (r) => money(orderTotal(r)) },
          ]}
          rows={risk.map((r) => ({ ...r.order, sla: r.sla }))}
          empty="No open exception."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>
        Declared value at risk: {money(inTransit.reduce((a, o) => a + orderTotal(o), 0))} across {inTransit.length} loads.
      </p>
    </DashboardShell>
  );
}
