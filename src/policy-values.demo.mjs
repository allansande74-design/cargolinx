/**
 * Sample policy settings for the public demo build.
 *
 * This file replaces engine/policy-values.mjs at build time (see vite.config.js), so the
 * bundle a visitor downloads carries these figures and never the operator's. The demo
 * label on screen says so in words: "Demo workspace — sample policy settings".
 */
export const POLICY_VALUES = {
  targetMargin: 0.25,
  minMargin: 0.15,
  negotiationRoom: 0.03,
  marketHeadroom: 0.05,
  maxMargin: 0.40,
  maxQuoteValidityDays: 30,
  fxMaxAgeHours: 24,
};
