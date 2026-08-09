// Cut-and-project: a 1D quasilattice made by slicing the 2D integer lattice
// with a line of irrational slope and keeping only the lattice points whose
// perpendicular coordinate falls inside a window.
//
// Step k is accepted iff  frac(k·α + ρ) < density.
//
// That one line IS the projection: frac(k·α + ρ) is the internal-space
// (perpendicular) coordinate of lattice point (k, −floor(k·α + ρ)), and
// [0, density) is the acceptance domain. The period lives upstairs in Z², where
// the lattice is perfectly periodic; downstairs you hear order without
// repetition.
//
//   α        irrational -> quasiperiodic: never repeats, but perfectly ordered
//            rational p/q -> genuinely periodic, with period exactly q
//   density  the fraction of steps accepted — equals the onset density exactly,
//            and is independent of α
//   ρ        phason shift. Sliding the window yields a different sequence that
//            is *locally indistinguishable* from the original — same statistics,
//            rearranged. Drift it and the pattern reconfigures continuously
//            without ever changing character.

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * The rational entries are the Fibonacci convergents of 1/φ. Walking down the
 * list is literally walking the continued fraction toward the aperiodic limit:
 * the period doubles and redoubles, expectation gets harder to hold, and at
 * 1/φ it never closes at all.
 */
export const SLOPE_PRESETS = [
  { name: '1/2 — period 2', value: 1 / 2 },
  { name: '2/3 — period 3', value: 2 / 3 },
  { name: '3/5 — period 5', value: 3 / 5 },
  { name: '5/8 — period 8', value: 5 / 8 },
  { name: '8/13 — period 13', value: 8 / 13 },
  { name: '1/φ — Fibonacci, aperiodic', value: 1 / PHI },
  { name: '1/φ² — aperiodic', value: 1 / (PHI * PHI) },
  { name: '√2−1 — Pell, aperiodic', value: Math.SQRT2 - 1 },
];

const frac = (x) => x - Math.floor(x);

/** Is step k inside the acceptance window? */
export function accepts(k, alpha, density, rho) {
  if (density >= 1) return true;
  if (density <= 0) return false;
  return frac(k * alpha + rho) < density;
}

/**
 * Gap structure of the accepted set. By the three-distance theorem the gaps
 * between successive onsets take at most three distinct values, for any α and
 * any window — that bounded gap alphabet is exactly the "order" in "ordered
 * but aperiodic", and it is what the ear latches onto.
 */
export function gapStats(alpha, density, rho, count = 144) {
  const onsets = [];
  for (let k = 0; k < count; k++) if (accepts(k, alpha, density, rho)) onsets.push(k);
  const gaps = [];
  for (let i = 1; i < onsets.length; i++) gaps.push(onsets[i] - onsets[i - 1]);
  return {
    onsets: onsets.length,
    gaps,
    distinct: [...new Set(gaps)].sort((a, b) => a - b),
  };
}

/**
 * Smallest period of the accepted sequence, or null if none is found within
 * `limit` — which is the honest report for an irrational slope, since none
 * exists at any length.
 */
export function detectPeriod(alpha, density, rho, limit = 64, probe = 400) {
  for (let q = 1; q <= limit; q++) {
    let ok = true;
    for (let k = 0; k < probe; k++) {
      if (accepts(k, alpha, density, rho) !== accepts(k + q, alpha, density, rho)) { ok = false; break; }
    }
    if (ok) return q;
  }
  return null;
}
