import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { shortDate, trucks } from "../lib/dashboards.mjs";

export default function HrDashboard({ data }) {
  const d = data ?? {};
  const accounts = d.accounts ?? [];
  const orders = d.orders ?? [];
  const people = accounts.flatMap((a) => (a.users ?? []).map((u) => ({ ...u, account: a.name })));
  const byRole = Object.values(
    people.reduce((acc, p) => {
      const k = p.role ?? "unassigned";
      acc[k] = acc[k] ?? { id: k, role: k, n: 0, invited: 0 };
      acc[k].n += 1;
      if (p.status === "invited") acc[k].invited += 1;
      return acc;
    }, {}),
  );
  const drivers = Object.values(
    orders.reduce((acc, o) => {
      if (!o.driverName) return acc;
      acc[o.driverName] = acc[o.driverName] ?? { id: o.driverName, driver: o.driverName, phone: o.driverPhone ?? "—", runs: 0, open: 0 };
      acc[o.driverName].runs += 1;
      if (o.stage !== "delivered") acc[o.driverName].open += 1;
      return acc;
    }, {}),
  );

  return (
    <DashboardShell specKey="hr" data={data}>
      <Panel title="People by role" hint="Invitations that were never accepted are the cheapest gap to close.">
        <DashTable
          columns={[
            { k: "role", label: "Role" },
            { k: "n", label: "People", align: "right" },
            { k: "invited", label: "Still invited", align: "right", render: (r) => (r.invited ? <Tag tone="amber">{r.invited}</Tag> : "0") },
          ]}
          rows={byRole}
          empty="No people on the platform yet."
        />
      </Panel>

      <Panel title="Drivers and their runs" hint="A driver is a named person on the file, not a phone number in a message.">
        <DashTable
          columns={[
            { k: "driver", label: "Driver" },
            { k: "phone", label: "Phone" },
            { k: "runs", label: "Runs", align: "right" },
            { k: "open", label: "Open", align: "right", render: (r) => (r.open ? <Tag tone="gold">{r.open}</Tag> : "0") },
          ]}
          rows={drivers}
          empty="No driver is assigned to a file yet."
        />
      </Panel>

      <Panel title="Users" hint="Account, role and whether the invitation has been taken up.">
        <DashTable
          columns={[
            { k: "name", label: "Name" },
            { k: "email", label: "Email" },
            { k: "account", label: "Account" },
            { k: "role", label: "Role" },
            { k: "status", label: "Status", render: (r) => <Tag tone={r.status === "invited" ? "gold" : "teal"}>{r.status ?? "invited"}</Tag> },
          ]}
          rows={people}
          empty="No users yet."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>{people.length} people · {trucks(d.partners ?? []).length} plates on the register.</p>
    </DashboardShell>
  );
}
