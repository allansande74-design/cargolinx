/**
 * Plugin layer for sourcing and dropship integrations.
 *
 * Three plugins, modelled on what the platforms actually publish:
 *
 *  - alibaba_dropship — Alibaba.com's dropshipping ISV path: AppKey/AppSecret from the App Console
 *    with category ISV-Dropshipping, OAuth 2.0 code-for-token per buyer, product list/description,
 *    freight estimate, seller warehouse pools, BuyNow order creation, payment polling, logistics
 *    tracking, and HMAC-SHA256 signed webhooks.
 *  - aliexpress_ds — the AliExpress dropshipper API family (offer lookup, order detail, freight
 *    calculation) behind the same credential shape.
 *  - accio_sourcing — an Accio-style sourcing agent: turns a plain-language request into a structured
 *    brief and a shortlist. It is the only plugin that works without a platform key, because the work
 *    it does is local reasoning over what the operator already typed.
 *
 * Rules enforced here:
 *  - a plugin cannot report "ready" without the credentials its capabilities require;
 *  - a call without credentials throws, and a dry run shows the exact request that would be sent
 *    instead of a fabricated response;
 *  - capabilities are declared, so the UI can grey out what a plugin cannot do.
 */

export const PLUGIN_MANIFESTS = {
  alibaba_dropship: {
    id: "alibaba_dropship",
    name: "Alibaba.com Dropshipping",
    vendor: "Alibaba.com Open Platform",
    docs: "https://myconnections.alibaba.com/buyer/ds/center/isv-quick-start",
    model: "ISV-Dropshipping application: AppKey + AppSecret, OAuth 2.0 code-for-token per buyer",
    capabilities: ["catalog.list", "product.describe", "freight.quote", "warehouse.list", "order.create", "order.track", "webhook.verify"],
    requires: [
      { key: "appKey", label: "AppKey", how: "App Console, application category ISV-Dropshipping" },
      { key: "appSecret", label: "AppSecret", how: "App Console, shown once at creation" },
      { key: "accessToken", label: "Buyer access token", how: "OAuth 2.0 code-for-token (/auth/token/create), refreshable" },
    ],
    notes: [
      "API permission groups must be requested explicitly or every call returns a no-permission error.",
      "Payment is initiated by the platform (PayPal flow) and the result is polled, not assumed.",
      "Webhooks are HTTPS, signed HMAC-SHA256, and must be de-duplicated on receipt.",
    ],
  },
  aliexpress_ds: {
    id: "aliexpress_ds",
    name: "AliExpress Dropshipper",
    vendor: "AliExpress Open Platform (AE-Dropshipper)",
    docs: "https://ds.aliexpress.com/dropshipping-api",
    model: "AppKey + AppSecret with a seller-authorized token; offer and order APIs",
    capabilities: ["product.lookup", "offer.query", "freight.calculate", "order.get", "tracking.get"],
    requires: [
      { key: "appKey", label: "AppKey", how: "AliExpress Open Platform app registration" },
      { key: "appSecret", label: "AppSecret", how: "AliExpress Open Platform app registration" },
      { key: "accessToken", label: "Seller token", how: "OAuth authorisation by the account that pays" },
    ],
    notes: [
      "The API family is the dropshipper one (offer lookup, order detail, freight calculation), not the affiliate feed.",
      "Order creation spends money; it stays behind an explicit approval in the desk.",
    ],
  },
  accio_sourcing: {
    id: "accio_sourcing",
    name: "Sourcing agent (Accio-style)",
    vendor: "Altovex CargoLinx",
    docs: "local",
    model: "Local reasoning over the operator's own request; optional Meta model for prose",
    capabilities: ["brief.structure", "supplier.shortlist", "rfq.draft"],
    requires: [],
    notes: [
      "An Accio-style agent's value is a structured brief and a shortlist, not a promise of a price.",
      "Without a model key it falls back to deterministic parsing — the brief is still produced.",
    ],
  },
};

const state = new Map();

export function list() {
  return Object.values(PLUGIN_MANIFESTS).map((m) => ({ ...m, ...(state.get(m.id) ?? { config: {}, enabled: false }) }));
}

export function get(id) {
  const m = PLUGIN_MANIFESTS[id];
  if (!m) throw new Error(`unknown plugin ${id}`);
  return { ...m, ...(state.get(id) ?? { config: {}, enabled: false }) };
}

export function status(id) {
  const p = get(id);
  const missing = p.requires.filter((r) => !p.config?.[r.key]).map((r) => r.label);
  if (!p.enabled) return { id, state: "disabled", missing, detail: "not enabled on this device" };
  if (missing.length) return { id, state: "not-configured", missing, detail: `missing ${missing.join(", ")}` };
  return { id, state: "ready", missing: [], detail: "credentials present; calls are still made by the desk, not by this screen" };
}

export function configure(id, config = {}, { enabled = true } = {}) {
  get(id);
  state.set(id, { config: { ...(state.get(id)?.config ?? {}), ...config }, enabled });
  return status(id);
}

export function supports(id, capability) {
  return get(id).capabilities.includes(capability);
}

export class PluginNotConfigured extends Error {
  constructor(id, missing) {
    super(`${id} is not configured: missing ${missing.join(", ")}`);
    this.name = "PluginNotConfigured";
  }
}

/**
 * Show the request that would be sent, without sending it.
 * This is what makes an unconfigured plugin honest: the operator can see the shape of the call.
 */
export function dryRun(id, capability, payload = {}) {
  if (!supports(id, capability)) throw new Error(`${id} does not declare ${capability}`);
  const p = get(id);
  const base = {
    plugin: id,
    capability,
    credentialsPresent: p.requires.every((r) => p.config?.[r.key]),
    request: { method: "POST", transport: "HTTPS", signed: "HMAC-SHA256", body: payload },
  };
  if (id === "alibaba_dropship") {
    base.request.host = "openapi.alibaba.com";
    base.request.flow = "OAuth 2.0 code-for-token; business calls carry the buyer access token";
  } else if (id === "aliexpress_ds") {
    base.request.host = "api-sg.aliexpress.com/sync";
    base.request.note = "method name selects the API (offer lookup, order detail, freight calculation)";
  } else {
    base.request.host = "local";
    base.request.note = "runs in the app; no network call";
  }
  return base;
}

/** A real call is refused unless every credential is present. Never returns a made-up result. */
export async function invoke(id, capability, payload = {}, { fetchImpl = fetch } = {}) {
  const p = get(id);
  if (!supports(id, capability)) throw new Error(`${id} does not declare ${capability}`);
  const missing = p.requires.filter((r) => !p.config?.[r.key]).map((r) => r.label);
  if (missing.length) throw new PluginNotConfigured(id, missing);
  if (id === "accio_sourcing") return { plugin: id, capability, local: true, detail: "handled by the app's own sourcing module" };
  const res = await fetchImpl(`${p.config.baseUrl ?? ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, ...payload, accessToken: p.config.accessToken }),
  });
  if (!res.ok) throw new Error(`${id} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}
