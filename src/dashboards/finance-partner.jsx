import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { money } from "../lib/dashboards.mjs";
import { ageing, creditExposure } from "../../engine/invoicing.mjs";

export default function FinancePartnerDashboard({ data }) {
  const d = data ?? {};
  const invoices = d.invoices ?? [];
  const accounts = d.accounts ?? [];
  const now = d.now ?? new Date();
  const age = ageing(invoices, now);

  const exposure = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    limit: Number(a.creditLimitKes ?? 0),
    owed: creditExposure(invoices, a.id),
  })).map((r) => ({ ...r, headroom: Math.max(0, r.limit - r.owed), state: r.limit && r.owed > r.limit ? "over limit" : r.limit && r.owed > r.limit * 0.8 ? "near limit" : "within limit" }));

  const worst = [...invoices].filter((i) => i.status !== "paid").sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt))).slice(0, 8);

  return (
    <DashboardShell specKey="finance-partner" data={data}>
      <Panel title="Book by age" hint="The portfolio a lender actually buys: days outstanding, not order value.">
        <DashTable
          columns={[
            { k: "bucket", label: "Bucket" },
            { k: "amount", label: "Balance", align: "right", render: (r) => money(r.amount) },
            { k: "share", label: "Share", align: "right", render: (r) => (age.outstanding ? `${Math.round((r.amount / age.outstanding) * 100)}%` : "—") },
          ]}
          rows={Object.entries(age.buckets).map(([bucket, amount]) => ({ id: bucket, bucket, amount }))}
          empty="Nothing outstanding."
        />
      </Panel>

      <Panel title="Exposure by account" hint="Owed against the limit on the account; headroom is what can still be financed.">
        <DashTable
          columns={[
            { k: "name", label: "Account" },
            { k: "limit", label: "Limit", align: "right", render: (r) => money(r.limit) },
            { k: "owed", label: "Owed", align: "right", render: (r) => money(r.owed) },
            { k: "headroom", label: "Headroom", align: "right", render: (r) => money(r.headroom) },
            { k: "state", label: "State", render: (r) => <Tag tone={r.state === "over limit" ? "red" : r.state === "near limit" ? "amber" : "teal"}>{r.state}</Tag> },
          ]}
          rows={exposure}
          empty="No accounts to assess."
        />
      </Panel>

      <Panel title="Oldest unpaid" hint="Where a collection call is most likely to recover cash this week.">
        <DashTable
          columns={[
            { k: "number", label: "Invoice" },
            { k: "accountId", label: "Account", render: (r) => accounts.find((a) => a.id === r.accountId)?.name ?? r.accountId },
            { k: "issuedAt", label: "Issued", render: (r) => String(r.issuedAt ?? "").slice(0, 10) },
            { k: "balance", label: "Balance", align: "right", render: (r) => money(r.balance ?? 0) },
          ]}
          rows={worst}
          empty="No unpaid invoice."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Total outstanding {money(age.outstanding)}; this view is read-only and holds no funds.</p>
    </DashboardShell>
  );
}
