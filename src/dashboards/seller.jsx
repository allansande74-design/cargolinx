import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, stageLabel, money, shortDate, stageIndex } from "../lib/dashboards.mjs";
import { ageing } from "../../engine/invoicing.mjs";

export default function SellerDashboard({ data }) {
  const d = data ?? {};
  const invoices = d.invoices ?? [];
  const orders = d.orders ?? [];
  const age = ageing(invoices.filter((i) => i.status !== "paid"), d.now ?? new Date());
  const quoted = orders.filter((o) => ["draft", "confirmed", "sourcing"].includes(o.stage));

  return (
    <DashboardShell specKey="seller" data={data}>
      <Panel title="Receivables by age" hint="The buckets a credit controller works, in shillings.">
        <DashTable
          columns={[
            { k: "bucket", label: "Bucket" },
            { k: "amount", label: "Balance", align: "right", render: (r) => money(r.amount) },
          ]}
          rows={Object.entries(age.buckets ?? {}).map(([bucket, amount]) => ({ id: bucket, bucket, amount }))}
          empty="No receivables."
        />
      </Panel>

      <Panel title="Unpaid invoices" hint="Oldest first; a settled invoice leaves this list.">
        <DashTable
          columns={[
            { k: "number", label: "Invoice" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "issuedAt", label: "Issued", render: (r) => shortDate(r.issuedAt) },
            { k: "total", label: "Total", align: "right", render: (r) => money(r.total) },
            { k: "balance", label: "Balance", align: "right", render: (r) => money(r.balance ?? 0) },
            { k: "status", label: "Status", render: (r) => <Tag tone={r.status === "part paid" ? "amber" : "red"}>{r.status}</Tag> },
          ]}
          rows={[...invoices].filter((i) => i.status !== "paid").sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)))}
          empty="Everything is settled."
        />
      </Panel>

      <Panel title="Quotes and unconfirmed work" hint="A quotation is not revenue: only a purchased file counts as converted.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "stage", label: "Stage", render: (r) => stageLabel(r.stage) },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "createdAt", label: "Opened", render: (r) => shortDate(r.createdAt) },
          ]}
          rows={quoted}
          empty="No quotes open."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>
        Converted value {money(orders.filter((o) => stageIndex(o.stage) >= stageIndex("purchased")).reduce((a, o) => a + orderTotal(o), 0))} · outstanding {money(age.outstanding ?? 0)}.
      </p>
    </DashboardShell>
  );
}
