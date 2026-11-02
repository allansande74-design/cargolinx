import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate } from "../lib/dashboards.mjs";

export default function SourcingDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const suppliers = d.suppliers ?? [];
  const open = orders.filter((o) => ["draft", "confirmed", "sourcing"].includes(o.stage));

  return (
    <DashboardShell specKey="sourcing" data={data}>
      <Panel title="Files still being sourced" hint="A file stops being a quote when a supplier, a purchase order and a purchase value are on it.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Account", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "lines", label: "Lines", align: "right", render: (r) => (r.lines ?? []).length },
            { k: "supplier", label: "Supplier", render: (r) => r.supplier ?? <span style={{ color: C.amber }}>not chosen</span> },
            { k: "poRef", label: "PO", render: (r) => r.poRef ?? "—" },
            { k: "valueKes", label: "Sell value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "createdAt", label: "Opened", render: (r) => shortDate(r.createdAt) },
          ]}
          rows={open}
          empty="Nothing waiting on a supplier."
        />
      </Panel>

      <Panel title="Supplier book" hint="What each supplier has been asked for, and whether they are verified in the register.">
        <DashTable
          columns={[
            { k: "name", label: "Supplier" },
            { k: "country", label: "Country", render: (r) => r.country ?? "—" },
            { k: "contact", label: "Contact", render: (r) => r.contact ?? r.email ?? r.phone ?? "—" },
            { k: "leadTimeDays", label: "Lead time", align: "right", render: (r) => (r.leadTimeDays ? `${r.leadTimeDays} d` : "—") },
            { k: "verified", label: "Register", render: (r) => (r.verified === false ? <Tag tone="amber">unverified</Tag> : <Tag tone="teal">verified</Tag>) },
          ]}
          rows={suppliers}
          empty="No suppliers saved yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Landed cost is computed per file, from goods, freight, duty and quantity — never typed in by hand.</p>
    </DashboardShell>
  );
}
