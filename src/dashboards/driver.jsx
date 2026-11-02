import { useState } from "react";
import DashboardShell from "./_layout.jsx";
import { Panel, DashTable, Tag, C } from "./_data.jsx";
import { orderTotal, stageLabel, money, shortDate } from "../lib/dashboards.mjs";
import { completeDelivery } from "../lib/truck-matching.mjs";
import { saveOrder } from "../lib/db.js";

export default function DriverDashboard({ data, reload }) {
  const d = data ?? {};
  const orders = d.orders ?? [];
  const road = orders.filter((o) => o.stage === "dispatched");
  const [pick, setPick] = useState(null);
  const [signer, setSigner] = useState("");
  const [msg, setMsg] = useState("");

  async function recordPod(order) {
    setMsg("");
    const res = completeDelivery({ order, signedBy: signer.trim() });
    if (!res.ok) {
      setMsg(res.refusals?.[0]?.message ?? "proof of delivery was refused");
      return;
    }
    await saveOrder(res.order);
    setMsg(`POD recorded for ${order.id} — signed by ${signer.trim()}.`);
    setSigner("");
    setPick(null);
    if (reload) await reload();
  }

  return (
    <DashboardShell specKey="driver" data={data}>
      <Panel title="Your runs" hint="Only a dispatched load can be delivered, and only on a named proof of delivery.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "destination", label: "Consignee", render: (r) => r.destination?.city ?? r.destination?.name ?? "—" },
            { k: "stage", label: "Stage", render: (r) => <Tag tone={r.stage === "dispatched" ? "gold" : "teal"}>{stageLabel(r.stage)}</Tag> },
            { k: "trackingRef", label: "Tracking", render: (r) => r.trackingRef ?? "—" },
            { k: "valueKes", label: "Value", align: "right", render: (r) => money(orderTotal(r)) },
            { k: "promisedAt", label: "Promise", render: (r) => shortDate(r.promisedAt) },
            {
              k: "act",
              label: "",
              render: (r) =>
                r.stage === "dispatched" ? (
                  <button onClick={() => { setPick(r.id); setMsg(""); }} style={{ font: "inherit", fontSize: 12.5, fontWeight: 700, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", color: C.teal, cursor: "pointer" }}>
                    Proof of delivery
                  </button>
                ) : null,
            },
          ]}
          rows={road}
          empty="No load is dispatched to this session."
        />
      </Panel>

      {pick ? (
        <Panel title={`Proof of delivery · ${pick}`} hint="The file cannot close on a status alone: name who signed for the goods.">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Signed by (full name)" style={{ flex: "1 1 220px", padding: "10px 12px", border: `1px solid ${C.line}`, borderRadius: 9, font: "inherit" }} />
            <button onClick={() => recordPod(orders.find((o) => o.id === pick))} style={{ font: "inherit", fontWeight: 700, padding: "10px 16px", borderRadius: 9, border: "none", background: C.teal, color: "#fff", cursor: "pointer" }}>
              Record delivery
            </button>
            <button onClick={() => { setPick(null); setSigner(""); }} style={{ font: "inherit", padding: "10px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
          {msg ? <p style={{ fontSize: 12.5, color: msg.startsWith("POD") ? C.green : C.red, marginTop: 8 }}>{msg}</p> : null}
        </Panel>
      ) : null}

      <Panel title="Delivered" hint="Closed runs carry the signatory and the time.">
        <DashTable
          columns={[
            { k: "id", label: "Order" },
            { k: "signedBy", label: "Signed by", render: (r) => r.pod?.signedBy ?? "—" },
            { k: "deliveredAt", label: "Delivered", render: (r) => shortDate(r.pod?.at ?? r.updatedAt) },
          ]}
          rows={orders.filter((o) => o.stage === "delivered")}
          empty="No delivered runs yet."
        />
      </Panel>

      {msg && !pick ? <p style={{ fontSize: 12.5, color: C.green }}>{msg}</p> : null}
    </DashboardShell>
  );
}
