import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, accountName, C } from "./_data.jsx";
import { orderTotal, money, shortDate, stageIndex, stageLabel } from "../lib/dashboards.mjs";

export default function TradeFinanceEscrowDashboard({ data }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const invoices = d.invoices ?? [];
  const milestones = orders
    .filter((o) => stageIndex(o.stage) >= stageIndex("confirmed"))
    .map((o) => {
      const proforma = invoices.find((i) => i.orderId === o.id && i.kind === "proforma");
      const paid = Number(proforma?.paid ?? 0);
      const held = proforma ? Math.max(0, Number(proforma.total ?? 0) - paid) : 0;
      return {
        ...o,
        instrument: proforma ? proforma.number : "no instrument",
        held,
        released: paid,
        state: held > 0 ? (stageIndex(o.stage) >= stageIndex("delivered") ? "release pending evidence" : "funds held") : proforma ? "released" : "unfunded",
      };
    });

  return (
    <DashboardShell specKey="trade-finance-escrow" data={data}>
      <Panel title="Deals under instrument" hint="Each file against the document that funds it, and what is still held.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "accountId", label: "Counterparty", render: (r) => accountName(d.accounts, r.accountId) },
            { k: "instrument", label: "Instrument" },
            { k: "valueKes", label: "Deal value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "held", label: "Held", align: "right", render: (r) => money(r.held) },
            { k: "released", label: "Released", align: "right", render: (r) => money(r.released) },
            { k: "state", label: "State", render: (r) => <Tag tone={r.state === "funds held" ? "amber" : r.state === "released" ? "teal" : r.state === "unfunded" ? "red" : "gold"}>{r.state}</Tag> },
          ]}
          rows={milestones}
          empty="No deal under instrument."
        />
      </Panel>

      <Panel title="Release queue" hint="Released only on evidence: a delivery is not a release, a signed POD plus the invoice is.">
        <DashTable
          columns={[
            { k: "id", label: "File" },
            { k: "stage", label: "Stage", render: (r) => stageLabel(r.stage) },
            { k: "pod", label: "POD", render: (r) => r.pod?.signedBy ?? "not issued" },
            { k: "held", label: "Awaiting release", align: "right", render: (r) => money(r.held) },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
          ]}
          rows={milestones.filter((m) => m.held > 0)}
          empty="Nothing waiting on evidence."
        />
      </Panel>

      <p style={{ fontSize: 12, color: C.soft }}>
        Held across all deals {money(milestones.reduce((a, m) => a + m.held, 0))}. This screen records state; it cannot move money.
      </p>
    </DashboardShell>
  );
}
