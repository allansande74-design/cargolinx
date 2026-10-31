export const DASHBOARDS = [
  { key: "driver", title: "Driver Dashboard", role: "driver", file: "./driver.jsx" },
  { key: "user", title: "User Dashboard", role: "user", file: "./user.jsx" },
  { key: "clearing-agent", title: "Clearing Agent Dashboard", role: "clearing-agent", file: "./clearing-agent.jsx" },
  { key: "insurer", title: "Insurer Dashboard", role: "insurer", file: "./insurer.jsx" },
  { key: "finance-partner", title: "Finance Partner Dashboard", role: "finance-partner", file: "./finance-partner.jsx" },
  { key: "buyer", title: "Buyer Dashboard", role: "buyer", file: "./buyer.jsx" },
  { key: "seller", title: "Seller Dashboard", role: "seller", file: "./seller.jsx" },
  { key: "transporter", title: "Transporter Dashboard", role: "transporter", file: "./transporter.jsx" },
  { key: "admin", title: "Admin Dashboard", role: "admin", file: "./admin.jsx" },
  { key: "operations", title: "Operations Dashboard", role: "operations", file: "./operations.jsx" },
  { key: "crm", title: "CRM Dashboard", role: "crm", file: "./crm.jsx" },
  { key: "sales-marketing", title: "Sales & Marketing Dashboard", role: "sales-marketing", file: "./sales-marketing.jsx" },
  { key: "hr", title: "HR Dashboard", role: "hr", file: "./hr.jsx" },
  { key: "sourcing", title: "Sourcing Dashboard", role: "sourcing", file: "./sourcing.jsx" },
  { key: "procurement", title: "Procurement Dashboard", role: "procurement", file: "./procurement.jsx" },
  { key: "trade-finance-escrow", title: "Trade Finance & Escrow Dashboard", role: "trade-finance-escrow", file: "./trade-finance-escrow.jsx" },
  { key: "overview", title: "Overview Dashboard", role: "overview", file: "./overview.jsx" },
  { key: "match", title: "Match Dashboard", role: "operations", file: "./match.jsx" },
];

export function stubStatus() {
  return Object.fromEntries(DASHBOARDS.map((d) => [d.key, "stub"]));
}
