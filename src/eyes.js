// Orbiting eye-points. Eye 0 is the parent; daughters inherit its orbital
// plane (tilt) at fractal radius/rate ratios.

import { orbitState } from './kepler.js';

const PHI = (1 + Math.sqrt(5)) / 2;

// 1 : phi^-1 : phi^-2 : phi^-3
export const RATE_RATIOS = [1, 1 / PHI, 1 / (PHI * PHI), 1 / (PHI * PHI * PHI)];
export const RADIUS_RATIOS = [1, 1.27, 1.53, 1.79];
// Harmonic alternative. The phi ratios are irrational by design, which means a
// multi-eye rig can never realign no matter how rational the base rate is;
// these can, so tempo-synced closure is reachable with more than one eye.
export const RATE_RATIOS_RATIONAL = [1, 1 / 2, 1 / 3, 1 / 4];

/**
 * Mean motion of eye i.
 *   'phi'      1 : phi^-1 : phi^-2  (the spec's fractal ratios — never closes)
 *   'kepler'   third law, n proportional to a^-3/2, like real satellites
 *   'rational' 1 : 1/2 : 1/3 : 1/4  — closes
 */
export function eyeRateFor(i, baseRate, baseRadius, mode = 'phi') {
  if (mode === 'kepler') {
    return baseRate * (baseRadius / (baseRadius * RADIUS_RATIOS[i])) ** 1.5;
  }
  const table = mode === 'rational' ? RATE_RATIOS_RATIONAL : RATE_RATIOS;
  return baseRate * table[i];
}

export const EYE_COLORS = ['#ffb454', '#5ad2ff', '#c68cff', '#7fe0a8'];

/**
 * Full orbital state for every eye.
 *
 * @param {number} count 1..4
 * @param {number} baseRadius semi-major axis of eye 0 (warp intensity: smaller = more warp)
 * @param {number} baseRate mean motion of eye 0, radians/second
 * @param {number} tilt orbital-plane tilt in radians (0 = equatorial)
 * @param {number} t seconds
 * @param {{ecc?:number, eyeRates?:'phi'|'kepler'|'rational'}} opts
 *        ecc 0 reduces exactly to the circular orbits used before gravity.
 *        eyeRates selects how daughter eyes are spaced in rate; see eyeRateFor.
 */
export function eyeStates(count, baseRadius, baseRate, tilt, t, opts = {}) {
  const ecc = Math.max(0, Math.min(0.95, opts.ecc ?? 0));
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = baseRadius * RADIUS_RATIOS[i];
    const n = eyeRateFor(i, baseRate, baseRadius, opts.eyeRates || 'phi');
    const M = n * t + (i * 2 * Math.PI) / count;
    const s = orbitState(a, ecc, n, M);
    // orbit in the xz-plane, then tilt about the x-axis
    const x = s.x, y = 0, z = s.y;
    out.push({
      pos: [x, y * ct - z * st, y * st + z * ct],
      a, n, r: s.r, nu: s.nu, dnu: s.dnu, L: s.L, peri: s.peri, apo: s.apo,
    });
  }
  return out;
}

export function eyePositions(count, baseRadius, baseRate, tilt, t, opts) {
  return eyeStates(count, baseRadius, baseRate, tilt, t, opts).map((s) => s.pos);
}
