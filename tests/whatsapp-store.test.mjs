import test from "node:test";
import assert from "node:assert/strict";

import {
  waNumber, waLink, catalogueLine, catalogueMessage, orderFromChat, deliveredMessage,
} from "../src/lib/whatsapp-store.mjs";

const pitch = "Solar lanterns, twenty in a carton, wired stock, ready today in Nairobi";
const film = { filmRef: "film.mp4", posterRef: "poster.jpg", transcript: pitch, countedUnits: 20 };
const solar = { name: "Solar lantern carton", product: { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 20 }, film, wholesaleKes: 175_000 };

test("a phone becomes the WhatsApp number the chat is addressed to", () => {
  assert.equal(waNumber("+254 712 345 678"), "254712345678");
  assert.equal(waNumber("0712 345 678"), "254712345678");
  assert.equal(waNumber("0044 7700 900123"), "447700900123");
  assert.ok(waLink("+254 712 345 678", "Hello Altovex").startsWith("https://wa.me/254712345678?text="));
});

test("the chat catalogue carries the landed-backed price and the film that sells it", () => {
  const line = catalogueLine(solar);
  assert.equal(line.filmReady, true);
  assert.equal(line.underWholesale, true);
  const noFilm = catalogueLine({ name: "x", product: solar.product, film: { filmRef: null, posterRef: null, transcript: "", countedUnits: 0 } });
  assert.equal(noFilm.filmReady, false);
  assert.ok(noFilm.filmBlockers.includes("poster_required"));
  const msg = catalogueMessage([{ name: "Solar lantern carton", priceKes: 156362.93 }, { name: "Cooler box", priceKes: 48000 }]);
  assert.match(msg, /Reply with a number to order/);
  assert.ok(msg.length <= 1024);
});

test("a chat reply becomes a real order in the lifecycle, confirmed and delivered by the engine", () => {
  const line = catalogueLine(solar);
  const { order, contact } = orderFromChat({ account: { id: "A1" }, line, qty: 2, phone: "0712 345 678" });
  assert.equal(order.stage, "confirmed");
  assert.equal(contact, "254712345678");
  const done = deliveredMessage(order, { signedBy: "Otieno", deliveredAt: "2026-11-02" });
  assert.equal(done.order.stage, "delivered");
  assert.match(done.text, /Order .+ delivered on 2026-11-02, signed by Otieno/);
});
