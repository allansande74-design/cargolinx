import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, stageLabel, money, shortDate, atRisk, stageIndex } from "../lib/dashboards.mjs";

export default function BuyerDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const invoices = d.invoices ?? [];
  const balanceFor = (orderId) => invoices.filter((i) => i.orderId === orderId && i.status !== "paid").reduce((a, i) => a + Number(i.balance ?? 0), 0);
  const risk = atRisk(orders, d.now ?? new Date());
  const riskIds = new Set(risk.map((r) => r.order.id));
  const live = orders.filter((o) => !["delivered", "cancelled"].includes(o.stage));

  return (
    <DashboardShell specKey="buyer" data={data}>
      <Panel title="In flight" hint="Orders not yet delivered, with what each still owes.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "accountId", label: "Buyer", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "stage", label: "Stage", render: (r) => <Tag tone={riskIds.has(r.id) ? "red" : "ink"}>{stageLabel(r.stage)}</Tag> },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "balance", label: "Owed", align: "right", render: (r) => money(balanceFor(r.id)) },
            { k: "promisedAt", label: "Promised", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={live}
          empty="Nothing in flight."
        />
      </Panel>

      <Panel title="Delivered" hint="Closed files with the proof of delivery that closed them.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "signedBy", label: "Signed by", render: (r) => r.pod?.signedBy ?? "—" },
            { k: "deliveredAt", label: "Delivered", render: (r) => shortDate(r.pod?.at ?? r.updatedAt) },
          ]}
          rows={orders.filter((o) => o.stage === "delivered")}
          empty="No delivered orders yet."
        />
      </Panel>

      <Panel title="Late or at risk" hint="Measured against the promise on each file, not a guess.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "sla", label: "Promise", render: (r) => <Tag tone={r.sla.status === "late" ? "red" : "amber"}>{r.sla.status}</Tag> },
            { k: "stage", label: "Stage", render: (r) => stageLabel(r.stage) },
            { k: "hours", label: "Hours", align: "right", render: (r) => (r.sla.lateByHours != null ? `-${r.sla.lateByHours}` : r.sla.hoursToPromise ?? "—") },
          ]}
          rows={risk.map((r) => ({ ...r.order, sla: r.sla }))}
          empty="Every file is inside its promise."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>
        Open value {money(orders.filter((o) => stageIndex(o.stage) < stageIndex("delivered")).reduce((a, o) => a + orderTotal(o), 0))} across {orders.length} files.
      </p>
    </DashboardShell>
  );
}
