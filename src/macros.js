// Two macro axes, after the monome Arc: a handful of parameters is not an
// instrument, so each knob drives a whole ecosystem instead of one value.
//
// The important property is that macros are RELATIVE TO A CAPTURED BASE STATE.
// You dial in a patch, capture it, and both knobs at centre reproduce it
// exactly. Turning pushes the whole cluster outward in one direction and back
// through your patch in the other — the knobs orbit your starting point rather
// than overwriting it.

const PHI = (1 + Math.sqrt(5)) / 2;

/** Rational slope: the mask repeats every 8 steps. */
export const LOCK_ALPHA = 5 / 8;
/** 1/phi: never closes. */
export const FREE_ALPHA = 1 / PHI;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** v=0 -> lo, v=0.5 -> base, v=1 -> hi. The captured patch sits at centre. */
function pivot(v, lo, base, hi) {
  return v <= 0.5
    ? lo + (base - lo) * (v * 2)
    : base + (hi - base) * ((v - 0.5) * 2);
}

export const MACROS = {
  space: {
    name: 'Space',
    hint: 'holes ↔ saturation',
    color: '#5ad2ff',
    abs: {
      depthKeep: [0.35, 1.0],
      radiusGate: [0.45, 0],
      density: [0.20, 1.0],
      gate: [0.10, 0.90],
      velMin: [70, 30],
    },
  },
  energy: {
    name: 'Energy',
    hint: 'still ↔ violent',
    color: '#ffb454',
    abs: {
      ecc: [0, 0.72],
      lensRadius: [0, 0.90],
      timing: [0.05, 0.55],
      velMax: [90, 127],
      octaveSpan: [1, 3],
    },
    // multiplied against the captured value rather than replacing it, so the
    // patch's own tempo relationship survives
    mul: { eyeRate: [0.40, 2.20] },
  },
};

const INTS = new Set(['velMin', 'velMax', 'octaveSpan']);
const LIMITS = {
  depthKeep: [0.1, 1], radiusGate: [0, 0.9], density: [0.05, 1], gate: [0.05, 1],
  velMin: [1, 127], velMax: [1, 127], ecc: [0, 0.85], lensRadius: [0, 1.5],
  timing: [0, 1], octaveSpan: [1, 5], eyeRate: [0, 2],
};

/** Every parameter the two macros write, for UI refresh. */
export const MACRO_TARGETS = [...new Set(
  Object.values(MACROS).flatMap((m) => [...Object.keys(m.abs || {}), ...Object.keys(m.mul || {})]),
)];

/** @param {{space:number, energy:number}} values each in [0,1], 0.5 = the base patch */
export function applyMacros(base, values) {
  const out = { ...base };
  for (const [key, m] of Object.entries(MACROS)) {
    const v = clamp(values[key] ?? 0.5, 0, 1);
    for (const [param, [lo, hi]] of Object.entries(m.abs || {})) {
      out[param] = pivot(v, lo, base[param], hi);
    }
    for (const [param, [lo, hi]] of Object.entries(m.mul || {})) {
      out[param] = base[param] * pivot(v, lo, 1, hi);
    }
  }
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (out[k] === undefined) continue;
    out[k] = clamp(out[k], lo, hi);
    if (INTS.has(k)) out[k] = Math.round(out[k]);
  }
  if (out.velMin > out.velMax) { const t = out.velMin; out.velMin = out.velMax; out.velMax = t; }
  return out;
}
