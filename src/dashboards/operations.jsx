import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, blockers, stageLabel, stageIndex, money, shortDate, atRisk } from "../lib/dashboards.mjs";

export default function OperationsDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const live = orders.filter((o) => !["delivered", "cancelled"].includes(o.stage));
  const risk = atRisk(orders, d.now ?? new Date());

  const rows = live.map((o) => {
    const b = blockers(o);
    return { ...o, next: b.target ? stageLabel(b.target) : "closed", missing: b.missing };
  });

  return (
    <DashboardShell specKey="operations" data={data}>
      <Panel title="Live files and the next step" hint="A stage cannot be entered without the data that makes it true — the missing fields are named.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "stage", label: "Now", render: (r) => <Tag>{stageLabel(r.stage)}</Tag> },
            { k: "next", label: "Next" },
            { k: "missing", label: "Missing", render: (r) => (r.missing.length ? <span style={{ color: C.red }}>{r.missing.join(", ")}</span> : <Tag tone="teal">ready</Tag>) },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={rows}
          empty="No live files. Confirmed orders appear here as soon as they are opened."
        />
      </Panel>

      <Panel title="Against the promise" hint="Late and at-risk files, measured against the promised date on the file.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "stage", label: "Stage", render: (r) => stageLabel(r.stage) },
            { k: "sla", label: "Promise", render: (r) => <Tag tone={r.sla.status === "late" ? "red" : "amber"}>{r.sla.status}</Tag> },
            { k: "hours", label: "Hours", align: "right", render: (r) => (r.sla.lateByHours != null ? `-${r.sla.lateByHours}` : r.sla.hoursToPromise ?? "—") },
            { k: "destination", label: "Consignee", render: (r) => r.destination?.city ?? r.destination?.name ?? "—" },
          ]}
          rows={risk.map((r) => ({ ...r.order, sla: r.sla }))}
          empty="Nothing late or at risk today."
        />
      </Panel>

      <Panel title="Warehouse" hint="Receipts are counted, not assumed: over, short and damaged are stated on the goods received note.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "grnRef", label: "GRN", render: (r) => r.grnRef ?? "not received" },
            { k: "receivedQty", label: "Received", align: "right", render: (r) => r.receivedQty ?? "—" },
            { k: "receiptVariance", label: "Variance", align: "right", render: (r) => (r.receiptVariance == null ? "—" : r.receiptVariance) },
            { k: "receiptStatus", label: "Check", render: (r) => (r.receiptStatus ? <Tag tone={r.receiptStatus === "clean" ? "teal" : "red"}>{r.receiptStatus}</Tag> : "—") },
          ]}
          rows={orders.filter((o) => stageIndex(o.stage) >= stageIndex("arrived") && !o.pod).slice(0, 8)}
          empty="Nothing waiting in the warehouse."
        />
      </Panel>
    </DashboardShell>
  );
}
