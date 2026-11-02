import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { orderTotal, money, shortDate } from "../lib/dashboards.mjs";

export default function CrmDashboard({ data }) {
  const d = data ?? {};
  const accounts = d.accounts ?? [];
  const orders = d.orders ?? [];
  const now = d.now ?? new Date();

  const rows = accounts.map((a) => {
    const mine = orders.filter((o) => o.accountId === a.id);
    const last = mine.map((o) => o.updatedAt ?? o.createdAt).filter(Boolean).sort().pop();
    const days = last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86400000) : null;
    return {
      id: a.id,
      name: a.name,
      country: a.country ?? "—",
      files: mine.length,
      value: mine.reduce((s, o) => s + orderTotal(o), 0),
      last,
      days,
      state: days == null ? "never traded" : days > 45 ? "gone quiet" : days > 21 ? "cooling" : "active",
    };
  }).sort((x, y) => (y.value ?? 0) - (x.value ?? 0));

  return (
    <DashboardShell specKey="crm" data={data}>
      <Panel title="Who is trading and who has gone quiet" hint="Measured from the last activity on their files, not from a note in a diary.">
        <DashTable
          columns={[
            { k: "name", label: "Account" },
            { k: "country", label: "Country" },
            { k: "files", label: "Files", align: "right" },
            { k: "value", label: "Lifetime value", align: "right", render: (r) => money(r.value) },
            { k: "last", label: "Last activity", render: (r) => (r.last ? shortDate(r.last) : "—") },
            { k: "days", label: "Days", align: "right", render: (r) => (r.days == null ? "—" : r.days) },
            { k: "state", label: "State", render: (r) => <Tag tone={r.state === "active" ? "teal" : r.state === "cooling" ? "gold" : "amber"}>{r.state}</Tag> },
          ]}
          rows={rows}
          empty="No accounts on the book yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>A follow-up is worth more on an account that has bought before. Quiet for 45 days is the call list.</p>
    </DashboardShell>
  );
}
