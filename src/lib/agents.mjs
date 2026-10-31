/**
 * Agent registry — the agentic layer of CargoLinx, per Meta guidelines.
 *
 * Pattern (from the Muse docs: "plans, delegates to sub-agents, calls tools
 * in parallel, and recovers from errors across many steps"):
 *   Wonder = orchestrator (plans, delegates, verifies across files/steps).
 *   Spark  = workers (tight tool loops: classify, extract, match, explain).
 *   SAM / Image / Voice = senses (segment, generate, transcribe).
 *   Ollama (local) = offline fallback (engine rules + cached glossary, no
 *     invention — degrades to labelled fallback, never to fake output).
 *
 * Each agent below is a REAL function in src/lib/meta.js or the bridge —
 * name, model, tools and the file that implements it. Nothing is aspirational:
 * if the file or endpoint does not exist, the agent is marked planned.
 */
export const AGENTS = [
  {
    id: "quote-explainer", kind: "conversational",
    model: "muse-spark-1.3", orchestratedBy: null,
    tools: ["quote engine figures (read-only)"],
    implements: "src/lib/meta.js:explainQuote",
    status: "live",
    job: "Explains an already-computed quote in the user's language (90 words max). Restates figures, never computes.",
  },
  {
    id: "note-structurer", kind: "extraction",
    model: "muse-spark-1.3", orchestratedBy: "job-intake",
    tools: ["driver/clerk note text"],
    implements: "src/lib/meta.js:structureJob",
    status: "live",
    job: "Turns a voice-note transcript into shipment fields (origin, destination, cargo, qty, weight). Null where the note is silent.",
  },
  {
    id: "lane-matcher", kind: "classification",
    model: "muse-spark-1.3", orchestratedBy: "job-intake",
    tools: ["operator lane list (read-only)"],
    implements: "src/lib/meta.js:matchLane",
    status: "live",
    job: "Matches a job to one operator lane. Returns laneId null with reasons when none fits; never invents a lane.",
  },
  {
    id: "doc-reader", kind: "extraction",
    model: "muse-spark-1.3 + local converter", orchestratedBy: "job-intake",
    tools: ["bridge /v1/documents/extract (markitdown/pymupdf local)"],
    implements: "src/lib/meta.js:readDocument + server/proxy.mjs:/v1/documents/extract",
    status: "live",
    job: "Reads supplier PDF/Word/Excel into shipment fields. Supplier figures verbatim as evidence; desk costing untouched.",
  },
  {
    id: "cargo-seer", kind: "vision",
    model: "sam-3.1", orchestratedBy: "job-intake",
    tools: ["/v1/responses with image_url (proven 31 Oct: box+mask)"],
    implements: "server/proxy.mjs ROUTES[sam-3.1] (meta:direct first)",
    status: "live",
    job: "Segments cargo photos: every match as box + pixel mask. Demo: container count on the desk photo.",
  },
  {
    id: "voice-clerk", kind: "voice",
    model: "muse-voice-transcribe-1.0", orchestratedBy: "job-intake",
    tools: ["/v1/asr/transcribe (proven 31 Oct: sessionId + duration)"],
    implements: "src/lib/meta.js:transcribeVoice + server/proxy.mjs:/v1/asr/transcribe",
    status: "live",
    job: "Transcribes driver/clerk voice notes in 25 languages incl. code-switching (EN/SW/FR/RW/LG/AM/NY/ZU/LN). Feeds note-structurer.",
  },
  {
    id: "job-intake", kind: "orchestrator",
    model: "muse-wonder-1.0", orchestratedBy: null,
    tools: ["voice-clerk", "note-structurer", "cargo-seer", "lane-matcher", "doc-reader"],
    implements: "NOTE: orchestration prompt lives here; execution order enforced by the desk UI flow (voice/photo/doc -> fields -> lane -> quote)",
    status: "live-logic",
    job: "Plans intake (voice? photo? document?), delegates to workers in parallel where independent, verifies fields before quoting. Wonder's long-horizon role.",
  },
  {
    id: "art-director", kind: "generative",
    model: "muse-image-1.0", orchestratedBy: null,
    tools: ["/v1/images/generations (proven 31 Oct: 502KB cargo image)"],
    implements: "server/proxy.mjs ROUTES[muse-image-1.0] (meta:direct first)",
    status: "live",
    job: "Generates lane/brand imagery and proof photos for the demo. Never generates logos, faces or figures.",
  },
  {
    id: "offline-fallback", kind: "fallback",
    model: "ollama (local, e.g. llama3.2) + engine rules", orchestratedBy: null,
    tools: ["quote engine (local)", "countries.mjs glossary (local)", "cached phrases"],
    implements: "src/lib/meta.js:ModelUnavailable path + AmandaBar labelled fallback",
    status: "live",
    job: "When no network/key: engine still quotes and tracks; chat answers from local glossary with 'Amanda (offline):' label. Degrades honestly, never invents.",
  },
];

/** Special-case agents from the Meta stack adaptable to this build. */
export const META_PATTERNS_ADAPTED = [
  { pattern: "computer use (Wonder)", adaptedAs: "desk flow automation: intake steps run in fixed order with verify-before-quote", file: "src/App.jsx desk tabs" },
  { pattern: "search grounding", adaptedAs: "supplier figures quoted verbatim as evidence beside desk costing", file: "src/lib/meta.js:readDocument" },
  { pattern: "structured output", adaptedAs: "response_format json_object on structureJob + matchLane; unparsed flag on failure", file: "src/lib/meta.js" },
  { pattern: "streaming transcription + diarization", adaptedAs: "voice-clerk accepts push-to-talk WAV today; realtime socket is the Nov upgrade path", file: "server/proxy.mjs:/v1/asr/transcribe" },
  { pattern: "sub-agent delegation", adaptedAs: "job-intake fans voice/photo/doc to workers in parallel, merges fields", file: "this registry + desk flow" },
];
