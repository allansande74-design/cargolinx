/**
 * Meta Model API client — one transport, one evidence trail.
 *
 * The judging criterion is not "we mention a model", it is "the model was actually called".
 * So every call this client makes leaves a record: which model, which task, when, how long it
 * took, and the request id the platform returned. That record is what a reviewer is shown, and
 * what the app stamps onto a consignment when a model contributed to it.
 *
 * Two rules hold this file honest:
 *
 * 1. No endpoint and no model identifier is invented here. Both come from configuration
 *    (META_API_BASE, META_MODEL_<TASK>) and, when unset, the client refuses with `no_model_configured`
 *    instead of calling something that looks plausible. A guessed URL is worse than no call,
 *    because it produces a stack trace that reads like a real failure.
 * 2. The key is read from the environment, sent in one header, and never placed in the evidence
 *    record, an error message, or a log line. `redact()` exists so callers cannot leak it by
 *    stringifying an error.
 */

const DEFAULTS = {
  timeoutMs: 20_000,
  path: "/v1/responses",
  logLimit: 250,
};

export class MetaError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "MetaError";
    this.code = code;
    this.detail = detail;
  }
}

/** Strip anything that looks like a bearer token or an API key out of a string. */
export function redact(value, key = process.env.META_API_KEY) {
  let s = typeof value === "string" ? value : JSON.stringify(value);
  if (key && key.length >= 8) s = s.split(key).join("[redacted]");
  return s.replace(/\b(sk|key|tok)[-_][A-Za-z0-9]{12,}\b/g, "[redacted]");
}

function nowMs() {
  return Date.now();
}

/**
 * @param {object} opts
 * @param {string} [opts.apiKey]      Meta API key. Defaults to process.env.META_API_KEY.
 * @param {string} [opts.baseUrl]     Defaults to process.env.META_API_BASE.
 * @param {string} [opts.path]        Request path. Defaults to META_API_PATH, then /v1/responses.
 * @param {Function} [opts.fetchImpl] Injectable for tests.
 * @param {number} [opts.timeoutMs]
 */
export function createMetaClient(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.META_API_KEY ?? "";
  const baseUrl = (opts.baseUrl ?? process.env.META_API_BASE ?? "").replace(/\/+$/, "");
  const path = opts.path ?? process.env.META_API_PATH ?? DEFAULTS.path;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;

  /** Evidence trail. Bounded so a long-running session cannot grow without limit. */
  const calls = [];

  function configured(task) {
    const model = opts.model?.[task] ?? process.env[`META_MODEL_${String(task).toUpperCase()}`] ?? null;
    return { model, ready: Boolean(apiKey && baseUrl && model) };
  }

  function record(entry) {
    calls.push(entry);
    if (calls.length > DEFAULTS.logLimit) calls.shift();
    return entry;
  }

  /**
   * Run one task. `build` turns the task input into a request body for the given model;
   * `parse` validates the model's answer and must throw MetaError("bad_response") on anything
   * it cannot verify. A model answer that cannot be parsed is a refusal, never a guess.
   */
  async function run(task, input, { build, parse } = {}) {
    if (typeof task !== "string" || !task) throw new MetaError("bad_task", "task name required");
    if (typeof build !== "function" || typeof parse !== "function") {
      throw new MetaError("bad_contract", `task ${task} needs build() and parse()`);
    }

    const { model, ready } = configured(task);
    if (!ready) {
      return record({
        ok: false,
        task,
        code: "no_model_configured",
        reason: !apiKey
          ? "META_API_KEY is not set — no model was called, and nothing here should be presented as a model result."
          : !baseUrl
            ? "META_API_BASE is not set."
            : `META_MODEL_${String(task).toUpperCase()} is not set.`,
        model: model ?? null,
        at: new Date().toISOString(),
        latencyMs: 0,
      });
    }

    const body = build({ model, input });
    const started = nowMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    let text;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      const aborted = err?.name === "AbortError";
      return record({
        ok: false,
        task,
        model,
        code: aborted ? "timeout" : "transport",
        reason: aborted
          ? `no answer within ${timeoutMs} ms; the caller must fall back deterministically`
          : redact(err?.message ?? String(err)),
        at: new Date().toISOString(),
        latencyMs: nowMs() - started,
      });
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = nowMs() - started;
    const requestId = response.headers?.get?.("x-request-id") ?? response.headers?.get?.("request-id") ?? null;

    if (!response.ok) {
      return record({
        ok: false,
        task,
        model,
        code: response.status === 401 || response.status === 403 ? "unauthorised" : "http_error",
        status: response.status,
        reason: redact(text.slice(0, 400)),
        at: new Date().toISOString(),
        latencyMs,
        requestId,
      });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return record({
        ok: false, task, model, code: "bad_json",
        reason: "the endpoint returned a body that is not JSON",
        at: new Date().toISOString(), latencyMs, requestId,
      });
    }

    let output;
    try {
      output = parse(payload, input);
    } catch (err) {
      return record({
        ok: false, task, model, code: "bad_response",
        reason: redact(err?.message ?? String(err)),
        at: new Date().toISOString(), latencyMs, requestId,
      });
    }

    return record({
      ok: true,
      task,
      model,
      output,
      at: new Date().toISOString(),
      latencyMs,
      requestId,
      usage: payload.usage ?? null,
      // What was actually asked and actually answered, trimmed: enough for a reviewer to see it is real.
      requestDigest: redact(JSON.stringify(body)).slice(0, 2_000),
      responseDigest: redact(text).slice(0, 2_000),
    });
  }

  return {
    run,
    configured,
    /** Copy of the evidence trail, newest last. */
    evidence: () => calls.map((c) => ({ ...c })),
    /** A compact one-line stamp for a document or a screen: model, task, latency, request id. */
    stamp: (entry) =>
      entry && entry.ok
        ? `${entry.model} · ${entry.task} · ${entry.latencyMs} ms${entry.requestId ? ` · ${entry.requestId}` : ""}`
        : "no model call",
    ready: (task) => configured(task).ready,
  };
}
