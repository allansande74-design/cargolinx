import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { money, shortDate, trucks } from "../lib/dashboards.mjs";

export default function AdminDashboard({ data }) {
  const d = data ?? {};
  const accounts = d.accounts ?? [];
  const fleet = trucks(d.partners ?? []);
  const users = accounts.flatMap((a) => (a.users ?? []).map((u) => ({ ...u, account: a.name })));

  return (
    <DashboardShell specKey="admin" data={data}>
      <Panel title="Accounts" hint="Terms and credit are set per account; nothing is shared between them.">
        <DashTable
          columns={[
            { k: "name", label: "Account" },
            { k: "country", label: "Country" },
            { k: "terms", label: "Terms" },
            { k: "creditLimitKes", label: "Credit limit", align: "right", render: (r) => money(r.creditLimitKes) },
            { k: "users", label: "Users", align: "right", render: (r) => (r.users ?? []).length },
            { k: "status", label: "Status", render: (r) => <Tag tone={r.status === "active" ? "teal" : "amber"}>{r.status ?? "active"}</Tag> },
          ]}
          rows={accounts}
          empty="No trading accounts yet."
        />
      </Panel>

      <Panel title="Users" hint="A signed-in user only ever reads their own account's book.">
        <DashTable
          columns={[
            { k: "name", label: "Name" },
            { k: "email", label: "Email" },
            { k: "account", label: "Account" },
            { k: "role", label: "Role" },
            { k: "status", label: "Status", render: (r) => <Tag tone={r.status === "invited" ? "gold" : "teal"}>{r.status ?? "invited"}</Tag> },
          ]}
          rows={users}
          empty="No users invited yet."
        />
      </Panel>

      <Panel title="Partner register" hint="An owner is born pending; approval names the checker and the reference document.">
        <DashTable
          columns={[
            { k: "ownerName", label: "Owner" },
            { k: "id", label: "Register id" },
            { k: "status", label: "Status", render: (r) => <Tag tone={r.status === "approved" ? "teal" : "amber"}>{r.status ?? "pending"}</Tag> },
            { k: "fleet", label: "Trucks", align: "right", render: (r) => (r.fleet ?? []).length },
            { k: "approvedBy", label: "Approved by", render: (r) => r.approvedBy ?? "—" },
          ]}
          rows={d.partners ?? []}
          empty="No partner records yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>Plates on the register: {fleet.length}. Approval is a named act; this screen shows it and does not perform it.</p>
    </DashboardShell>
  );
}
