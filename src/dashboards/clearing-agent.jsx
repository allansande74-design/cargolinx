import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate, stageIndex, stageLabel } from "../lib/dashboards.mjs";

const BORDER_FIELDS = [
  ["poRef", "Purchase order"],
  ["supplier", "Supplier"],
  ["carrier", "Carrier"],
  ["transportRef", "Freight reference"],
];

export default function ClearingAgentDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const atBorder = orders.filter((o) => {
    const i = stageIndex(o.stage);
    return i >= stageIndex("freight_booked") && i < stageIndex("received");
  });

  const rows = atBorder.map((o) => {
    const missing = BORDER_FIELDS.filter(([k]) => !o[k]).map(([, label]) => label);
    return { ...o, missing, readiness: missing.length ? "documents" : "cleared" };
  });

  return (
    <DashboardShell specKey="clearing-agent" data={data}>
      <Panel title="Files at the border" hint="Anything between freight booked and warehouse receipt is in clearing's hands.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Importer", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "stage", label: "Stage", render: (r) => <Tag>{stageLabel(r.stage)}</Tag> },
            { k: "supplier", label: "Supplier", render: (r) => r.supplier ?? "—" },
            { k: "transportRef", label: "Freight ref", render: (r) => r.transportRef ?? "—" },
            { k: "valueKes", label: "Declared value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "arrivedAt", label: "Arrived", render: (r) => shortDate(r.arrivedAt ?? r.updatedAt) },
          ]}
          rows={rows}
          empty="No file is at the border."
        />
      </Panel>

      <Panel title="Documents outstanding" hint="Release waits on the paper, not on the promise of paper.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "missing", label: "Missing", render: (r) => (r.missing.length ? <span style={{ color: C.red }}>{r.missing.join(", ")}</span> : <Tag tone="teal">complete</Tag>) },
            { k: "poRef", label: "PO", render: (r) => r.poRef ?? "—" },
            { k: "grnRef", label: "GRN", render: (r) => r.grnRef ?? "not received" },
          ]}
          rows={rows}
          empty="Nothing outstanding."
        />
      </Panel>
    </DashboardShell>
  );
}
