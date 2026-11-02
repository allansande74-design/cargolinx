/**
 * One read for every dashboard: the same book, scoped once, with the basis it was read on.
 * Screens lay out numbers; they never compute them.
 */
import { useCallback, useEffect, useState } from "react";
import { all, kvGet, STORES } from "../lib/db.js";
import { scopeOrders, scopeInvoices } from "../lib/dashboards.mjs";

export const C = {
  navy: "#071a33",
  gold: "#d8a13a",
  teal: "#159a8c",
  ink: "#0d1b2a",
  soft: "#6b7c93",
  line: "#dfe5ee",
  bg: "#f4f6fa",
  red: "#b42318",
  amber: "#b54708",
  green: "#1a7f5a",
};

const byNewest = (a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""));

async function safeAll(store) {
  try {
    return (await all(store)) ?? [];
  } catch {
    return [];
  }
}

async function safeKv(key, dflt) {
  try {
    return (await kvGet(key, dflt)) ?? dflt;
  } catch {
    return dflt;
  }
}

export function useDashBook() {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const [orders, invoices, lots, shipments, partners, accounts, session, suppliers] = await Promise.all([
      safeAll(STORES.orders),
      safeAll(STORES.invoices),
      safeAll(STORES.lots),
      safeAll(STORES.shipments),
      safeKv("networkPartners", []),
      safeKv("accounts", []),
      safeKv("session", null),
      safeKv("suppliersAll", []),
    ]);
    const sorted = [...orders].sort(byNewest);
    const orderScope = scopeOrders(sorted, session);
    const invoiceScope = scopeInvoices(invoices, session);
    setData({
      user: session,
      orders: orderScope.orders,
      orderBasis: orderScope.basis,
      orderNote: orderScope.note,
      allOrders: sorted,
      invoices: invoiceScope.invoices,
      invoiceBasis: invoiceScope.basis,
      lots,
      shipments: [...shipments].sort(byNewest),
      partners,
      accounts,
      suppliers,
      now: new Date(),
      loadedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, reload: load };
}

export function Panel({ title, hint, action, children }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15, color: C.ink }}>{title}</h2>
        {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
      </div>
      {hint ? <p style={{ margin: "6px 0 12px", fontSize: 12.5, color: C.soft }}>{hint}</p> : <div style={{ height: 10 }} />}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return (
    <div style={{ border: `1px dashed ${C.line}`, borderRadius: 10, padding: 16, color: C.soft, fontSize: 13 }}>
      {children}
    </div>
  );
}

export function Tag({ tone = "ink", children }) {
  const map = { ink: [C.ink, "#eef2f7"], teal: [C.green, "#e6f5f1"], gold: ["#7a5410", "#fdf3dd"], red: [C.red, "#fdeceb"], amber: [C.amber, "#fdf0e3"] };
  const [fg, bg] = map[tone] ?? map.ink;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: fg, background: bg }}>
      {children}
    </span>
  );
}

export function DashTable({ columns, rows, empty = "Nothing in this view yet." }) {
  if (!rows || rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.k} style={{ textAlign: c.align ?? "left", padding: "8px 10px", borderBottom: `1px solid ${C.line}`, color: C.soft, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? r.key ?? i} style={{ borderBottom: `1px solid ${C.line}` }}>
              {columns.map((c) => (
                <td key={c.k} style={{ padding: "9px 10px", textAlign: c.align ?? "left", color: C.ink, verticalAlign: "top" }}>
                  {c.render ? c.render(r) : r[c.k] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function accountName(accounts = [], id) {
  return (accounts ?? []).find((a) => a.id === id)?.name ?? id ?? "—";
}

export function Bar({ value = 0, max = 100, label }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 8, background: "#eef2f7", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: C.teal }} />
      </div>
      {label ? <div style={{ fontSize: 11.5, color: C.soft, marginTop: 3 }}>{label}</div> : null}
    </div>
  );
}
