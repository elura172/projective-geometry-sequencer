// Named starting points. Each preset is a set of overrides applied ON TOP OF
// DEFAULT_PARAMS, so every preset is a complete statement — switching between
// them never leaves a stray parameter behind from the last one.
//
// Adding your own: copy a block, change what you want, give it a name. The
// keys are exactly the parameter names in sequencer.js DEFAULT_PARAMS. See
// RECIPES.md for the density law and the reasoning behind these numbers.

import { SPEC_LITERAL } from './sequencer.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const w = (base) => ({ wx: base, wy: base * Math.SQRT2, wz: base * PHI });

/** Shared by the deep-techno family: 130 BPM, 1/16, tight timing, radius velocity. */
const TECHNO = {
  bpm: 130, gridN: 16, velocitySource: 'radius', radiusGate: 0,
  tilt: 0.5, lensRadius: 0.25, alpha: 1 / PHI, eyeSpread: 0.382,
  lattice: true, velMin: 40, velMax: 122,
};

export const PRESETS = {
  'Default': {},

  'Spec-literal': { ...SPEC_LITERAL },

  // --- deep techno ------------------------------------------------------
  // Measured densities are in RECIPES.md. Remember the density law: total
  // notes ~= vertices x eyes, regardless of how many bars the loop runs.

  'Techno · bass': {
    ...TECHNO, ...w(0.05),
    solid: 'cube', nEyes: 2, bars: 2,
    scale: 'custom', customDegrees: [0, 3, 5, 7, 10],
    baseNote: 36, octaveSpan: 1, eyeTranspose: [0, 0, 0, 0],
    gate: 0.45, timing: 0.10, depthKeep: 0.9, density: 0.7,
    eyeRadius: 3.0, eyeRate: 0.075, ecc: 0.35, phasonRate: 0.004,
  },

  'Techno · stab': {
    ...TECHNO, ...w(0.06),
    solid: 'dodecahedron', nEyes: 3, bars: 4,
    scale: 'custom', customDegrees: [0, 3, 5, 7, 10],
    baseNote: 57, octaveSpan: 2, eyeTranspose: [0, 0, -12, 0],
    gate: 0.20, timing: 0.12, depthKeep: 0.72, density: 0.6,
    eyeRadius: 2.4, eyeRate: 0.06, ecc: 0.45, phasonRate: 0.005,
  },

  'Techno · drums': {
    ...TECHNO, ...w(0.09),
    solid: 'icosahedron', nEyes: 4, bars: 4,
    scale: 'drum',
    gate: 0.12, timing: 0.15, depthKeep: 0.68, density: 0.55,
    // r 2.3 at e 0.5 puts perihelion at 1.15, just clear of the circumradius —
    // any tighter and the eye grazes the form and trips the blowout warning
    eyeRadius: 2.3, eyeRate: 0.11, ecc: 0.5, phasonRate: 0.008,
    velMin: 55, velMax: 127,
  },

  // Rational slope: the mask genuinely repeats (period 8 steps = half a bar),
  // which is the hypnotic bed you run the aperiodic voices on top of.
  'Techno · locked': {
    ...TECHNO, ...w(0.07),
    solid: 'cube', nEyes: 3, bars: 2,
    scale: 'custom', customDegrees: [0, 3, 5, 7, 10],
    baseNote: 36, octaveSpan: 2, eyeTranspose: [0, 12, 24, 0],
    gate: 0.40, timing: 0.08, depthKeep: 1.0, density: 0.75,
    alpha: 5 / 8, phasonRate: 0, eyeSpread: 0.125,
    eyeRadius: 2.8, eyeRate: 0.09, ecc: 0.3,
  },

  // --- other territory --------------------------------------------------

  // Long orbits, wide gates, no lattice: the original instrument, breathing.
  'Ambient · slow orbit': {
    ...w(0.02),
    solid: 'dodecahedron', nEyes: 3, bars: 4, bpm: 76, gridN: 8,
    scale: 'pentatonic', baseNote: 48, octaveSpan: 3,
    gate: 0.95, timing: 0.5, depthKeep: 0.85, radiusGate: 0,
    velocitySource: 'approach', velMin: 30, velMax: 100,
    eyeRadius: 3.4, eyeRate: 0.03, ecc: 0.55, lensRadius: 0.2,
    lattice: false,
  },

  // Hard eccentricity, perihelion inside the form, caustic accents.
  'Close encounter': {
    ...w(0.14),
    solid: 'octahedron', nEyes: 2, bars: 1, bpm: 140, gridN: 16,
    scale: 'custom', customDegrees: [0, 1, 6, 7], baseNote: 42, octaveSpan: 3,
    gate: 0.25, timing: 0.3, depthKeep: 1, radiusGate: 0,
    velocitySource: 'magnification', velMin: 45, velMax: 127,
    eyeRadius: 1.9, eyeRate: 0.28, ecc: 0.72, lensRadius: 0.8,
    lattice: true, alpha: Math.SQRT2 - 1, density: 0.8, phasonRate: 0.02,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);
