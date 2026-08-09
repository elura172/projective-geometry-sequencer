// Two-body motion under an inverse-square central force. The mass sits at the
// origin — where the solid is — and the eyes fall into elliptical orbits around
// it instead of being carried on kinematic circles.
//
// The musical payload is Kepler's second law: equal areas in equal times, so
// angular velocity is NOT constant. The eye sweeps fast at perihelion and slow
// at aphelion, in the exact ratio ((1+e)/(1-e))^2 — 3.45x at e=0.3, 16x at
// e=0.6. Since the perspective divide is distance-sensitive too, closest
// approach delivers maximum sweep rate and maximum warp at the same instant.

const TAU = Math.PI * 2;

/**
 * Solve Kepler's equation M = E - e·sin(E) for the eccentric anomaly E.
 * Newton-Raphson; converges in a handful of steps for e < 0.9.
 */
export function eccentricAnomaly(M, e, iters = 12) {
  const m = ((M % TAU) + TAU) % TAU;
  if (e <= 0) return m;
  let E = e < 0.8 ? m + e * Math.sin(m) : Math.PI;
  for (let i = 0; i < iters; i++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const d = f / (Math.abs(fp) < 1e-12 ? 1e-12 : fp);
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/**
 * Full orbital state at mean anomaly M, for semi-major axis a, eccentricity e
 * and mean motion n (radians of *mean* anomaly per second).
 *
 * At e = 0 this reduces exactly to r = a and nu = M — the circular orbit the
 * system used before gravity existed.
 */
export function orbitState(a, e, n, M) {
  const E = eccentricAnomaly(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const r = a * (1 - e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
  // specific angular momentum. Kepler's third law gives GM = n^2 a^3, so
  // L = sqrt(GM·a(1-e^2)) = n·a^2·sqrt(1-e^2) — constant over the orbit.
  const L = n * a * a * Math.sqrt(1 - e * e);
  const rr = Math.max(r, 1e-9);
  return {
    r, nu, E, L,
    x: r * Math.cos(nu),
    y: r * Math.sin(nu),
    dnu: L / (rr * rr),   // true angular velocity — this is what varies
    peri: a * (1 - e),
    apo: a * (1 + e),
  };
}

/** GM implied by an orbit, via Kepler's third law. */
export function impliedGM(a, n) { return n * n * a * a * a; }

/** Ratio of angular sweep rate at perihelion to that at aphelion. */
export function sweepRatio(e) {
  const d = 1 - e;
  return d > 1e-9 ? ((1 + e) / d) ** 2 : Infinity;
}
