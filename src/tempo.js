// Optional tempo sync.
//
// By default the geometry runs on wall-clock seconds (wx, eyeRate and
// phasonRate are per-SECOND) while the grid runs on musical time. The two
// clocks share an origin and nothing else, exactly as the spec asks: patterns
// drift across bar lines and never close.
//
// With tempoSync on, those same parameters are read as cycles per BAR. Since
// step time is bar/gridN, the product rate x time works out to
//
//     wx · 2π · cell / gridN
//
// with the bar length cancelling — so the pattern becomes exactly tempo
// invariant, and rational rates return to their starting orientation after a
// countable number of bars.

import { eyeRateFor } from './eyes.js';

export function barSeconds(p) { return (60 / p.bpm) * 4; }

/** Every rate in per-second terms, whatever units the params are stored in. */
export function effectiveRates(p) {
  if (!p.tempoSync) {
    return { wx: p.wx, wy: p.wy, wz: p.wz, eyeRate: p.eyeRate, phasonRate: p.phasonRate };
  }
  const bar = barSeconds(p);
  const k = (2 * Math.PI) / bar;   // turns per bar -> radians per second
  return {
    wx: p.wx * k, wy: p.wy * k, wz: p.wz * k,
    eyeRate: p.eyeRate * k,
    phasonRate: p.phasonRate / bar, // window units per bar -> per second
  };
}

/** Convert a stored rate set between the two interpretations, preserving motion. */
export function convertRates(p, toSync) {
  const k = (2 * Math.PI) / barSeconds(p);
  const bar = barSeconds(p);
  const s = toSync ? 1 / k : k;
  return {
    wx: p.wx * s, wy: p.wy * s, wz: p.wz * s, eyeRate: p.eyeRate * s,
    phasonRate: toSync ? p.phasonRate * bar : p.phasonRate / bar,
  };
}

/**
 * Cycles-per-bar values whose denominators all divide 48. Two properties matter
 * and they pull against each other:
 *
 *  - bounded closure. Every denominator dividing 48 means the LCM cannot run
 *    away, even after the eye ratios divide the base rate by up to 4.
 *  - fine enough not to collapse distinct rates. A coarse ladder snaps wy and
 *    wz onto the same value and flattens the rotation; 48's divisors keep the
 *    spacing under ~0.02 through the useful range.
 */
export const RATE_LADDER = (() => {
  const denoms = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48];
  const seen = new Map();
  for (const q of denoms) {
    for (let p = 1; p <= 2 * q; p++) {
      const v = p / q;
      if (v < 1 / 48 - 1e-12 || v > 2 + 1e-12) continue;
      // keep the smallest denominator representing each value
      if (!seen.has(v) || seen.get(v)[1] > q) seen.set(v, [p, q]);
    }
  }
  return [...seen.values()].sort((a, b) => a[0] / a[1] - b[0] / b[1]);
})();

/**
 * Nearest ladder value to x (sign preserved). `exclude` holds values already
 * taken — at slow rates the ladder is genuinely sparse (below 1/24 the only
 * rungs are 1/32, 1/48, 1/96), so two nearby rotation rates would otherwise
 * merge onto one rung and the solid would stop tumbling. Skipping taken rungs
 * trades a little accuracy for keeping the axes distinct.
 */
export function snapToLadder(x, exclude = null) {
  const a = Math.abs(x);
  if (a < 1e-9) return 0;
  let best = null, bestErr = Infinity;
  for (const [p, q] of RATE_LADDER) {
    const v = p / q;
    if (exclude && exclude.has(v)) continue;
    const err = Math.abs(a - v);
    if (err < bestErr) { bestErr = err; best = v; }
  }
  return Math.sign(x) * (best ?? RATE_LADDER[0][0] / RATE_LADDER[0][1]);
}

/**
 * Exact-ish fraction for x, or null if none within tolerance. Continued
 * fractions rather than a scan over denominators: the eye ratios divide the
 * base rate by up to 4, so the denominators that must be reachable are several
 * times larger than any rate the user actually sets.
 */
export function rationalize(x, maxDen = 8192, tol = 1e-9) {
  const a = Math.abs(x);
  let p0 = 0, q0 = 1, p1 = 1, q1 = 0, v = a;
  for (let i = 0; i < 64; i++) {
    const ai = Math.floor(v);
    const p2 = ai * p1 + p0, q2 = ai * q1 + q0;
    if (q2 > maxDen || !isFinite(q2)) break;
    p0 = p1; q0 = q1; p1 = p2; q1 = q2;
    if (q1 > 0 && Math.abs(a - p1 / q1) <= tol) return { p: p1, q: q1 };
    const rem = v - ai;
    if (rem < 1e-13) break;
    v = 1 / rem;
  }
  return (q1 > 0 && Math.abs(a - p1 / q1) <= tol) ? { p: p1, q: q1 } : null;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

/**
 * When does everything realign? Each rational rate returns after its
 * denominator in bars; the quasilattice returns after its own period in steps;
 * the loop returns after its cell count. Closure is the LCM of all of them.
 *
 * @returns {{closes:boolean, bars?:number, steps?:number, blocked?:string}}
 */
export function closure(p, latticePeriodSteps = null, limitSteps = 1 << 20) {
  if (!p.tempoSync) return { closes: false, blocked: 'tempo-sync off (rates are wall-clock)' };

  const N = p.gridN;
  const terms = [p.gridN * p.bars];   // the loop itself
  const check = [
    ['ωx', p.wx], ['ωy', p.wy], ['ωz', p.wz],
    ['phason', p.lattice ? p.phasonRate : 0],
  ];
  // Every eye separately: the spec's phi rate ratios are irrational by design,
  // so a multi-eye rig cannot close no matter how rational the base rate is.
  // Eye rates must be 'rational' for closure with more than one eye.
  for (let i = 0; i < p.nEyes; i++) {
    check.push([`eye ${i + 1}`, eyeRateFor(i, p.eyeRate, p.eyeRadius, p.eyeRates)]);
  }
  for (const [label, v] of check) {
    if (Math.abs(v) < 1e-12) continue;      // stationary is trivially closed
    const f = rationalize(v);
    if (!f) return { closes: false, blocked: `${label} = ${v.toPrecision(6)} is not rational` };
    terms.push(f.q * N);
  }
  if (p.lattice && latticePeriodSteps) terms.push(latticePeriodSteps);
  else if (p.lattice && latticePeriodSteps === null) {
    return { closes: false, blocked: 'quasilattice slope is irrational' };
  }

  let steps = terms.reduce((a, b) => lcm(a, b), 1);
  if (!isFinite(steps) || steps > limitSteps) return { closes: false, blocked: `longer than ${Math.round(limitSteps / N)} bars` };
  return { closes: true, steps, bars: steps / N };
}
