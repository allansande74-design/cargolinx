import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate, stageIndex } from "../lib/dashboards.mjs";

export default function ProcurementDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const bought = orders.filter((o) => stageIndex(o.stage) >= stageIndex("purchased"));
  const committed = bought.reduce((a, o) => a + Number(o.purchaseValue ?? 0), 0);

  const bySupplier = Object.values(
    bought.reduce((acc, o) => {
      const k = o.supplier ?? "unassigned";
      acc[k] = acc[k] ?? { id: k, supplier: k, files: 0, committed: 0, open: 0 };
      acc[k].files += 1;
      acc[k].committed += Number(o.purchaseValue ?? 0);
      if (stageIndex(o.stage) < stageIndex("received")) acc[k].open += 1;
      return acc;
    }, {}),
  );

  return (
    <DashboardShell specKey="procurement" data={data}>
      <Panel title="Committed spend by supplier" hint="What has been bought, not what has been quoted.">
        <DashTable
          columns={[
            { k: "supplier", label: "Supplier" },
            { k: "files", label: "Files", align: "right" },
            { k: "open", label: "In delivery", align: "right" },
            { k: "committed", label: "Committed", align: "right", render: (r) => money(r.committed) },
          ]}
          rows={bySupplier}
          empty="No purchase committed yet."
        />
      </Panel>

      <Panel title="Purchase orders on file" hint="A PO is only real when the supplier, the PO reference and the value are all on the file.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "poRef", label: "PO", render: (r) => r.poRef ?? "—" },
            { k: "supplier", label: "Supplier", render: (r) => r.supplier ?? "—" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "purchaseValue", label: "Cost", align: "right", render: (r) => money(r.purchaseValue) },
            { k: "valueKes", label: "Sell", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "margin", label: "Margin", align: "right", render: (r) => { const c = Number(r.purchaseValue ?? 0); const s = orderTotal(r); return c && s ? `${Math.round(((s - c) / s) * 100)}%` : "—"; } },
            { k: "stage", label: "Stage", render: (r) => <Tag>{String(r.stage).replace(/_/g, " ")}</Tag> },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={bought}
          empty="No purchase orders yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Committed across all suppliers {money(committed)}. A file below 15% margin is flagged for review before it is confirmed.</p>
    </DashboardShell>
  );
}
