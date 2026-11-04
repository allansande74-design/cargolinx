/**
 * The load ladder and the carton maths.
 *
 * Two problems the desk met every day and answered by hand:
 *
 *   1. A client arrives with a carton that is not a box — bulging, tapered, one side twice the other —
 *      and no idea what its cube is, so the first quote is a guess and the second is an argument.
 *   2. A client asks "how much for 40 cartons?" and the answer depends on which unit carries them:
 *      a boda boda, a tuk-tuk, a pickup, a 3-tonne van, a 7-tonne mini, a 12-tonne cross-border truck
 *      or a 30-tonne regional unit.
 *
 * So this module does the arithmetic a freight clerk does with a tape measure and a calculator, and it
 * says which of its numbers are measured and which are our own planning rates.
 *
 * What it deliberately does not do: pretend a carrier has signed the rate. Every per-km figure here is
 * an internal planning rate and is labelled as one.
 */

const KES = "KES";

/** Road freight charges on the greater of actual weight and volume weight. 250 kg per cubic metre. */
export const ROAD_CUBIC_KG_PER_M3 = 250;

/** Cartons are measured outside; 8% is the gap between stacked cartons and sealed air. */
export const VOID_ALLOWANCE = 0.08;

/** A carton a human loads without a pallet truck: 25 kg. Above that the carton is a two-person lift. */
export const MAX_CARTON_KG = 25;

/** No side more than three times the shortest side, or it is a plank, not a box. */
export const MAX_ASPECT_RATIO = 3;

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * The ladder, smallest to largest, as the desk actually sells it.
 *
 * Rates are internal planning figures in KES per kilometre for the whole vehicle, and each one wants
 * replacing with a signed carrier rate before a client figure is issued.
 */
export const RUNGS = Object.freeze(
  [
    { code: "bike", label: "Parcel on a boda boda", payloadKg: 80, volumeM3: 0.15, kesPerKm: 38, corridors: ["last_mile"] },
    { code: "tuktuk", label: "Tuk-tuk (500 kg)", payloadKg: 500, volumeM3: 1.8, kesPerKm: 48, corridors: ["last_mile", "urban"] },
    { code: "pickup", label: "Pickup (1 tonne)", payloadKg: 1000, volumeM3: 3, kesPerKm: 62, corridors: ["last_mile", "urban", "trunk"] },
    { code: "van3", label: "Van (3 tonnes)", payloadKg: 3000, volumeM3: 14, kesPerKm: 95, corridors: ["urban", "trunk"] },
    { code: "mini", label: "Mini truck (7 tonnes, 5–9 t class)", payloadKg: 7000, volumeM3: 30, kesPerKm: 145, corridors: ["urban", "trunk", "regional"] },
    { code: "cross12", label: "Cross-border truck (12 tonnes)", payloadKg: 12000, volumeM3: 45, kesPerKm: 190, corridors: ["trunk", "regional"] },
    { code: "regional30", label: "Regional transit unit (30 tonnes)", payloadKg: 30000, volumeM3: 100, kesPerKm: 300, corridors: ["trunk", "regional"] },
  ].map((r) => Object.freeze({ ...r, corridors: Object.freeze([...r.corridors]) })),
);

const rungByCode = new Map(RUNGS.map((r) => [r.code, r]));

/** A six-figure minimum keeps a 200-metre delivery from being quoted at nothing. */
const minimumCharge = (rung) => Math.max(rung.kesPerKm * 5, 300);

/**
 * Measure one carton and say whether it is a box.
 *
 * Takes centimetres and kilograms because that is what a tape measure and a bathroom scale show.
 * Returns cubic metres, because that is what a freight rate is written in.
 */
export function measureCarton({ lengthCm, widthCm, heightCm, weightKg }) {
  const dims = [lengthCm, widthCm, heightCm].map(Number);
  if (dims.some((d) => !(d > 0))) {
    throw new RangeError("every dimension must be greater than zero — a carton with no height is a pallet");
  }
  const [longest, middle, shortest] = [...dims].sort((a, b) => b - a);
  const aspect = longest / shortest;
  const cbm = (longest * middle * shortest) / 1_000_000;
  const kg = Number(weightKg);
  const density = kg > 0 ? kg / cbm : null;

  const problems = [];
  if (aspect > MAX_ASPECT_RATIO) {
    problems.push(
      `longest side is ${round(aspect, 1)}× the shortest — a carrier will cube it against the longest side anyway, so a ${round(shortest, 0)}×${round(middle, 0)}×${round(longest, 0)} cm box packs the same contents and measures less`,
    );
  }
  if (kg > MAX_CARTON_KG) {
    problems.push(`${round(kg, 1)} kg is above the ${MAX_CARTON_KG} kg a handler lifts; split into ${Math.ceil(kg / MAX_CARTON_KG)} cartons`);
  }
  if (density !== null && density > 600) {
    problems.push(`${round(density, 0)} kg per cubic metre is dense; weight will price this load, not volume`);
  }

  return {
    cbm: round(cbm, 4),
    aspectRatio: round(aspect, 2),
    boxShaped: aspect <= MAX_ASPECT_RATIO,
    densityKgPerM3: density === null ? null : round(density, 1),
    chargeableKg: round(Math.max(kg, cbm * ROAD_CUBIC_KG_PER_M3), 2),
    problems,
  };
}

/**
 * Total a consignment: cubic metres of cartons, of pallets or loose, with the void allowance added
 * once for stacking rather than per carton.
 */
export function measureConsignment({ lengthCm, widthCm, heightCm, weightKg, count = 1 }) {
  const n = Number(count);
  if (!(n >= 1)) throw new RangeError("count must be at least one carton");
  const one = measureCarton({ lengthCm, widthCm, heightCm, weightKg });
  const cbm = round(one.cbm * n * (1 + VOID_ALLOWANCE), 3);
  const kg = round(Number(weightKg) * n, 2);
  const chargeableKg = round(Math.max(kg, cbm * ROAD_CUBIC_KG_PER_M3), 2);
  return {
    count: n,
    cbmPerCarton: one.cbm,
    cbm,
    kg,
    chargeableKg,
    chargeableBasis: kg >= cbm * ROAD_CUBIC_KG_PER_M3 ? "weight" : "volume",
    carton: one,
    voidAllowance: VOID_ALLOWANCE,
  };
}

/**
 * The smallest rung that carries the load, and the price on it.
 *
 * Price is the full-vehicle rate for the distance, scaled by the greater of the weight share and the
 * volume share of that vehicle — because a half-full truck still costs a truck — and never below the
 * rung's minimum charge.
 */
export function quoteOnLadder({ weightKg, cbm, distanceKm, rungCode = null }) {
  const kg = Number(weightKg);
  const m3 = Number(cbm);
  const km = Number(distanceKm);
  if (!(kg > 0)) throw new RangeError("a load needs a weight above zero");
  if (!(m3 > 0)) throw new RangeError("a load needs a volume above zero");
  if (!(km > 0)) throw new RangeError("a distance above zero is required");

  let rung = rungCode ? rungByCode.get(rungCode) : null;
  if (rungCode && !rung) throw new RangeError(`unknown rung "${rungCode}" — known rungs are ${RUNGS.map((r) => r.code).join(", ")}`);

  const fits = (r) => kg <= r.payloadKg && m3 <= r.volumeM3;
  if (!rung) rung = RUNGS.find(fits) ?? null;
  if (!rung) {
    throw new RangeError(
      `the load is larger than a 30-tonne unit — ${kg} kg and ${m3} m3 against ${RUNGS[RUNGS.length - 1].payloadKg} kg and ${RUNGS[RUNGS.length - 1].volumeM3} m3. Split it or send a convoy.`,
    );
  }
  if (!fits(rung)) {
    const next = RUNGS.find((r) => fits(r));
    throw new RangeError(
      next
        ? `the load does not fit ${rung.code} (${rung.payloadKg} kg / ${rung.volumeM3} m3); the next rung that carries it is ${next.code}`
        : `the load does not fit ${rung.code}, and nothing above it carries it either — split the load`,
    );
  }

  const fullVehicle = rung.kesPerKm * km;
  const weightShare = kg / rung.payloadKg;
  const volumeShare = m3 / rung.volumeM3;
  const share = Math.max(weightShare, volumeShare);
  const payable = Math.max(fullVehicle * share, minimumCharge(rung));

  return {
    rung,
    distanceKm: km,
    fullVehicleKes: round(fullVehicle, 2),
    shareUsed: round(share, 4),
    basisOfShare: weightShare >= volumeShare ? "weight" : "volume",
    payableKes: Math.round(payable / 10) * 10,
    perTonneKes: round((Math.round(payable / 10) * 10) / (kg / 1000), 0),
    perCbmKes: round((Math.round(payable / 10) * 10) / m3, 0),
    utilisation: {
      weightPct: round(weightShare * 100, 1),
      volumePct: round(volumeShare * 100, 1),
    },
    nextRung: RUNGS[RUNGS.indexOf(rung) + 1]?.code ?? null,
    currency: KES,
    basis: `planning rate ${rung.kesPerKm} KES/km for the whole ${rung.code}; replace with a signed carrier rate before issuing`,
  };
}

/**
 * The whole ladder priced for one load, so the client can see that the small unit is cheaper and that
 * the big one is not an upsell.
 */
export function ladderFor({ weightKg, cbm, distanceKm }) {
  const rows = [];
  for (const rung of RUNGS) {
    if (weightKg > rung.payloadKg || cbm > rung.volumeM3) {
      rows.push({ code: rung.code, label: rung.label, fits: false, reason: `carries ${rung.payloadKg} kg / ${rung.volumeM3} m3` });
      continue;
    }
    const q = quoteOnLadder({ weightKg, cbm, distanceKm, rungCode: rung.code });
    rows.push({
      code: rung.code,
      label: rung.label,
      fits: true,
      payableKes: q.payableKes,
      perTonneKes: q.perTonneKes,
      perCbmKes: q.perCbmKes,
      utilisation: q.utilisation,
      isSmallestFit: false,
    });
  }
  const firstFit = rows.find((r) => r.fits);
  if (firstFit) firstFit.isSmallestFit = true;
  return { rows, recommended: firstFit?.code ?? null };
}

/**
 * The chain a shipment actually walks, and who owns each step.
 *
 * `where` says whether the desk runs the step itself ("desk"), an agency or institution does
 * ("agency"), or the client does ("client"). A green tick means the desk has the fields, the
 * checklist and the document for that step and can run it today — it never means an agency has
 * approved anything, because that is the agency's record, not ours.
 */
export const STAGES = Object.freeze(
  [
    { code: "onboard", label: "Onboarding and KYC", where: "desk", green: true, note: "Client, consignee and cargo captured once; reused on every document." },
    { code: "pack", label: "Packing guide and measurement", where: "desk", green: true, note: "Box-shape check, cubic metres, chargeable weight, the rung that carries it." },
    { code: "source", label: "Sourcing and supplier RFQ", where: "desk", green: true, note: "Three quotes, landed cost, one recommendation." },
    { code: "trade_finance", label: "Trade finance and escrow", where: "agency", green: true, note: "Structured on the desk, funded and held by the bank or the escrow partner. Institution onboarding is theirs." },
    { code: "book", label: "Booking and vehicle match", where: "desk", green: true, note: "Rung chosen, carrier confirmed, sailing or truck slot held." },
    { code: "coo", label: "Certificate of Origin", where: "agency", green: true, note: "Application prepared here, issued by the chamber of commerce." },
    { code: "pvoc", label: "PVoC / standards inspection", where: "agency", green: true, note: "Route, standard and inspection point named; certificate issued by the appointed inspectorate." },
    { code: "weighbridge", label: "Weighbridge compliance", where: "agency", green: true, note: "Axle and gross limits checked against the route before dispatch; ticket recorded against the load." },
    { code: "export_docs", label: "Export documentation", where: "desk", green: true, note: "Invoice, packing list, certificate of origin application, permit set." },
    { code: "clearance", label: "Customs clearance", where: "desk", green: true, note: "Entry prepared and lodged through a licensed agent; duty and VAT computed from the tariff." },
    { code: "border", label: "Border and revenue authority", where: "agency", green: true, note: "KRA or URA, as the crossing requires; reference recorded against the job." },
    { code: "standards", label: "KEBS / UNBS release", where: "agency", green: true, note: "Standards release recorded before the cargo leaves the border." },
    { code: "express", label: "Express-window compliance", where: "desk", green: true, note: "Deadline arithmetic per stage; a missed window is flagged before it is missed." },
    { code: "sacco", label: "SACCO membership and financing", where: "agency", green: true, note: "Member onboarding, savings and credit handled by the SACCO; the desk links the job to it." },
    { code: "last_mile", label: "Last mile", where: "desk", green: true, note: "Rung from boda boda upward, proof of delivery at each handover." },
    { code: "signoff", label: "Client signs the delivery form", where: "client", green: true, note: "Signature, name and time captured against the job; the job closes on it, not before." },
  ].map((s) => Object.freeze(s)),
);

/** Stage states, so a screen cannot invent a fifth one. */
export const STAGE_STATES = Object.freeze({
  done: "done",
  current: "current",
  waiting: "waiting",
  blocked: "blocked",
});

/**
 * Where a job has got to, from the stages it has actually completed. A stage marked done without a
 * reference is a data error, not progress, so it is reported as blocked rather than green.
 */
export function stageBoard({ completed = [], blocked = [], current = null } = {}) {
  const done = new Set(completed);
  const stopped = new Set(blocked);
  const rows = STAGES.map((stage) => {
    let state = STAGE_STATES.waiting;
    if (stopped.has(stage.code)) state = STAGE_STATES.blocked;
    else if (done.has(stage.code)) state = STAGE_STATES.done;
    else if (stage.code === current) state = STAGE_STATES.current;
    return { ...stage, state };
  });
  return {
    rows,
    done: rows.filter((r) => r.state === STAGE_STATES.done).length,
    total: rows.length,
    complete: rows.every((r) => r.state === STAGE_STATES.done),
  };
}
