/**
 * LocoNav telematics adapter — last-mile position, trips and video telematics.
 *
 * Verified against LocoNav's developer documentation on 29 October 2026:
 *  - base host api.a.loconav.com (global; sa / om / np for KSA, Oman, Nepal);
 *  - authentication is a per-user token sent in the `User-Authentication` header, issued by a
 *    LocoNav SPOC — there is no self-service signup;
 *  - time parameters are epoch seconds;
 *  - listing calls require a pagination object;
 *  - the surface covers vehicles, trips, alerts, geofences, video telematics and webhooks
 *    (alerts and GPS live locations).
 *
 * Paths beyond the documented sections are marked `confirm` — they are written from the section
 * names, not from a published schema, and must be confirmed on the SPOC call before we rely on them.
 * Nothing here invents a position: without a token every call reports "not configured".
 */

export const LOCONAV = {
  hosts: { global: "https://api.a.loconav.com", ksa: "https://sa.loconav.com", oman: "https://om.loconav.com", nepal: "https://np.loconav.com" },
  authHeader: "User-Authentication",
  docs: "https://developers.loconav.com/",
  verifiedOn: "2026-10-29",
};

export const ENDPOINTS = {
  vehicles: { method: "GET", path: "/integration/api/v1/vehicles", purpose: "fleet list and vehicle identity", confidence: "section documented" },
  trip: { method: "GET", path: "/integration/api/v1/trips", purpose: "trip history between two epoch timestamps", confidence: "section documented" },
  location: { method: "GET", path: "/integration/api/v1/vehicles/{vehicleId}/location", purpose: "current position for one vehicle", confidence: "confirm" },
  video_stream: { method: "GET", path: "/integration/api/v1/video-telematics/{vehicleId}/live-stream", purpose: "live video stream reference", confidence: "confirm" },
  alerts: { method: "GET", path: "/integration/api/v1/alerts", purpose: "speeding, geofence and safety alerts", confidence: "section documented" },
};

export class LoconavNotConfigured extends Error {
  constructor() {
    super("LocoNav is not configured on this device: no user token. Last-mile position stays blank rather than being invented.");
    this.name = "LoconavNotConfigured";
  }
}

export function config({ region = "global", token = null, baseUrl = null } = {}) {
  const host = baseUrl ?? LOCONAV.hosts[region];
  if (!host) throw new Error(`unknown LocoNav region ${region}`);
  return { region, baseUrl: host, token, configured: Boolean(token) };
}

function url(cfg, path, query = {}) {
  const u = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

async function get(cfg, endpointKey, { pathParams = {}, query = {}, page = 1, pageSize = 50 } = {}) {
  if (!cfg?.token) throw new LoconavNotConfigured();
  const ep = ENDPOINTS[endpointKey];
  if (!ep) throw new Error(`unknown endpoint ${endpointKey}`);
  const path = Object.entries(pathParams).reduce((acc, [k, v]) => acc.replace(`{${k}}`, encodeURIComponent(v)), ep.path);
  const q = endpointKey === "vehicles" || endpointKey === "trips" || endpointKey === "alerts" ? { ...query, pagination: JSON.stringify({ page, pageSize }) } : query;
  const res = await fetch(url(cfg, path, q), { headers: { [LOCONAV.authHeader]: cfg.token, Accept: "application/json" } });
  if (res.status === 401) throw new Error("LocoNav rejected the token (401) — ask the SPOC to reissue it");
  if (res.status === 404) throw new Error(`LocoNav has no such path (404) — confirm ${ep.path} with the SPOC before relying on it`);
  if (!res.ok) throw new Error(`LocoNav ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

export const vehicles = (cfg, opts) => get(cfg, "vehicles", opts);
export const trips = (cfg, { fromEpoch, toEpoch, vehicleId, ...rest } = {}) => {
  if (!fromEpoch || !toEpoch) throw new Error("trips need epoch-second start and end");
  return get(cfg, "trip", { ...rest, query: { startTime: fromEpoch, endTime: toEpoch, vehicleId } });
};
export const currentLocation = (cfg, vehicleId) => get(cfg, "location", { pathParams: { vehicleId } });
export const videoStream = (cfg, vehicleId) => get(cfg, "video_stream", { pathParams: { vehicleId } });
export const alerts = (cfg, opts) => get(cfg, "alerts", opts);

/** Probe what a token can actually do. Reports the truth, including a wrong path. */
export async function probe(cfg) {
  if (!cfg?.configured) return { configured: false, reachable: false, detail: "no token" };
  try {
    const data = await vehicles(cfg, { page: 1, pageSize: 1 });
    return { configured: true, reachable: true, detail: "vehicles endpoint answered", sample: Array.isArray(data) ? data.length : Object.keys(data ?? {}).length };
  } catch (err) {
    return { configured: true, reachable: false, detail: err.message };
  }
}

/**
 * Normalise a GPS or alert webhook.
 * LocoNav's payload shape is not published in full, so this reads the fields that any fleet
 * webhook must carry and returns nulls for what is absent. A null position is not a position at 0,0.
 */
export function parseWebhook(payload) {
  const p = payload ?? {};
  const pick = (...keys) => keys.map((k) => k.split(".").reduce((o, part) => (o == null ? o : o[part]), p)).find((v) => v !== undefined && v !== null);
  const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  const lat = num(pick("lat", "latitude", "location.lat", "location.latitude", "gps.lat"));
  const lng = num(pick("lng", "lon", "long", "longitude", "location.lng", "location.longitude", "gps.lng"));
  const epoch = num(pick("timestamp", "ts", "time", "locationTime", "eventTime", "createdAt"));
  return {
    vehicleId: pick("vehicleId", "vehicle_id", "vehicle.id", "regNo", "registrationNumber") ?? null,
    lat,
    lng,
    speedKph: num(pick("speed", "speedKph", "gps.speed")),
    ignition: pick("ignition", "ignitionStatus", "acc") ?? null,
    eventType: pick("eventType", "type", "alertType") ?? "location",
    at: epoch ? new Date(epoch * (String(epoch).length > 10 ? 1 : 1000)).toISOString() : null,
    valid: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
    raw: p,
  };
}

/**
 * Turn the last known position into a state a dispatcher can act on.
 * A fix older than fifteen minutes is stale, and saying "live" then is a lie.
 */
export function trackingState({ lastFix, now = new Date(), staleMinutes = 15 } = {}) {
  if (!lastFix || !lastFix.valid) {
    return { status: "no position", stale: true, detail: "no valid fix received from the vehicle yet" };
  }
  const ageMs = new Date(now).getTime() - new Date(lastFix.at ?? now).getTime();
  const ageMinutes = Math.round(ageMs / 60000);
  const stale = ageMinutes > staleMinutes;
  return {
    status: stale ? "position stale" : "live",
    stale,
    ageMinutes,
    position: { lat: lastFix.lat, lng: lastFix.lng },
    speedKph: lastFix.speedKph ?? null,
    detail: stale ? `last fix ${ageMinutes} minutes old — do not present this as live` : `updated ${ageMinutes} minute(s) ago`,
  };
}
