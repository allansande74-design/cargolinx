import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { STAGES } from "../../engine/orders.mjs";
import { orderTotal, stageLabel, money, shortDate, trucks, truckState } from "../lib/dashboards.mjs";

export default function OverviewDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const funnel = STAGES.map((s) => {
    const rows = orders.filter((o) => o.stage === s.key);
    return { id: s.key, stage: s.label, n: rows.length, value: rows.reduce((a, o) => a + orderTotal(o), 0) };
  }).filter((r) => r.n > 0);
  const fleet = trucks(d.partners ?? []);

  return (
    <DashboardShell specKey="overview" data={data}>
      <Panel title="Where the book stands" hint="Open files by stage, with the value sitting in each stage.">
        <DashTable
          columns={[
            { k: "stage", label: "Stage" },
            { k: "n", label: "Files", align: "right" },
            { k: "value", label: "Value", align: "right", render: (r) => money(r.value) },
          ]}
          rows={funnel}
          empty="No orders in the book yet. Create one on the desk and it appears here."
        />
      </Panel>

      <Panel title="Recent files" hint="Newest first, with the promise on each file.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "stage", label: "Stage", render: (r) => <Tag tone={r.stage === "delivered" ? "teal" : "ink"}>{stageLabel(r.stage)}</Tag> },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={orders.slice(0, 8)}
        />
      </Panel>

      <Panel title="Fleet" hint="A plate counts as ready only when its papers are verified for its lane today.">
        <DashTable
          columns={[
            { k: "plate", label: "Plate" },
            { k: "owner", label: "Owner" },
            { k: "capacityKg", label: "Capacity", align: "right", render: (r) => `${Math.round(Number(r.capacityKg ?? 0) / 1000)} t` },
            { k: "state", label: "Today", render: (r) => (truckState(d.partners ?? [], r, d.now ?? new Date()).eligible ? <Tag tone="teal">eligible</Tag> : <Tag tone="amber">papers</Tag>) },
          ]}
          rows={fleet}
          empty="No trucks on the register yet. Onboard one from the Network screen."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Figures are read from this device's book. Opening a dashboard sends nothing anywhere.</p>
    </DashboardShell>
  );
}
