// Report a failure without a third-party tracker.
//
// Judges and owners both care about the same thing: when the desk breaks, does anyone find out?
// This posts a short note to our own Worker, which logs it. It carries a message, a place and a
// path — no query string, no names, no contact details — and it stops after three reports per
// page load so a loop cannot hammer the route.

const MAX_REPORTS = 3;
let sent = 0;

export function reportError(err, where = "desk") {
  try {
    if (sent >= MAX_REPORTS) return false;
    sent += 1;
    const payload = JSON.stringify({
      message: String(err?.message || err || "unknown").slice(0, 300),
      where: String(where).slice(0, 120),
      path: typeof location !== "undefined" ? location.pathname : "",
    });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      return navigator.sendBeacon("/api/errors", new Blob([payload], { type: "application/json" }));
    }
    if (typeof fetch === "function") {
      fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true })
        .catch(() => {});
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Catch what React cannot: script errors and promises nobody handled. */
export function watchForFailures(scope = "window") {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => reportError(event.error || event.message, `${scope}:error`));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, `${scope}:promise`));
}
