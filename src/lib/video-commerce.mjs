/**
 * Video commerce: a product is sold by a short film, and the purchase is a single click on the film.
 *
 * The rules this module stands behind:
 *  - Meta tooling does the sensing: Muse Image renders the poster frame, Muse Voice Transcription
 *    turns the seller's spoken pitch into words, SAM 3.1 counts and segments the goods shown, and
 *    Muse Wonder writes the offer from those facts. No catalogue entry is typed by hand.
 *  - Only a product with a real film can be sold this way: a poster without the film, a film without
 *    a poster, or a transcript that says nothing are refused, because a clip that cannot be checked
 *    cannot be sold.
 *  - The price on the film is the quote: it comes from the landed engine and cannot be typed over.
 */
import { landedCost, quote } from "../../engine/landed.mjs";

export const VIDEO_SOURCES = Object.freeze({
  poster: Object.freeze({ tool: "muse-image-1.0", does: "renders the poster frame from the brief" }),
  transcript: Object.freeze({ tool: "muse-voice-transcribe-1.0", does: "turns the spoken pitch into words" }),
  goods: Object.freeze({ tool: "sam-3.1", does: "counts and segments the goods shown in the film" }),
  offer: Object.freeze({ tool: "muse-wonder-1.0", does: "writes the offer language from the facts" }),
  decision: Object.freeze({ tool: "muse-spark-1.3", does: "routes the viewer's click to the right order step" }),
});

const MIN_TRANSCRIPT_WORDS = 8;

/** Words of speech Muse Voice Transcription can find in the pitch, or nothing. */
export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Is this film fit to sell from? Every blocker is named, never an exception, so a seller can fix
 * them in one pass. `product` carries the consignment for the landed cost engine.
 */
export function checkFilm({ product, posterRef, filmRef, transcript, countedUnits } = {}) {
  const blockers = [];
  if (!product || typeof product !== "object") blockers.push("product_required");
  if (!posterRef) blockers.push("poster_required");
  if (!filmRef) blockers.push("film_required");
  if (countWords(transcript) < MIN_TRANSCRIPT_WORDS) blockers.push("transcript_too_short");
  if (!(Number(countedUnits) > 0)) blockers.push("goods_not_counted");
  return { ok: blockers.length === 0, blockers };
}

/** The price on the film: from the landed engine, marked up, at least ten percent under wholesale. */
export function filmPrice({ product, marginPct = 0.3, wholesaleKes }) {
  const landed = landedCost(product);
  const q = quote(landed, { marginPct: Number(marginPct) });
  const quantity = Math.max(1, Number(product?.quantity) || 1);
  return {
    landedPerUnitKes: landed.totals.perUnit,
    priceKes: Math.round((q.priceIncVat / quantity) * 100) / 100,
    priceExVatKes: Math.round((q.price / quantity) * 100) / 100,
    marginPct,
    wholesaleKes: Number(wholesaleKes) || null,
    underWholesale: Number(wholesaleKes) > 0 ? Math.round((q.priceIncVat / quantity) * 100) / 100 <= Number(wholesaleKes) * 0.9 : null,
  };
}
