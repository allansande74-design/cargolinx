import React from "react";

const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const ICONS = {
  calc: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 12h2m4 0h2M8 16h2m4 0h2" /></>,
  pin: <><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  shield: <><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>,
  box: <><path d="M3 8l9-5 9 5v8l-9 5-9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6 12h.01M18 12h.01" /></>,
  cloud: <><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17.3 9.2 3.9 3.9 0 0 1 17 18H7Z" /><path d="M12 12v6m0 0-2.2-2.2M12 18l2.2-2.2" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M17.5 20a5.6 5.6 0 0 0-2-4.3" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" /><path d="M8.5 11h7M8.5 14.5h4" /></>,
  file: <><path d="M14 3v5h5" /><path d="M19 8.5V21H5V3h9l5 5.5Z" /><path d="M8.5 13h7M8.5 16.5h4.5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3.5 9h17M3.5 15h17" /><path d="M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9Z" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 3v2m4-2v2m-4 14v2m4-2v2M3 10h2m-2 4h2m14-4h2m-2 4h2" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  arrow: <><path d="M5 12h14m0 0-6-6m6 6-6 6" /></>,
};

const STORY = [
  {
    pain: "The quote lands two days late, and nobody can defend the number when the buyer asks how it was built.",
    fix: "The ladder prints every line with its base and its rate — CIF, duty band, IDF, RDL, VAT, clearing, transport, last mile — and each rate carries the date it was last checked.",
    proof: "20-unit run: CIF 1,457,250 · duty 364,312.50 · IDF 36,431.25 · RDL 29,145 · VAT 301,942.20 · landed 2,306,080.95.",
  },
  {
    pain: "The margin quietly disappears between the CIF invoice and the clearing bill, and the trader only finds out after delivery.",
    fix: "The desk refuses to issue a quote below its own floor, and states the cheapest price it can still defend instead of letting the number slide.",
    proof: "Same run: the desk declines a 2.2M request and shows the arithmetic behind the lowest price it can defend — not a number typed under pressure.",
  },
  {
    pain: "The ETA is a figure someone typed into WhatsApp, and when it moves nobody can say why.",
    fix: "Every ETA carries its segments, dwell, customs time, buffer and a confidence figure, and each change is kept with its cause — an earlier ETA is never overwritten in silence.",
    proof: "An ETA change made with the network off survives a page reload and reaches the server on reconnect with its reason attached.",
  },
  {
    pain: "The signal dies at the border, so the signature, the gate pass and the delivery note wait in a notebook until Nairobi is back online.",
    fix: "Writes are stored on the device and queued with an idempotency key, then drained on reconnect without creating a second row.",
    proof: "Reconnect run: pushed 1, pulled 1, outbox 0, one server row, no duplicate, local record intact.",
  },
  {
    pain: "The photo of the load, the driver's voice note and the clerk's shorthand all arrive in different places, and someone retypes them at 11pm.",
    fix: "The desk reads all three into one shipment record — photograph, voice note, or typed note — and shows which upstream model served the reading.",
    proof: "A delivery note photograph filled all ten printed fields, including seal SL-77120 and gross weight 4,800 kg, in one pass.",
  },
  {
    pain: "Nobody knows which model touched the shipment data, or whether it invented the price.",
    fix: "The model layer is narrow by design: read a photo, transcribe a voice note, match a lane, explain a figure. No model sets a price or a date, and every answer names the upstream that served it.",
    proof: "A quote explanation came back stamped served by openrouter:meta/muse-spark-1.3, quoting only the figures the engine had computed.",
  },
];

const FEATURES = [
  { i: "calc", h: "Landed cost, line by line", p: "Freight, duty, VAT, clearing, last mile and the delivered price, computed by a local engine from dated statutory rates. The model explains a figure; it never invents one." },
  { i: "cloud", h: "Built to work with no signal", p: "Every action lands in a local store first and syncs when the network returns. Corridor work happens where the trucks are, not where the Wi-Fi is." },
  { i: "pin", h: "Tracking that survives the road", p: "Status events, proof of delivery and photo evidence attach to the shipment, not to a chat thread that scrolls away." },
  { i: "shield", h: "Compliance before the border", p: "HS classification, EAC certificates of origin, exemptions and waivers checked before the truck reaches the gate." },
  { i: "box", h: "One desk, quote to cash", p: "Sourcing, supplier records, orders, invoices and stock movements in a single ledger, so the quote and the invoice can never drift apart." },
  { i: "file", h: "Documents that look like documents", p: "Quotations, proformas and delivery notes generated from the same figures that produced the price." },
];

const STEPS = [
  { h: "Describe the cargo", p: "Lane, goods, weight, packing and incoterm. The desk applies the corridor's freight, duty and clearing treatment." },
  { h: "Get a defensible quote", p: "A landed-cost ladder from supplier price to delivered price, each line tied to a dated rate. Adjust one line and the whole ladder recomputes." },
  { h: "Move it and prove it", p: "Book, track, clear, deliver. Status events and documents stay with the shipment for audit and for the customer." },
];

const CORRIDORS = [
  ["Mombasa → Kampala", "Northern corridor"], ["Mombasa → Nairobi", "ICD transfer"],
  ["Nairobi → Kigali", "Central corridor"], ["Dar es Salaam → Kampala", "Central corridor"],
  ["Mombasa → Juba", "Northern corridor"], ["Nairobi → Addis", "LAPSSET link"],
];

export default function Landing({ onEnter, onSignIn }) {
  return (
    <div className="site">
      <header className="site-head">
        <div className="wrap">
          <a className="logo" href="#/" onClick={(e) => { e.preventDefault(); onEnter(); }}>
            <span className="mark">AX</span>
            <strong>Altovex <span>CargoLinx</span></strong>
          </a>
          <nav className="site-nav">
            <a href="#features">Product</a>
            <a href="#how">How it works</a>
            <a href="#corridors">Corridors</a>
            <a href="#/hub">Dashboards</a>
          </nav>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onSignIn}>Sign in</button>
            <button className="btn btn-gold" onClick={onEnter}>Open the desk</button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">Built for the East African corridor</span>
            <h1>Quote, clear and track cargo — <em>with or without signal.</em></h1>
            <p className="lead">
              Altovex CargoLinx is the freight desk for traders and forwarders on the Mombasa, Nairobi,
              Kampala and Dar corridors. Landed cost, compliance and proof of delivery in one place,
              running on the device in front of you.
            </p>
            <div className="cta">
              <button className="btn btn-gold btn-lg" onClick={onEnter}>
                Open the desk <Icon d={ICONS.arrow} size={17} />
              </button>
              <button className="btn btn-ghost btn-lg" onClick={onSignIn}>Sign in</button>
            </div>
            <div className="trust">
              <div><span className="dot" /> Works offline</div>
              <div><span className="dot" /> No installation</div>
              <div><span className="dot" /> Your data stays on device</div>
            </div>
          </div>

          <div className="mock" aria-hidden="true">
            <div className="mock-bar">
              <i style={{ background: "#e46a5a" }} /><i style={{ background: "#e9b856" }} /><i style={{ background: "#4ec08a" }} />
              <span style={{ marginLeft: 10, fontSize: 11.5, color: "#7f95b0" }}>Mombasa → Kampala · 20ft · solar panels</span>
            </div>
            <div className="hero-body">
              <div className="mock-row"><span>Landed cost</span><span className="chip chip-ok">Quoted</span></div>
              <div className="mock-quote">
                <div className="k">Quoted to customer · before VAT</div>
                <div className="v">KES 3,084,472 <small>firm 14 days</small></div>
              </div>
              <div className="mock-cols">
                <div className="mock-cell"><div className="k">Landed incl. VAT</div><div className="v">2,468,686</div></div>
                <div className="mock-cell"><div className="k">Duty &amp; VAT</div><div className="v">412,940</div></div>
              </div>
              <div className="mock-row">
                <span>Proof of delivery</span><span className="chip chip-gold">Awaiting signature</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats">
        <div className="wrap">
          <div className="stat"><b>6</b><span>Corridors configured</span></div>
          <div className="stat"><b>14</b><span>Desk modules, one ledger</span></div>
          <div className="stat"><b>Offline</b><span>First, not fallback</span></div>
          <div className="stat"><b>0</b><span>Server needed to price</span></div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">What is in the desk</span>
            <h2>The work a freight desk actually does</h2>
            <p className="sub">Not a dashboard of charts. The six jobs that stand between a supplier price and a paid invoice.</p>
          </div>
          <div className="cards">
            {FEATURES.map((f) => (
              <article className="fcard" key={f.h}>
                <div className="ico-wrap"><Icon d={ICONS[f.i]} /></div>
                <h3>{f.h}</h3>
                <p>{f.p}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt" id="story">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Why it exists</span>
            <h2>Six things that cost a trader a shipment — and what the desk does instead</h2>
            <p className="sub">Each answer below is a behaviour in the build, with the figure or the run it was taken from. Not a promise.</p>
          </div>
          <div className="story">
            {STORY.map((s) => (
              <article className="prow" key={s.pain}>
                <div className="pain"><span className="tag">The problem</span><p>{s.pain}</p></div>
                <div className="fix">
                  <span className="tag ok">In the desk</span>
                  <p>{s.fix}</p>
                  <p className="proof">{s.proof}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt" id="how">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">How it works</span>
            <h2>Three steps, one set of numbers</h2>
            <p className="sub">The quote, the shipment and the invoice are the same figures seen from three angles.</p>
          </div>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.h}><h3>{s.h}</h3><p>{s.p}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="corridors">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Coverage</span>
            <h2>Corridors in the box</h2>
            <p className="sub">Freight, duty and clearing treatment for the routes Altovex runs, ready on first load.</p>
          </div>
          <div className="corridors">
            {CORRIDORS.map(([name, note]) => (
              <div className="corr" key={name}><b>{name}</b><span>{note}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Open the desk and price a shipment</h2>
            <p>No account, no card, nothing to install. The demo session runs entirely on your device, and every figure is computed locally.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-gold btn-lg" onClick={onEnter}>Open the desk</button>
            <button className="btn btn-ghost btn-lg" onClick={onSignIn}>Sign in</button>
          </div>
        </div>
      </section>

      <footer className="site-foot">
        <div className="wrap">
          <span className="logo"><span className="mark">AX</span><strong style={{ color: "var(--ink)" }}>Altovex CargoLinx</strong></span>
          <span>Altovex Global Logistics · Nairobi, Kenya</span>
          <span style={{ display: "block", flexBasis: "100%", fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Owned by Altovex Global Logistics, part of the Dreamteam Consulting group · one platform,
            in production, built for a million users.
          </span>
          <span style={{ marginLeft: "auto" }}>Figures are computed locally from dated statutory rates.</span>
        </div>
      </footer>
    </div>
  );
}
