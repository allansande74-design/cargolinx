/**
 * Ask Amanda — the site widget for the static pages.
 *
 * The desk is a React app with its own panel; this file gives the plain HTML pages (the hackathon
 * page, the demo page) the same assistant without dragging the bundle in. It posts to the same
 * endpoint, keeps the last eight turns, and says plainly when the desk cannot be reached.
 *
 * Loaded with:  <script src="/amanda-widget.js" defer></script>
 */
(function () {
  if (window.__amandaWidget) return;
  window.__amandaWidget = true;

  var NAVY = "#0a1f3c", GOLD = "#c9a227", GOLD_LIGHT = "#f5e7bd";
  var history = [];
  var busy = false;
  var open = false;

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) Object.keys(style).forEach(function (k) { n.style[k] = style[k]; });
    if (text != null) n.textContent = text;
    return n;
  }

  var launcher = el("button", {
    position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483000,
    display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
    minHeight: "48px", borderRadius: "999px", border: "2px solid " + GOLD,
    background: NAVY, color: "#fff", cursor: "pointer",
    boxShadow: "0 6px 24px rgba(10,31,60,.28)", font: "600 14px system-ui, sans-serif"
  });
  launcher.setAttribute("aria-label", "Ask Amanda");
  launcher.appendChild(el("span", { fontWeight: "700" }, "Ask Amanda"));
  launcher.appendChild(el("span", {
    fontSize: "11px", color: GOLD_LIGHT, borderLeft: "1px solid " + GOLD, paddingLeft: "10px"
  }, "Powered by Meta"));

  var panel = el("section", {
    position: "fixed", right: "12px", bottom: "12px", zIndex: 2147483000,
    width: "min(400px, calc(100vw - 24px))", maxHeight: "min(620px, calc(100vh - 24px))",
    display: "none", flexDirection: "column", background: "#fff", borderRadius: "14px",
    border: "2px solid " + GOLD, boxShadow: "0 18px 48px rgba(10,31,60,.34)", overflow: "hidden",
    font: "14px system-ui, sans-serif"
  });
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Ask Amanda");

  var head = el("header", {
    background: NAVY, color: "#fff", padding: "12px 14px", display: "flex",
    alignItems: "center", justifyContent: "space-between", gap: "8px"
  });
  var titles = el("div");
  titles.appendChild(el("div", { fontWeight: "700" }, "Ask Amanda"));
  titles.appendChild(el("div", { fontSize: "11px", color: GOLD_LIGHT }, "Powered by Meta · Altovex Global Logistics"));
  var closeBtn = el("button", {
    background: "transparent", color: "#fff", border: "1px solid " + GOLD,
    borderRadius: "8px", minWidth: "36px", minHeight: "36px", cursor: "pointer"
  }, "✕");
  closeBtn.setAttribute("aria-label", "Close Ask Amanda");
  head.appendChild(titles);
  head.appendChild(closeBtn);

  var body = el("div", { padding: "12px", overflowY: "auto", flex: "1", background: "#f7f9fc", minHeight: "180px" });
  var intro = el("p", { fontSize: "13px", color: "#33465e", margin: "0 0 8px" },
    "Sourcing, ocean freight, clearing, warehousing and last mile — DDP. Ask about a lane, a price, a document or a load.");
  body.appendChild(intro);

  var form = el("form", { display: "flex", gap: "8px", padding: "10px", borderTop: "1px solid #dbe4ef" });
  var input = el("input", {
    flex: "1", minWidth: "0", padding: "10px 12px", borderRadius: "8px",
    border: "1px solid #c3cfdd", fontSize: "14px"
  });
  input.setAttribute("aria-label", "Your question for Amanda");
  input.placeholder = "Ask about a shipment, a price, a document…";
  var send = el("button", {
    padding: "10px 16px", minHeight: "44px", borderRadius: "8px", border: "none",
    background: GOLD, color: NAVY, fontWeight: "700", cursor: "pointer"
  }, "Send");
  form.appendChild(input);
  form.appendChild(send);

  var foot = el("div", { fontSize: "10.5px", color: "#6b7c91", padding: "0 12px 10px" },
    "Indicative answers. Prices and bookings are confirmed by the desk in writing.");

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(form);
  panel.appendChild(foot);
  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  function bubble(role, text) {
    var row = el("div", { display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start", margin: "8px 0" });
    var b = el("div", {
      maxWidth: "86%", padding: "9px 11px", borderRadius: "10px", fontSize: "13.5px",
      lineHeight: "1.45", whiteSpace: "pre-wrap",
      background: role === "user" ? NAVY : "#fff", color: role === "user" ? "#fff" : NAVY,
      border: role === "user" ? "none" : "1px solid #dbe4ef"
    }, text);
    row.appendChild(b);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  function ask(question) {
    if (!question || busy) return;
    busy = true;
    send.disabled = true;
    send.textContent = "…";
    bubble("user", question);
    history.push({ role: "user", content: question });
    var thinking = el("div", { fontSize: "12.5px", color: "#5a6b80", padding: "4px 2px" }, "Amanda is checking the desk…");
    body.appendChild(thinking);
    body.scrollTop = body.scrollHeight;

    fetch("/api/amanda/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-8), context: { page: location.pathname } })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (out) {
        var reply = out.ok ? out.d.reply : (out.d && out.d.error) || "The desk could not answer just now.";
        history.push({ role: "assistant", content: reply });
        thinking.remove();
        bubble("assistant", reply);
      })
      .catch(function () {
        thinking.remove();
        bubble("assistant", "I could not reach the desk just now. The desk is on +254 718 554 383 and altovexgl@gmail.com.");
      })
      .then(function () {
        busy = false;
        send.disabled = false;
        send.textContent = "Send";
      });
  }

  launcher.addEventListener("click", function () {
    open = true;
    launcher.style.display = "none";
    panel.style.display = "flex";
    input.focus();
  });
  closeBtn.addEventListener("click", function () {
    open = false;
    panel.style.display = "none";
    launcher.style.display = "flex";
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = "";
    ask(q);
  });

  window.amandaAsk = ask;
})();
