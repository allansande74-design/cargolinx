/**
 * Operator policy values — the trade rule, in one place.
 *
 * Kept in its own module so a build can substitute sample values for the public demo
 * without touching a line of engine logic: the demo build swaps this file for
 * src/policy-values.demo.mjs, and nothing else changes. The CLI, the tests and the
 * operator side always read this one.
 */
export const POLICY_VALUES = {
  targetMargin: 0.30,
  minMargin: 0.15,
  negotiationRoom: 0.05,
  marketHeadroom: 0.05,
  maxMargin: 0.40,
  maxQuoteValidityDays: 30,
  fxMaxAgeHours: 24,
};
