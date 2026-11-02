import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { orderTotal, stageLabel, money, shortDate, atRisk } from "../lib/dashboards.mjs";

export default function ClientWorkspace({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const invoices = d.invoices ?? [];
  const open = invoices.filter((i) => i.status !== "paid");
  const risk = atRisk(orders, d.now ?? new Date()).map((r) => r.order.id);
  const documents = orders.filter((o) => o.grnRef || o.trackingRef || o.pod);

  return (
    <DashboardShell specKey="user" data={data}>
      <Panel title="Your orders" hint={d.orderNote ?? "Scoped to your account."}>
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "stage", label: "Stage", render: (r) => <Tag tone={r.stage === "delivered" ? "teal" : risk.includes(r.id) ? "red" : "ink"}>{stageLabel(r.stage)}</Tag> },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Promised", render: (r) => shortDate(r.promisedAt) },
            { k: "trackingRef", label: "Tracking", render: (r) => r.trackingRef ?? "—" },
          ]}
          rows={orders}
          empty="No orders on this account yet. Start one from the desk and it appears here."
        />
      </Panel>

      <Panel title="Your invoices" hint="Balance is what is still owed after payments recorded on the file.">
        <DashTable
          columns={[
            { k: "number", label: "Invoice" },
            { k: "kind", label: "Type", render: (r) => r.kind ?? "invoice" },
            { k: "issuedAt", label: "Issued", render: (r) => shortDate(r.issuedAt) },
            { k: "total", label: "Total", align: "right", render: (r) => money(r.total) },
            { k: "balance", label: "Balance", align: "right", render: (r) => money(r.balance ?? Number(r.total) - Number(r.paid ?? 0)) },
            { k: "status", label: "Status", render: (r) => <Tag tone={r.status === "paid" ? "teal" : "amber"}>{r.status}</Tag> },
          ]}
          rows={invoices}
          empty="No invoices issued to this account yet."
        />
      </Panel>

      <Panel title="Documents on file" hint="Goods received notes, tracking references and proofs of delivery.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "grnRef", label: "GRN", render: (r) => r.grnRef ?? "—" },
            { k: "trackingRef", label: "Tracking", render: (r) => r.trackingRef ?? "—" },
            { k: "pod", label: "Signed by", render: (r) => r.pod?.signedBy ?? "—" },
          ]}
          rows={documents}
          empty="No documents issued yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Outstanding: {money(open.reduce((a, i) => a + Number(i.balance ?? 0), 0))}. Payments are recorded against the invoice; overpayment is refused.</p>
    </DashboardShell>
  );
}
