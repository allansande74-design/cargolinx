// Render the demo packing list and delivery note with the product's own document builders.
import { writeFileSync } from "node:fs";
import { deliveryNoteHtml, packingListHtml } from "../src/lib/doc-templates.mjs";

const today = new Date("2026-11-02T06:30:00Z");
const account = { name: "Kampala Power & Cable Ltd", taxPin: "P051234567X", terms: "30 days from delivery" };
const order = {
  id: "CLX-261031-714",
  origin: "Mombasa",
  destination: "Kampala",
  incoterm: "DAP",
  vehicleId: "KDH 417X",
  driverName: "P. Otieno",
  lines: [{ description: "Electrical cable, 4-core 25 mm sq — 1,000 m drum", qty: 20 }],
};
const items = [
  { description: "Electrical cable, 4-core 25 mm sq — 1,000 m drum", bin: "A-12", lot: "LOT-2610-A", qty: 20 },
];

const note = deliveryNoteHtml({ order, account, noteNumber: "DN-261031-714", today, items });
const pack = packingListHtml({ order, account, listNumber: "PL-261031-714", today, lots: items });

writeFileSync(new URL("../../out/demo/delivery-note.html", import.meta.url), note);
writeFileSync(new URL("../../out/demo/packing-list.html", import.meta.url), pack);
console.log(JSON.stringify({ deliveryNote: note.length, packingList: pack.length }));
