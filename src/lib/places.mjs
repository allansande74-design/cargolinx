/**
 * Where a place is, without asking the internet.
 *
 * The desk runs offline first, so it cannot depend on a geocoding service to know that "Industrial
 * Area" sits south-east of the city centre. This is a small table of area and town centres for the
 * lanes Altovex actually runs, with the honest caveat written into the name of the module: these are
 * centres, accurate to a few hundred metres at best. Good enough to order a day's stops, not good
 * enough to navigate to a gate — the driver's own location fix does that.
 *
 * Matching is by longest name found in the text, so "Mombasa Road" always beats "Mombasa", and a
 * destination that says "Mlolongo, Mombasa Road" resolves to Mlolongo.
 */

export const PLACES = [
  { name: "Industrial Area", lat: -1.308, lng: 36.85, aliases: ["industrial area", "enterprise road"] },
  { name: "Nairobi CBD", lat: -1.2921, lng: 36.8219, aliases: ["nairobi cbd", "city centre", "city center", "nairobi"] },
  { name: "Westlands", lat: -1.267, lng: 36.806, aliases: ["westlands"] },
  { name: "Karen", lat: -1.335, lng: 36.71, aliases: ["karen"] },
  { name: "Kilimani", lat: -1.29, lng: 36.78, aliases: ["kilimani"] },
  { name: "Embakasi", lat: -1.32, lng: 36.89, aliases: ["embakasi"] },
  { name: "Nairobi ICD", lat: -1.33, lng: 36.9, aliases: ["icd", "inland container depot"] },
  { name: "JKIA", lat: -1.3192, lng: 36.9278, aliases: ["jkia", "jomo kenyatta", "airport"] },
  { name: "Mombasa Road", lat: -1.35, lng: 36.87, aliases: ["mombasa road"] },
  { name: "Mlolongo", lat: -1.396, lng: 36.94, aliases: ["mlolongo"] },
  { name: "Syokimau", lat: -1.36, lng: 36.95, aliases: ["syokimau"] },
  { name: "Athi River", lat: -1.456, lng: 36.98, aliases: ["athi river"] },
  { name: "Ruiru", lat: -1.145, lng: 36.96, aliases: ["ruiru"] },
  { name: "Thika", lat: -1.0333, lng: 37.0667, aliases: ["thika"] },
  { name: "Kikuyu", lat: -1.246, lng: 36.66, aliases: ["kikuyu"] },
  { name: "Ngong Road", lat: -1.3, lng: 36.78, aliases: ["ngong road"] },
  { name: "Ngong", lat: -1.352, lng: 36.657, aliases: ["ngong"] },
  { name: "Thika Road", lat: -1.22, lng: 36.87, aliases: ["thika road"] },
  { name: "Rongai", lat: -1.396, lng: 36.73, aliases: ["rongai"] },
  { name: "Limuru", lat: -1.111, lng: 36.642, aliases: ["limuru"] },
  { name: "Machakos", lat: -1.5177, lng: 37.2634, aliases: ["machakos"] },
  { name: "Kajiado", lat: -1.852, lng: 36.777, aliases: ["kajiado"] },
  { name: "Naivasha", lat: -0.7167, lng: 36.4359, aliases: ["naivasha"] },
  { name: "Nakuru", lat: -0.3031, lng: 36.08, aliases: ["nakuru"] },
  { name: "Narok", lat: -1.078, lng: 35.87, aliases: ["narok"] },
  { name: "Kericho", lat: -0.3689, lng: 35.2863, aliases: ["kericho"] },
  { name: "Eldoret", lat: 0.5143, lng: 35.2698, aliases: ["eldoret"] },
  { name: "Kitale", lat: 1.0157, lng: 35.0062, aliases: ["kitale"] },
  { name: "Bungoma", lat: 0.5635, lng: 34.5606, aliases: ["bungoma"] },
  { name: "Kisumu", lat: -0.0917, lng: 34.768, aliases: ["kisumu"] },
  { name: "Nyeri", lat: -0.4167, lng: 36.95, aliases: ["nyeri"] },
  { name: "Nanyuki", lat: -0.0167, lng: 37.0731, aliases: ["nanyuki"] },
  { name: "Meru", lat: 0.05, lng: 37.65, aliases: ["meru"] },
  { name: "Embu", lat: -0.539, lng: 37.457, aliases: ["embu"] },
  { name: "Isiolo", lat: 0.3546, lng: 37.5822, aliases: ["isiolo"] },
  { name: "Garissa", lat: -0.4536, lng: 39.6461, aliases: ["garissa"] },
  { name: "Voi", lat: -3.396, lng: 38.556, aliases: ["voi"] },
  { name: "Kilifi", lat: -3.6305, lng: 39.8499, aliases: ["kilifi"] },
  { name: "Malindi", lat: -3.2175, lng: 40.1191, aliases: ["malindi"] },
  { name: "Mombasa port", lat: -4.06, lng: 39.66, aliases: ["mombasa port", "port of mombasa", "kilindini"] },
  { name: "Mombasa", lat: -4.0435, lng: 39.6682, aliases: ["mombasa"] },
];

const INDEX = PLACES.flatMap((place) =>
  [place.name, ...(place.aliases || [])].map((term) => ({ term: term.toLowerCase(), place }))).sort(
  (a, b) => b.term.length - a.term.length,
);

/** The most specific place named in a piece of text, or null if the text names none of them. */
export function findPlace(text) {
  const hay = String(text || "").toLowerCase();
  if (!hay.trim()) return null;
  for (const { term, place } of INDEX) {
    if (hay.includes(term)) return place;
  }
  return null;
}

/** The place an order is going to, reading the address first because it is the more specific field. */
export function placeForOrder(order) {
  const dest = order?.destination || {};
  return findPlace(`${dest.address || ""} ${dest.city || ""}`) || findPlace(order?.notes || "");
}

/** Turn a list of orders into stops the sequencing engine can plan, keeping what it could not place. */
export function stopsFromOrders(orders = [], { defaultWeightKg = 500 } = {}) {
  const stops = [];
  const unplaced = [];
  for (const order of orders) {
    const place = placeForOrder(order);
    if (!place) {
      unplaced.push(order.id);
      continue;
    }
    stops.push({
      id: order.id,
      label: place.name,
      lat: place.lat,
      lng: place.lng,
      weightKg: Number(order.weightKg) || defaultWeightKg,
    });
  }
  return { stops, unplaced };
}
