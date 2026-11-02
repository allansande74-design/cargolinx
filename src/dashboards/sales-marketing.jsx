import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate, stageIndex } from "../lib/dashboards.mjs";

export default function SalesMarketingDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const quoted = orders.filter((o) => stageIndex(o.stage) < stageIndex("purchased"));
  const won = orders.filter((o) => stageIndex(o.stage) >= stageIndex("purchased"));
  const value = quoted.reduce((a, o) => a + orderTotal(o), 0);
  const conversion = orders.length ? Math.round((won.length / orders.length) * 100) : 0;

  return (
    <DashboardShell specKey="sales-marketing" data={data}>
      <Panel title="Pipeline" hint="Open quotes by age. Anything older than two weeks is losing to someone else's follow-up.">
        <DashTable
          columns={[
            { k: "id", label: "Quote" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "lines", label: "Lines", align: "right", render: (r) => (r.lines ?? []).length },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "createdAt", label: "Opened", render: (r) => shortDate(r.createdAt) },
            { k: "age", label: "Age", align: "right", render: (r) => `${Math.max(0, Math.floor(((d.now ?? new Date()).getTime() - new Date(r.createdAt ?? Date.now()).getTime()) / 86400000))} d` },
            { k: "stage", label: "Stage", render: (r) => <Tag tone={stageIndex(r.stage) >= stageIndex("confirmed") ? "gold" : "ink"}>{String(r.stage).replace(/_/g, " ")}</Tag> },
          ]}
          rows={quoted}
          empty="No quote open. A quiet pipeline is the first thing to fix."
        />
      </Panel>

      <Panel title="What converted" hint="A quotation becomes revenue only when the file is purchased.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "stage", label: "Stage", render: (r) => String(r.stage).replace(/_/g, " ") },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "createdAt", label: "Opened", render: (r) => shortDate(r.createdAt) },
          ]}
          rows={won}
          empty="Nothing converted yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Pipeline {money(value)} · conversion {conversion}% · {quoted.length} live quotes.</p>
    </DashboardShell>
  );
}
