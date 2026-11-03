/**
 * Sequencing stops on a vehicle — the question the dispatcher asks after "who carries it".
 *
 * `match-dispatch.mjs` answers which vehicle takes which load. It does not answer the order the
 * stops are visited in, and on a Nairobi day with six drops that order is the difference between
 * one truck and two. This module answers it, and it is deliberately small and inspectable: a
 * savings construction, then 2-opt, then a check that the result never breaks capacity.
 *
 *   stop:   { id, lat, lng, weightKg? }
 *   depot:  { lat, lng }
 *
 * Distances are great-circle kilometres, which is honest for road planning only as a proxy — the
 * README says so. What is exact is the arithmetic: the sequence returned is the shortest one we
 * found among the neighbour orders we tried, and every candidate is scored with the same function.
 */

const EARTH_KM = 6371.0088;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two { lat, lng } points. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A matrix over one list of points, so the same distance is never computed twice. */
export function buildMatrix(points = []) {
  const n = points.length;
  const m = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = distanceKm(points[i], points[j]);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

/** Total road length of a visit order that starts and ends at node 0. */
export function routeLength(route, matrix) {
  if (route.length === 0) return 0;
  let total = matrix[0][route[0]];
  for (let i = 1; i < route.length; i += 1) total += matrix[route[i - 1]][route[i]];
  return total + matrix[route[route.length - 1]][0];
}

/** The order a driver would take with no help: always the nearest stop not yet visited. */
export function nearestNeighbourRoute(stops, matrix) {
  const left = stops.map((_, i) => i + 1);
  const route = [];
  let here = 0;
  while (left.length) {
    let best = 0;
    for (let k = 1; k < left.length; k += 1) if (matrix[here][left[k]] < matrix[here][left[best]]) best = k;
    const next = left.splice(best, 1)[0];
    route.push(next);
    here = next;
  }
  return route;
}

/**
 * Clarke–Wright savings: start with one out-and-back trip per stop, then join the two trips whose
 * joining saves the most kilometres, as long as the joined load still fits. Greedy, deterministic
 * (ties broken by the pair order), and it beats nearest-neighbour on almost every real instance.
 */
export function savingsRoute(stops, matrix, capacityKg = Infinity) {
  const n = stops.length;
  if (n <= 1) return stops.map((_, i) => i + 1);

  const weight = stops.map((s) => Number(s.weightKg) || 0);
  const routeOf = new Map();
  for (let i = 1; i <= n; i += 1) routeOf.set(i, { nodes: [i], load: weight[i - 1] });

  const savings = [];
  for (let i = 1; i <= n; i += 1) {
    for (let j = i + 1; j <= n; j += 1) {
      savings.push({ i, j, s: matrix[0][i] + matrix[0][j] - matrix[i][j] });
    }
  }
  savings.sort((a, b) => b.s - a.s || a.i - b.i || a.j - b.j);

  for (const { i, j } of savings) {
    const ri = routeOf.get(i);
    const rj = routeOf.get(j);
    if (ri === rj) continue;
    if (ri.load + rj.load > capacityKg) continue;

    const a = ri.nodes;
    const b = rj.nodes;
    const iEnd = a[a.length - 1] === i;
    const iStart = a[0] === i;
    const jStart = b[0] === j;
    const jEnd = b[b.length - 1] === j;

    let nodes = null;
    if (iEnd && jStart) nodes = [...a, ...b];
    else if (iEnd && jEnd) nodes = [...a, ...b.slice().reverse()];
    else if (iStart && jStart) nodes = [...a.slice().reverse(), ...b];
    else if (iStart && jEnd) nodes = [...b, ...a];
    if (!nodes) continue;

    const merged = { nodes, load: ri.load + rj.load };
    for (const node of nodes) routeOf.set(node, merged);
  }

  const seen = new Set();
  const routes = [];
  for (let i = 1; i <= n; i += 1) {
    const r = routeOf.get(i);
    if (seen.has(r)) continue;
    seen.add(r);
    routes.push({ nodes: r.nodes, length: routeLength(r.nodes, matrix) });
  }
  routes.sort((x, y) => x.length - y.length || x.nodes[0] - y.nodes[0]);
  return routes.flatMap((r) => r.nodes);
}

/** 2-opt: reverse a stretch between two stops when that shortens the loop. Stops when nothing improves. */
export function twoOpt(route, matrix, { maxPasses = 40 } = {}) {
  let best = route.slice();
  if (best.length < 3) return best;
  let improved = true;
  let passes = 0;
  while (improved && passes < maxPasses) {
    improved = false;
    passes += 1;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (routeLength(candidate, matrix) + 1e-9 < routeLength(best, matrix)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}


/**
 * Or-opt: take one stop (or two neighbours) out of the order and put it back somewhere better.
 * 2-opt fixes crossings; it cannot move a single stop across the route, and that is exactly the
 * remaining gap on small days. Cheap to run, and it is applied only when it shortens the loop.
 */
export function orOpt(route, matrix, { maxPasses = 20 } = {}) {
  let best = route.slice();
  if (best.length < 3) return best;
  let improved = true;
  let passes = 0;
  while (improved && passes < maxPasses) {
    improved = false;
    passes += 1;
    const current = routeLength(best, matrix);
    for (let len = 1; len <= 2; len += 1) {
      for (let i = 0; i + len <= best.length; i += 1) {
        const block = best.slice(i, i + len);
        const rest = [...best.slice(0, i), ...best.slice(i + len)];
        for (let at = 0; at <= rest.length; at += 1) {
          if (at === i) continue;
          const candidate = [...rest.slice(0, at), ...block, ...rest.slice(at)];
          if (routeLength(candidate, matrix) + 1e-9 < current) {
            best = candidate;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }
  return best;
}

/** Both neighbourhoods, alternating until neither can shorten the day any further. */
export function improveRoute(route, matrix, { rounds = 20 } = {}) {
  let best = route.slice();
  let previous = routeLength(best, matrix);
  for (let i = 0; i < rounds; i += 1) {
    best = orOpt(twoOpt(best, matrix), matrix);
    const now = routeLength(best, matrix);
    if (now > previous - 1e-9) break;
    previous = now;
  }
  return best;
}

/**
 * Small days are solved, not guessed. Under nine stops the number of possible orders is small
 * enough to enumerate (40,320 at eight), so the desk returns the shortest one that exists rather
 * than a good one — and says nothing about it, because an optimal day needs no excuse.
 */
export const EXACT_STOPS = 8;

export function exactRoute(stops, matrix) {
  const nodes = stops.map((_, i) => i + 1);
  let best = null;
  let bestLen = Infinity;
  const walk = (left, acc) => {
    if (left.length === 0) {
      const len = routeLength(acc, matrix);
      if (len < bestLen - 1e-12) {
        bestLen = len;
        best = acc.slice();
      }
      return;
    }
    for (let i = 0; i < left.length; i += 1) {
      walk([...left.slice(0, i), ...left.slice(i + 1)], [...acc, left[i]]);
    }
  };
  walk(nodes, []);
  return best;
}

/** Exact while a day is small, heuristic when it is not — the same function either way. */
export function sequenceRoute(stops, matrix, { exactUpTo = EXACT_STOPS } = {}) {
  if (stops.length === 0) return [];
  if (stops.length <= exactUpTo) return exactRoute(stops, matrix);
  return improveRoute(savingsRoute(stops, matrix), matrix);
}

/**
 * Plan one vehicle's day: pick the stops it can legally carry, order them, and say what did not fit.
 * Nothing is thrown for a business reason — a stop that cannot ride comes back with a sentence.
 */
export function planVehicleDay(depot, stops = [], { capacityKg = Infinity, improve = true } = {}) {
  const carrying = [];
  const left = [];
  let load = 0;
  for (const stop of stops) {
    const w = Number(stop.weightKg) || 0;
    if (load + w > capacityKg) {
      left.push({ id: stop.id, reason: `capacity ${capacityKg}kg cannot take a further ${w}kg (loaded ${load}kg)` });
      continue;
    }
    load += w;
    carrying.push(stop);
  }
  if (carrying.length === 0) return { stops: [], distanceKm: 0, loadKg: 0, unplanned: left };

  const points = [depot, ...carrying];
  const matrix = buildMatrix(points);
  const start = carrying.length <= 1 ? carrying.map((_, i) => i + 1) : savingsRoute(carrying, matrix, capacityKg);
  const route = improve ? sequenceRoute(carrying, matrix) : start;
  const ordered = route.map((node) => carrying[node - 1]);
  return { stops: ordered, distanceKm: Number(routeLength(route, matrix).toFixed(3)), loadKg: load, unplanned: left };
}
