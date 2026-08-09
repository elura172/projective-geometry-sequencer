// The cascade: 3D form -> 2D circle -> 1D grid.

import { SOLIDS, rotateVerts } from './geometry.js';
import { eyePositions, eyeStates } from './eyes.js';
import { projectVertices } from './project.js';
import { getScale, depthToNote, mapVelocity, drumNote, DEFAULT_DRUM_MAP } from './scale.js';
import { accepts } from './quasilattice.js';
import { effectiveRates } from './tempo.js';

export const DEFAULT_PARAMS = {
  solid: 'dodecahedron',
  nEyes: 2,
  eyeRadius: 2.4,      // warp intensity: smaller = harder perspective
  eyeRate: 0.35,       // rad/s for eye 0
  tilt: 0.35,          // orbital-plane tilt, radians
  // rotation rates, irrational ratios 1 : sqrt2 : phi. Units depend on
  // tempoSync: radians/second when off, cycles per BAR when on.
  wx: 0.20,
  wy: 0.20 * Math.SQRT2,
  wz: 0.20 * (1 + Math.sqrt(5)) / 2,
  tempoSync: false,    // off = spec behaviour: geometry on wall-clock seconds
  gridN: 16,           // cells per bar
  bars: 1,
  bpm: 120,
  scale: 'native',
  customDegrees: [0, 3, 5, 7, 10],
  baseNote: 48,
  octaveSpan: 2,
  // semitone offset per eye, so one pass can carry a bass and a stab two
  // octaves up instead of forcing every voice into one register
  eyeTranspose: [0, 0, 0, 0],
  drumMap: DEFAULT_DRUM_MAP,
  velMin: 1,       // velocity window. 1..127 is the raw spec mapping; raising
  velMax: 127,     // the floor keeps quiet notes audible in a drum rack
  projMode: 'view',    // 'view' | 'worldz' (spec-literal)
  gate: 0.5,           // note length as a fraction of one grid step

  // --- groove ---------------------------------------------------------
  // How much of the geometric micro-timing survives quantization.
  // 0 = hard on the grid (spec-literal), 1 = raw geometric position.
  timing: 0.35,
  // Moving rests. Vertices are dropped when they fall on the far side of the
  // form (depth) or too close to the projection axis (radius); as the solid
  // turns, the holes move — which is what makes a pattern a groove.
  depthKeep: 0.8,      // keep normalized depth <= this  (1 = keep all)
  radiusGate: 0,       // keep normalized radius >= this (0 = keep all)
  // What drives velocity. 'angle' is the spec, and pins the accent contour to
  // grid position forever; the other two rotate with the form.
  velocitySource: 'radius', // 'angle' | 'radius' | 'approach' | 'magnification'

  // --- gravity --------------------------------------------------------
  // One mass at the origin, where the solid is. It governs the eyes' orbits
  // AND bends their rays — the same physical object doing both jobs.
  ecc: 0.35,           // orbital eccentricity; 0 = the old circular orbits
  eyeRates: 'phi',     // 'phi' (spec) | 'kepler' (3rd law) | 'rational' (closes)
  lensRadius: 0.35,    // Einstein radius; 0 = no lensing

  // --- quasilattice (cut-and-project) ---------------------------------
  // A rhythmic mask projected down from a periodic 2D lattice. The projective
  // geometry still decides pitch, velocity and which vertex; this decides
  // whether a voice speaks at all on a given step.
  lattice: true,
  alpha: 1 / ((1 + Math.sqrt(5)) / 2), // slope: 1/φ, aperiodic
  density: 0.618,      // window width = fraction of steps accepted
  rho: 0,              // phason shift
  phasonRate: 0.012,   // phason drift per second — the pattern reconfigures
  eyeSpread: 0.382,    // per-eye phason offset: same lattice, different slice
};

/** The settings that reproduce the spec exactly, with no groove processing. */
export const SPEC_LITERAL = {
  timing: 0, depthKeep: 1, radiusGate: 0, velocitySource: 'angle',
  projMode: 'worldz', lattice: false, ecc: 0, lensRadius: 0,
};

export function totalCells(p) { return p.gridN * p.bars; }
export function stepSeconds(p) { return (60 / p.bpm) * 4 / p.gridN; }
export function loopSeconds(p) { return stepSeconds(p) * totalCells(p); }

const SPREAD_EPS = 1e-9;
/** Lookahead used to measure how fast a vertex is rushing the eye. */
const APPROACH_H = 1 / 240;

/**
 * Depth -> note. The drum map bypasses scale, octave span and transpose
 * entirely: those concepts do not apply to a percussion slot.
 */
function noteFor(p, wNorm, w, wMin, wMax, degrees, eye) {
  if (p.scale === 'drum') return drumNote(wNorm, p.drumMap || DEFAULT_DRUM_MAP);
  const semis = (p.eyeTranspose && p.eyeTranspose[eye]) || 0;
  const n = depthToNote(w, wMin, wMax, p.baseNote, p.octaveSpan, degrees) + semis;
  return Math.max(0, Math.min(127, Math.round(n)));
}

function normalize(v, lo, hi) {
  const span = hi - lo;
  return span > SPREAD_EPS ? Math.max(0, Math.min(1, (v - lo) / span)) : 0.5;
}

/** Geometry + projection state at time t. Everything downstream reads this. */
export function frameState(p, t) {
  const solid = SOLIDS[p.solid];
  const R = effectiveRates(p);
  const verts = rotateVerts(solid.verts, R.wx * t, R.wy * t, R.wz * t);
  const orbit = { ecc: p.ecc, eyeRates: p.eyeRates };
  const states = eyeStates(p.nEyes, p.eyeRadius, R.eyeRate, p.tilt, t, orbit);
  const eyes = states.map((s) => s.pos);
  const degrees = getScale(p.scale, solid, p.customDegrees);
  const N = totalCells(p);
  const proj0 = { mode: p.projMode, lens: p.lensRadius };

  // second sample, only when velocity is driven by approach speed
  let vertsH = null, eyesH = null;
  if (p.velocitySource === 'approach') {
    const th = t + APPROACH_H;
    vertsH = rotateVerts(solid.verts, R.wx * th, R.wy * th, R.wz * th);
    eyesH = eyePositions(p.nEyes, p.eyeRadius, R.eyeRate, p.tilt, th, orbit);
  }

  const perEye = eyes.map((E, ei) => {
    const proj = projectVertices(verts, E, proj0);
    let wMin = Infinity, wMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const q of proj) {
      if (q.w < wMin) wMin = q.w; if (q.w > wMax) wMax = q.w;
      if (q.r < rMin) rMin = q.r; if (q.r > rMax) rMax = q.r;
    }

    // approach speed: -dw/dt, so a vertex rushing the eye reads loud
    let approach = null, aMin = 0, aMax = 1;
    if (vertsH) {
      const projH = projectVertices(vertsH, eyesH[ei], proj0);
      approach = proj.map((q, i) => -(projH[i].w - q.w) / APPROACH_H);
      aMin = Math.min(...approach); aMax = Math.max(...approach);
    }

    // magnification spans orders of magnitude near the caustic, so map it in log
    let logMu = null, muMin = 0, muMax = 1;
    if (p.velocitySource === 'magnification') {
      logMu = proj.map((q) => Math.log(Math.max(1, q.mu)));
      muMin = Math.min(...logMu); muMax = Math.max(...logMu);
    }

    const hits = proj.map((q, i) => {
      const wNorm = normalize(q.w, wMin, wMax);
      const rNorm = normalize(q.r, rMin, rMax);

      // moving rests: the far side of the form, and the calm centre, stay silent
      const gated = wNorm > p.depthKeep || rNorm < p.radiusGate;

      // the sub-cell remainder the spec discards — this is the geometry's own
      // push-and-pull against the grid, and it is where the groove lives
      const cellF = q.frac * N;
      const cell = Math.min(N - 1, Math.floor(cellF));
      const residual = Math.max(0, Math.min(0.999999, cellF - cell));

      let velNorm;
      if (p.velocitySource === 'radius') velNorm = rNorm;
      else if (p.velocitySource === 'approach') velNorm = normalize(approach[i], aMin, aMax);
      else if (p.velocitySource === 'magnification') velNorm = normalize(logMu[i], muMin, muMax);
      else velNorm = q.frac;

      return {
        vertex: q.index,
        frac: q.frac,
        theta: q.theta,
        radius: q.r,
        w: q.w,
        mu: q.mu,
        wNorm,
        rNorm,
        gated,
        cell,
        residual,
        offset: p.timing * residual,
        velocity: mapVelocity(velNorm, p.velMin, p.velMax),
        note: noteFor(p, wNorm, q.w, wMin, wMax, degrees, ei),
        channel: ei + 1,
      };
    });
    return { eye: ei, position: E, orbit: states[ei], wMin, wMax, rMin, rMax, hits };
  });

  return { solid, verts, eyes, perEye, degrees, states };
}

/** Phason offset for one eye at time t — each eye reads its own slice. */
function eyeRho(p, t, eye) {
  return p.rho + effectiveRates(p).phasonRate * t + eye * p.eyeSpread;
}

/** Does the quasilattice let this eye speak on this absolute step? */
export function latticeOpen(p, t, step, eye) {
  if (!p.lattice) return true;
  return accepts(step, p.alpha, p.density, eyeRho(p, t, eye));
}

/** The mask across one rendered loop, for display. */
export function latticeMask(p, t0, eye = 0) {
  const dt = stepSeconds(p);
  const step0 = Math.round(t0 / dt);
  return Array.from({ length: totalCells(p) }, (_, c) =>
    latticeOpen(p, t0 + c * dt, step0 + c, eye));
}

/**
 * Notes that fire at loop cell `cell`, with the geometry sampled at time t.
 * `step` is the absolute step index since transport zero — the quasilattice is
 * indexed by it, not by cell, so the mask evolves across bars instead of
 * repeating with the loop.
 */
export function cellEvents(p, t, cell, step) {
  const k = step ?? Math.round(t / stepSeconds(p));
  const { perEye } = frameState(p, t);
  const seen = new Set();
  const out = [];
  for (const e of perEye) {
    if (!latticeOpen(p, t, k, e.eye)) continue; // this voice rests
    for (const h of e.hits) {
      if (h.cell !== cell || h.gated) continue;
      // two vertices in one cell with the same pitch on one channel would
      // produce overlapping Note Ons whose first Note Off kills both
      const key = `${h.channel}:${h.note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        channel: h.channel, note: h.note, velocity: h.velocity,
        offset: h.offset, eye: e.eye, vertex: h.vertex,
      });
    }
  }
  return out;
}

/**
 * One full loop rendered ahead of time — each cell sampled at the moment it
 * would sound. Used by the grid view and the .mid export.
 */
/**
 * Concatenate `passes` successive renders of the loop, each sampled at the time
 * it would actually play.
 *
 * This is the way to get a long evolving take. Simply setting a longer loop
 * does NOT give you more notes — total notes are about (vertices x eyes)
 * regardless of loop length, so a 32-bar loop is a 2-bar loop's worth of
 * material spread thin. Eight passes of a 2-bar loop covers the same 16 bars
 * with eight times the notes, and every pass differs because the geometry has
 * turned and the quasilattice has advanced.
 */
export function renderTake(p, t0 = 0, passes = 1) {
  const n = Math.max(1, Math.round(passes));
  const span = loopSeconds(p);
  const out = [];
  for (let k = 0; k < n; k++) out.push(...renderLoop(p, t0 + k * span));
  return out;
}

export function renderLoop(p, t0 = 0) {
  const N = totalCells(p);
  const dt = stepSeconds(p);
  const step0 = Math.round(t0 / dt);
  const cells = [];
  for (let c = 0; c < N; c++) cells.push(cellEvents(p, t0 + c * dt, c, step0 + c));
  return cells;
}
