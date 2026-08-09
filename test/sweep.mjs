// Headless math sweep. Run: bun test/sweep.mjs
import { SOLIDS, SOLID_NAMES, rotateVerts } from '../src/geometry.js';
import { eyePositions, eyeStates } from '../src/eyes.js';
import { eccentricAnomaly, orbitState, sweepRatio } from '../src/kepler.js';
import { projectVertices, lensPoint, W_MIN } from '../src/project.js';
import { nativeScale, foldOctave, quantizeToScale, fracToVelocity, depthToNote, DEFAULT_DRUM_MAP } from '../src/scale.js';
import { PRESETS, PRESET_NAMES } from '../src/presets.js';
import { applyMacros } from '../src/macros.js';
import { DEFAULT_PARAMS, SPEC_LITERAL, frameState, renderLoop, renderTake, loopSeconds, totalCells } from '../src/sequencer.js';
import { SLOPE_PRESETS, gapStats, detectPeriod } from '../src/quasilattice.js';
import { effectiveRates, convertRates, snapToLadder, closure, barSeconds, RATE_LADDER } from '../src/tempo.js';
import { clocksPerCell, positionFromClock, clockFromSongPosition, bpmFromTickMs, tickMsFromBpm, updateTickEstimate, CLOCKS_PER_BAR } from '../src/clock.js';
import { MidiIn } from '../src/output.js';

const PHI = (1 + Math.sqrt(5)) / 2;
import { writeMidiFile } from '../src/midifile.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL', msg); } };

// --- solid counts + edge ratios -------------------------------------------
const EXPECTED = {
  tetrahedron: [4, 6], octahedron: [6, 12], cube: [8, 12],
  icosahedron: [12, 30], dodecahedron: [20, 30],
};
console.log('solids:');
for (const name of SOLID_NAMES) {
  const s = SOLIDS[name];
  const [v, e] = EXPECTED[name];
  ok(s.verts.length === v, `${name} verts ${s.verts.length} != ${v}`);
  ok(s.edges.length === e, `${name} edges ${s.edges.length} != ${e}`);
  for (const p of s.verts) ok(Math.abs(Math.hypot(...p) - 1) < 1e-12, `${name} not unit circumradius`);
  console.log(`  ${name.padEnd(13)} V=${s.verts.length} E=${s.edges.length} edge/circumR=${s.edgeRatio.toFixed(4)}  native=[${nativeScale(s.edgeRatio).join(',')}]`);
}

// --- projection sweep: orbit phase 0..2pi x all solids x both modes --------
for (const mode of ['view', 'worldz']) {
  let minSpreadSeen = Infinity, degenerateSteps = 0, total = 0, nan = 0, negW = 0, badFrac = 0;
  for (const name of SOLID_NAMES) {
    const s = SOLIDS[name];
    for (let deg = 0; deg < 360; deg += 5) {
      const t = deg / 360 * 100;
      const verts = rotateVerts(s.verts, 0.2 * t, 0.28 * t, 0.32 * t);
      const eyes = eyePositions(4, 2.4, (2 * Math.PI) / 100, 0.35, t);
      for (const E of eyes) {
        const proj = projectVertices(verts, E, { mode });
        total++;
        let rMin = Infinity, rMax = -Infinity, pinned = 0;
        for (const q of proj) {
          if (!isFinite(q.w) || !isFinite(q.frac) || !isFinite(q.r)) nan++;
          if (q.w <= 0) negW++;
          if (!(q.frac >= 0 && q.frac < 1)) badFrac++;
          if (Math.abs(q.w - W_MIN) < 1e-9) pinned++;
          if (q.r < rMin) rMin = q.r;
          if (q.r > rMax) rMax = q.r;
        }
        const spread = rMax - rMin;
        minSpreadSeen = Math.min(minSpreadSeen, spread);
        if (spread < 1e-3 || pinned > proj.length / 2) degenerateSteps++;
      }
    }
  }
  const label = mode === 'view' ? 'view-basis (default)' : 'spec-literal |Dz|';
  console.log(`\nprojection sweep [${label}] ${total} eye-frames:`);
  console.log(`  NaN=${nan} w<=0=${negW} frac-out-of-range=${badFrac} degenerate=${degenerateSteps} minRadiusSpread=${minSpreadSeen.toExponential(2)}`);
  if (mode === 'view') {
    ok(nan === 0, 'NaN in view-basis projection');
    ok(negW === 0, 'non-positive w in view-basis projection');
    ok(badFrac === 0, 'frac outside [0,1)');
    ok(degenerateSteps === 0, `${degenerateSteps} degenerate eye-frames in view-basis mode`);
  }
}

// --- scale helpers ---------------------------------------------------------
console.log('\nscale:');
ok(foldOctave(0.618) > 1 && foldOctave(0.618) <= 2, 'foldOctave(0.618) not in (1,2]');
ok(foldOctave(1.732) > 1 && foldOctave(1.732) <= 2, 'foldOctave(1.732) not in (1,2]');
ok(quantizeToScale(0, [0, 2, 4, 7, 9]) === 0, 'quantizeToScale root');
ok(quantizeToScale(23.4, [0, 2, 4, 7, 9]) === 24, `quantizeToScale octave-2 got ${quantizeToScale(23.4, [0, 2, 4, 7, 9])}`);
ok(fracToVelocity(0) === 1, 'velocity floor must be 1, not 0 (0 = Note Off)');
ok(fracToVelocity(1 - 1e-9) === 126, 'velocity ceiling');
ok(depthToNote(1, 1, 1, 48, 2, [0, 2, 4, 7, 9]) === 60, 'zero w-spread must not divide by zero');
console.log('  velocity floor=1 ceiling=127, zero-spread guarded');

// --- groove ----------------------------------------------------------------
console.log('\ngroove:');
{
  // micro-timing offsets must stay inside one grid step, or notes cross cells
  let maxOffset = 0, bad = 0;
  for (const src of ['angle', 'radius', 'approach']) {
    for (const timing of [0, 0.35, 1]) {
      const q = { ...DEFAULT_PARAMS, velocitySource: src, timing };
      for (const cell of renderLoop(q, 2.1)) {
        for (const n of cell) {
          if (!(n.offset >= 0 && n.offset < 1)) bad++;
          if (!(n.velocity >= 1 && n.velocity <= 127)) bad++;
          maxOffset = Math.max(maxOffset, n.offset);
        }
      }
    }
  }
  ok(bad === 0, `${bad} out-of-range offset/velocity values`);
  ok(maxOffset > 0, 'micro-timing produced no offsets at all');
  console.log(`  offsets in [0,1), max ${maxOffset.toFixed(5)}; all 3 velocity sources valid`);

  // gating must actually open holes, and must be fully disableable
  const open = renderLoop({ ...DEFAULT_PARAMS, depthKeep: 1, radiusGate: 0 }, 2.1);
  const tight = renderLoop({ ...DEFAULT_PARAMS, depthKeep: 0.45, radiusGate: 0.35 }, 2.1);
  const nOpen = open.reduce((a, c) => a + c.length, 0);
  const nTight = tight.reduce((a, c) => a + c.length, 0);
  ok(nTight < nOpen, `gating did not reduce note count (${nTight} vs ${nOpen})`);
  ok(tight.some((c) => c.length === 0), 'gating produced no empty cells (no rests)');
  console.log(`  gating: ${nOpen} notes open -> ${nTight} gated, ${tight.filter((c) => !c.length).length}/${tight.length} cells now empty`);

  // spec-literal must reproduce the original behaviour exactly
  const spec = renderLoop({ ...DEFAULT_PARAMS, ...SPEC_LITERAL }, 2.1);
  ok(spec.every((c) => c.every((n) => n.offset === 0)), 'spec-literal still has micro-timing');
  console.log(`  spec-literal: ${spec.reduce((a, c) => a + c.length, 0)} notes, all on the grid line`);
}

// --- quasilattice ----------------------------------------------------------
console.log('\nquasilattice (cut-and-project):');
{
  // Three-distance theorem: gaps between accepted steps take at most THREE
  // distinct values, for any slope and any window. This is the structural
  // signature of an ordered-but-aperiodic set; a random mask fails it flatly.
  let worst = 0;
  for (const s of SLOPE_PRESETS) {
    for (const d of [0.15, 0.3, 0.5, 0.618, 0.8]) {
      for (const rho of [0, 0.27, 0.63]) {
        const g = gapStats(s.value, d, rho, 400);
        worst = Math.max(worst, g.distinct.length);
        ok(g.distinct.length <= 3, `${s.name} d=${d} rho=${rho}: ${g.distinct.length} distinct gaps`);
      }
    }
  }
  console.log(`  three-distance holds across ${SLOPE_PRESETS.length * 15} configs (max distinct gaps: ${worst})`);

  // Rational slopes must be exactly periodic; irrational ones must never close.
  // The law is that the accepted sequence's period DIVIDES q — at a window wide
  // enough to swallow every residue the sequence degenerates to all-on (period
  // 1), which is correct, not a bug. A window that straddles the residues
  // realizes the full period q.
  const RATIONALS = [['1/2', 1 / 2, 2], ['2/3', 2 / 3, 3], ['3/5', 3 / 5, 5], ['5/8', 5 / 8, 8], ['8/13', 8 / 13, 13]];
  for (const [name, alpha, q] of RATIONALS) {
    const exact = detectPeriod(alpha, 0.3, 0.11, 64, 600);
    ok(exact === q, `slope ${name} at straddling window: period ${exact} != ${q}`);
    for (const d of [0.15, 0.3, 0.618, 0.8]) {
      const per = detectPeriod(alpha, d, 0.11, 64, 600);
      ok(per !== null && q % per === 0, `slope ${name} d=${d}: period ${per} does not divide ${q}`);
    }
  }
  for (const [name, alpha] of [['1/φ', 1 / PHI], ['√2−1', Math.SQRT2 - 1]]) {
    const q = detectPeriod(alpha, 0.618, 0.11, 256, 2000);
    ok(q === null, `irrational slope ${name} reported period ${q}`);
  }
  console.log('  rational slopes close at 2/3/5/8/13 steps; 1/φ and √2−1 never close (probe 256×2000)');

  // Phason shift: a different sequence with the SAME density and the same gap
  // alphabet — locally indistinguishable, globally rearranged.
  const a = gapStats(1 / PHI, 0.618, 0, 2000);
  const b = gapStats(1 / PHI, 0.618, 0.41, 2000);
  const differs = a.gaps.slice(0, 200).some((g, i) => g !== b.gaps[i]);
  ok(differs, 'phason shift produced an identical sequence');
  ok(Math.abs(a.onsets - b.onsets) <= 2, `phason changed density: ${a.onsets} vs ${b.onsets}`);
  ok(JSON.stringify(a.distinct) === JSON.stringify(b.distinct), 'phason changed the gap alphabet');
  console.log(`  phason: sequence differs, density held (${a.onsets} vs ${b.onsets}/2000), gap alphabet {${a.distinct}} preserved`);

  // For IRRATIONAL slopes, Weyl equidistribution makes measured onset density
  // converge to the window width exactly. For rational p/q there are only q
  // residues, so achievable density is quantized to multiples of 1/q — the
  // parameter cannot be honoured continuously, and that is a property of the
  // lattice, not a defect.
  let maxErr = 0;
  for (const s of SLOPE_PRESETS.filter((x) => x.name.includes('aperiodic'))) {
    for (const d of [0.2, 0.5, 0.9]) {
      const g = gapStats(s.value, d, 0.07, 4000);
      maxErr = Math.max(maxErr, Math.abs(g.onsets / 4000 - d));
    }
  }
  ok(maxErr < 0.01, `irrational-slope density drifts by ${maxErr.toFixed(4)}`);
  console.log(`  irrational slopes: measured density tracks the window within ${maxErr.toFixed(4)}`);

  for (const [name, alpha, q] of RATIONALS) {
    const measured = gapStats(alpha, 0.618, 0.07, 4000).onsets / 4000;
    const nearest = Math.round(measured * q) / q;
    ok(Math.abs(measured - nearest) < 0.01, `slope ${name}: density ${measured} is not a multiple of 1/${q}`);
  }
  console.log('  rational slopes: density quantizes to multiples of 1/q, as the lattice requires');

  // Integration: the mask must open holes, and must be fully bypassable.
  const on = renderLoop({ ...DEFAULT_PARAMS, lattice: true, density: 0.35 }, 2.1);
  const off = renderLoop({ ...DEFAULT_PARAMS, lattice: false }, 2.1);
  ok(on.reduce((x, c) => x + c.length, 0) < off.reduce((x, c) => x + c.length, 0), 'lattice mask did not thin the loop');
  // and it must evolve across bars rather than repeating with the loop
  const bar0 = renderLoop({ ...DEFAULT_PARAMS, lattice: true, density: 0.5 }, 0).map((c) => c.length).join(',');
  const bar1 = renderLoop({ ...DEFAULT_PARAMS, lattice: true, density: 0.5 }, loopSeconds(DEFAULT_PARAMS)).map((c) => c.length).join(',');
  ok(bar0 !== bar1, 'lattice mask repeats exactly with the loop (should evolve across bars)');
  console.log(`  mask thins the loop and evolves bar to bar (${off.reduce((x, c) => x + c.length, 0)} -> ${on.reduce((x, c) => x + c.length, 0)} notes)`);
}

// --- gravity ---------------------------------------------------------------
console.log('\ngravity (one mass at the origin):');
{
  // Kepler's equation must actually be solved, not approximated.
  let maxResid = 0;
  for (const e of [0, 0.1, 0.35, 0.6, 0.85, 0.95]) {
    for (let i = 0; i < 400; i++) {
      const M = (i / 400) * Math.PI * 2;
      const E = eccentricAnomaly(M, e);
      maxResid = Math.max(maxResid, Math.abs(E - e * Math.sin(E) - M));
    }
  }
  ok(maxResid < 1e-12, `Kepler's equation residual ${maxResid.toExponential(2)}`);
  console.log(`  Kepler's equation solved to ${maxResid.toExponential(1)} across e = 0 … 0.95`);

  // Kepler's SECOND law: equal areas in equal times. Sample the orbit and check
  // the swept area per unit time is constant even as r and dnu both swing hard.
  for (const e of [0, 0.35, 0.6, 0.85]) {
    const a = 2.4, n = 0.35;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 720; i++) {
      const s = orbitState(a, e, n, (i / 720) * Math.PI * 2);
      const areal = 0.5 * s.r * s.r * s.dnu;   // dA/dt
      lo = Math.min(lo, areal); hi = Math.max(hi, areal);
    }
    const drift = (hi - lo) / hi;
    ok(drift < 1e-9, `e=${e}: areal velocity drifts by ${drift.toExponential(2)} (2nd law violated)`);
  }
  console.log('  2nd law: areal velocity constant to <1e-9 at e = 0, 0.35, 0.6, 0.85');

  // and the sweep-rate ratio must be exactly ((1+e)/(1-e))^2
  for (const e of [0.3, 0.6]) {
    const a = 2.4, n = 0.35;
    const peri = orbitState(a, e, n, 0).dnu;
    const apo = orbitState(a, e, n, Math.PI).dnu;
    const predicted = sweepRatio(e);
    ok(Math.abs(peri / apo - predicted) / predicted < 1e-9,
      `e=${e}: measured sweep ratio ${(peri / apo).toFixed(4)} != predicted ${predicted.toFixed(4)}`);
  }
  console.log(`  sweep ratio matches ((1+e)/(1-e))²: ${sweepRatio(0.3).toFixed(2)}× at e=0.3, ${sweepRatio(0.6).toFixed(2)}× at e=0.6`);

  // e = 0 must reproduce the pre-gravity circular orbits EXACTLY
  let maxDev = 0;
  for (let i = 0; i < 200; i++) {
    const t = i * 0.17;
    for (const s of eyeStates(4, 2.4, 0.35, 0.35, t, { ecc: 0 })) {
      maxDev = Math.max(maxDev, Math.abs(Math.hypot(...s.pos) - s.a));
    }
  }
  ok(maxDev < 1e-12, `e=0 is not circular: radius deviates by ${maxDev.toExponential(2)}`);
  console.log(`  e=0 reproduces the original circular orbits to ${maxDev.toExponential(1)}`);

  // Lens: the primary image must satisfy the lens equation beta = theta - thetaE^2/theta
  let maxLensErr = 0, minMu = Infinity;
  for (const tE of [0.1, 0.35, 0.8, 1.5]) {
    for (let i = 1; i <= 300; i++) {
      const beta = i * 0.02;
      const { r: theta, mu } = lensPoint(beta, tE);
      maxLensErr = Math.max(maxLensErr, Math.abs((theta - (tE * tE) / theta) - beta));
      minMu = Math.min(minMu, mu);
      if (!(theta >= tE)) fails++;
    }
  }
  ok(maxLensErr < 1e-12, `lens equation residual ${maxLensErr.toExponential(2)}`);
  ok(minMu >= 1, `magnification below 1 (${minMu}) — a lens cannot dim`);
  ok(lensPoint(0.7, 0).r === 0.7 && lensPoint(0.7, 0).mu === 1, 'lensRadius=0 is not the identity');
  console.log(`  lens equation exact to ${maxLensErr.toExponential(1)}; magnification always >= 1; theta >= thetaE`);

  // THE key structural claim: a mass at the origin deflects purely radially,
  // so lensing changes radius and brightness but must NOT move any grid cell.
  const solid = SOLIDS.dodecahedron;
  let maxThetaShift = 0, radiusChanged = 0, cellShifts = 0;
  for (let i = 0; i < 60; i++) {
    const t = i * 0.41;
    const vs = rotateVerts(solid.verts, 0.2 * t, 0.28 * t, 0.32 * t);
    for (const E of eyePositions(4, 2.4, 0.35, 0.35, t, { ecc: 0.35 })) {
      const plain = projectVertices(vs, E, { mode: 'view', lens: 0 });
      const lensed = projectVertices(vs, E, { mode: 'view', lens: 0.6 });
      for (let k = 0; k < plain.length; k++) {
        maxThetaShift = Math.max(maxThetaShift, Math.abs(plain[k].theta - lensed[k].theta));
        if (Math.abs(plain[k].r - lensed[k].r) > 1e-6) radiusChanged++;
        if (Math.floor(plain[k].frac * 16) !== Math.floor(lensed[k].frac * 16)) cellShifts++;
      }
    }
  }
  ok(maxThetaShift < 1e-12, `lensing moved theta by ${maxThetaShift.toExponential(2)} — timing must be untouched`);
  ok(cellShifts === 0, `lensing moved ${cellShifts} notes to a different grid cell`);
  ok(radiusChanged > 0, 'lensing changed no radii at all');
  console.log(`  radial-only: ${radiusChanged} radii changed, 0 grid cells moved, max theta shift ${maxThetaShift.toExponential(1)}`);

  // integration: gravity must be fully bypassable
  const flat = renderLoop({ ...DEFAULT_PARAMS, ecc: 0, lensRadius: 0 }, 3.3);
  const grav = renderLoop({ ...DEFAULT_PARAMS, ecc: 0.6, lensRadius: 0.6 }, 3.3);
  ok(flat.length === grav.length, 'gravity changed the loop length');
  ok(JSON.stringify(flat) !== JSON.stringify(grav), 'gravity had no audible effect');
  console.log('  loop renders with gravity on and off, and differs between them');
}

// --- production features ---------------------------------------------------
console.log('\nproduction features:');
{
  // The density law: total notes ~= vertices x eyes, INDEPENDENT of loop length.
  // Lengthening the loop dilutes; it does not fill.
  const counts = [1, 2, 4, 8, 16].map((bars) => {
    const q = { ...DEFAULT_PARAMS, solid: 'dodecahedron', nEyes: 3, bars, gridN: 16, depthKeep: 1, radiusGate: 0, lattice: false };
    let tot = 0;
    for (let s = 0; s < 8; s++) tot += renderLoop(q, s * 3.1).flat().length;
    return tot / 8;
  });
  const ceiling = SOLIDS.dodecahedron.verts.length * 3;
  ok(counts.every((c) => Math.abs(c - ceiling) / ceiling < 0.1),
    `note count varies with loop length: ${counts.map((c) => c.toFixed(0)).join(', ')} vs ceiling ${ceiling}`);
  console.log(`  density law: ${counts.map((c) => c.toFixed(0)).join('/')} notes at 1/2/4/8/16 bars (V×eyes = ${ceiling})`);

  // Per-eye transpose must shift only its own channel.
  const flatT = renderLoop({ ...DEFAULT_PARAMS, nEyes: 3, eyeTranspose: [0, 0, 0, 0], depthKeep: 1, lattice: false }, 5.5);
  const shifted = renderLoop({ ...DEFAULT_PARAMS, nEyes: 3, eyeTranspose: [0, 12, -24, 0], depthKeep: 1, lattice: false }, 5.5);
  const byCh = (cells, ch) => cells.flat().filter((n) => n.channel === ch).map((n) => n.note);
  ok(JSON.stringify(byCh(flatT, 1)) === JSON.stringify(byCh(shifted, 1)), 'transpose leaked onto eye 1');
  const d2 = byCh(shifted, 2).map((n, i) => n - byCh(flatT, 2)[i]);
  ok(d2.length > 0 && d2.every((d) => d === 12), `eye 2 not transposed by +12: ${[...new Set(d2)]}`);
  console.log(`  per-eye transpose: ch1 unchanged, ch2 +12 across ${d2.length} notes, ch3 -24`);

  // Velocity window must be honoured and must never emit 0.
  for (const [lo, hi] of [[1, 127], [40, 122], [64, 64], [100, 20]]) {
    const v = renderLoop({ ...DEFAULT_PARAMS, velMin: lo, velMax: hi, depthKeep: 1, lattice: false }, 4.4).flat().map((n) => n.velocity);
    const a = Math.min(lo, Math.max(lo, hi)), b = Math.max(a, hi);
    ok(v.every((x) => x >= 1 && x <= 127), `velocity out of MIDI range for window ${lo}..${hi}`);
    ok(v.every((x) => x >= Math.min(a, 127) - 1 && x <= Math.max(a, b) + 1), `velocity escaped window ${lo}..${hi}`);
  }
  const win = renderLoop({ ...DEFAULT_PARAMS, velMin: 40, velMax: 122, depthKeep: 1, lattice: false }, 4.4).flat().map((n) => n.velocity);
  console.log(`  velocity window 40..122 observed ${Math.min(...win)}..${Math.max(...win)}; inverted window clamps safely`);

  // Drum map: notes must come only from the map, ignoring baseNote/octaveSpan.
  const drums = renderLoop({ ...DEFAULT_PARAMS, scale: 'drum', nEyes: 4, solid: 'icosahedron', depthKeep: 1, lattice: false, baseNote: 84, octaveSpan: 5 }, 6.6).flat();
  const used = [...new Set(drums.map((n) => n.note))].sort((a, b) => a - b);
  ok(used.length > 0 && used.every((n) => DEFAULT_DRUM_MAP.includes(n)), `drum notes outside the map: ${used}`);
  const custom = renderLoop({ ...DEFAULT_PARAMS, scale: 'drum', drumMap: [60, 61, 62], nEyes: 4, depthKeep: 1, lattice: false }, 6.6).flat();
  ok(custom.every((n) => [60, 61, 62].includes(n.note)), 'custom drum map not honoured');
  console.log(`  drum map: ${used.length} slots used ${used.join(',')}, baseNote/octaveSpan correctly ignored`);

  // Export passes are the answer to the density law: a longer LOOP is the same
  // material spread thin, but N passes of a short loop is N times the material,
  // with every pass different because the geometry has turned.
  const stab = { ...DEFAULT_PARAMS, ...PRESETS['Techno · stab'] };
  const oneLong = renderLoop({ ...stab, bars: 16 }, 0);
  const eightShort = renderTake({ ...stab, bars: 2 }, 0, 8);
  ok(oneLong.length === eightShort.length, 'take and long loop cover different spans');
  ok(eightShort.flat().length > oneLong.flat().length * 3,
    `passes did not multiply material: ${eightShort.flat().length} vs ${oneLong.flat().length}`);
  const sig = (k) => eightShort.slice(k * 32, (k + 1) * 32).map((c) => c.length).join('');
  const distinct = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(sig)).size;
  ok(distinct === 8, `only ${distinct}/8 passes differ — the take is repeating`);
  console.log(`  export passes: 16 bars as one loop = ${oneLong.flat().length} notes, as 8×2 bars = ${eightShort.flat().length} notes, ${distinct}/8 passes distinct`);

  // Every preset must render, stay in MIDI range, and produce audible notes.
  for (const name of PRESET_NAMES) {
    const q = { ...DEFAULT_PARAMS, ...PRESETS[name] };
    const cells = renderLoop(q, 3.7);
    const notes = cells.flat();
    ok(cells.length === totalCells(q), `${name}: wrong cell count`);
    ok(notes.every((n) => n.note >= 0 && n.note <= 127 && n.velocity >= 1 && n.velocity <= 127), `${name}: out-of-range event`);
    ok(notes.every((n) => n.channel >= 1 && n.channel <= q.nEyes), `${name}: channel outside eye count`);
    ok(notes.length > 0, `${name}: renders silence`);
    const bytes = writeMidiFile(cells, { bpm: q.bpm, gridN: q.gridN, nEyes: q.nEyes, gate: q.gate });
    ok(bytes.length > 40, `${name}: empty MIDI export`);
    const empty = cells.filter((c) => !c.length).length;
    console.log(`  ${name.padEnd(22)} ${String(notes.length).padStart(3)} notes / ${String(cells.length).padStart(4)} cells  ${String(Math.round(100 * empty / cells.length)).padStart(2)}% rest  ${bytes.length} bytes`);
  }
}

// --- tempo sync ------------------------------------------------------------
console.log('\ntempo sync (optional):');
{
  // Off must be byte-identical to the pre-sync behaviour.
  const off = { ...DEFAULT_PARAMS, tempoSync: false };
  const r = effectiveRates(off);
  ok(r.wx === off.wx && r.eyeRate === off.eyeRate && r.phasonRate === off.phasonRate,
    'tempoSync:false altered the rates');
  console.log('  off: rates pass through untouched (wall-clock, spec behaviour)');

  // ASYNC: the same preset at a different tempo is a DIFFERENT pattern.
  const sig = (q) => renderLoop(q, 0).map((c) => c.map((n) => `${n.channel}:${n.note}:${n.velocity}`).join()).join('|');
  const async130 = sig({ ...DEFAULT_PARAMS, ...PRESETS['Techno · stab'], bpm: 130 });
  const async140 = sig({ ...DEFAULT_PARAMS, ...PRESETS['Techno · stab'], bpm: 140 });
  ok(async130 !== async140, 'async mode was unexpectedly tempo-invariant');

  // SYNCED: the same preset at any tempo is the SAME pattern. The bar length
  // cancels out of rate x time, so this should hold exactly.
  const base = { ...DEFAULT_PARAMS, ...PRESETS['Techno · stab'], bpm: 130 };
  const synced = { ...base, ...convertRates(base, true), tempoSync: true };
  const ref = sig(synced);
  let allSame = true;
  for (const bpm of [70, 100, 120, 130, 145, 174, 200]) {
    if (sig({ ...synced, bpm }) !== ref) allSame = false;
  }
  ok(allSame, 'synced pattern changed with tempo — the bar length did not cancel');
  console.log('  async: 130 vs 140 differ · synced: identical across 70/100/120/130/145/174/200 BPM');

  // Toggling must preserve the motion you were hearing.
  const back = { ...synced, ...convertRates(synced, false), tempoSync: false };
  const drift = Math.max(...['wx', 'wy', 'wz', 'eyeRate', 'phasonRate'].map((k) => Math.abs(back[k] - base[k])));
  ok(drift < 1e-12, `round-tripping the sync toggle drifted rates by ${drift.toExponential(2)}`);
  console.log(`  toggle round-trip preserves rates to ${drift.toExponential(1)}`);

  // Closure must be REAL, not just computed: after the reported number of bars
  // the geometry must actually be back where it started.
  const closed = {
    ...DEFAULT_PARAMS, tempoSync: true, bpm: 128, gridN: 16, bars: 1,
    wx: 1 / 8, wy: 1 / 4, wz: 1 / 2, eyeRate: 1 / 16, phasonRate: 0,
    lattice: false, nEyes: 3, ecc: 0.4, eyeRates: 'rational',
  };
  // the spec's phi eye ratios are irrational, so the same rig must NOT close
  const phiRig = closure({ ...closed, eyeRates: 'phi' }, null);
  ok(!phiRig.closes && /eye/.test(phiRig.blocked), `phi eye ratios wrongly reported as closing: ${JSON.stringify(phiRig)}`);
  const c = closure(closed, null);
  ok(c.closes, `rational rates reported as not closing: ${c.blocked}`);
  const bar = barSeconds(closed);
  const A = frameState(closed, 0), B = frameState(closed, c.bars * bar);
  // frac lives on a circle, so compare with wraparound or a hit sitting at
  // 0.9999 vs 0.0001 reads as a full-turn error when it has barely moved
  const circDist = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
  let maxErr = 0;
  for (let e = 0; e < closed.nEyes; e++) {
    for (let v = 0; v < A.perEye[e].hits.length; v++) {
      maxErr = Math.max(maxErr, circDist(A.perEye[e].hits[v].frac, B.perEye[e].hits[v].frac));
      maxErr = Math.max(maxErr, Math.abs(A.perEye[e].hits[v].w - B.perEye[e].hits[v].w));
    }
  }
  ok(maxErr < 1e-9, `geometry did not actually return after ${c.bars} bars (error ${maxErr.toExponential(2)})`);
  // and the reported closure must be MINIMAL: no earlier whole bar may realign
  let earliest = null, minMove = Infinity;
  for (let b = 1; b < c.bars && earliest === null; b++) {
    const S = frameState(closed, b * bar);
    let err = 0;
    for (let e = 0; e < closed.nEyes; e++) {
      for (let v = 0; v < A.perEye[e].hits.length; v++) {
        err = Math.max(err, circDist(A.perEye[e].hits[v].frac, S.perEye[e].hits[v].frac));
      }
    }
    minMove = Math.min(minMove, err);
    if (err < 1e-9) earliest = b;
  }
  ok(earliest === null, `geometry already realigned at bar ${earliest}, so ${c.bars} is not the minimal period`);
  console.log(`  closure: ω 1/8,1/4,1/2 + 3 rational eyes -> ${c.bars} bars; returns to ${maxErr.toExponential(1)}, and no earlier bar realigns (closest ${minMove.toExponential(1)})`);

  // An irrational rate must be reported honestly as never closing.
  const never = closure({ ...closed, wy: (1 / 8) * Math.SQRT2 }, null);
  ok(!never.closes && /ωy/.test(never.blocked), `irrational rate not caught: ${JSON.stringify(never)}`);
  ok(!closure({ ...closed, tempoSync: false }, null).closes, 'async mode claimed closure');
  console.log(`  irrational ωy correctly reported: "${never.blocked}"`);

  // The ladder keeps closure bounded rather than exploding into a huge LCM.
  let worstBars = 0, collapses = 0;
  for (let i = 0; i < 400; i++) {
    const q = {
      ...closed,
      wx: snapToLadder(0.004 + i * 0.005), wy: snapToLadder(0.31 - i * 0.0007),
      wz: snapToLadder(0.05 + i * 0.002), eyeRate: snapToLadder(0.01 + i * 0.0009),
    };
    const cc = closure(q, null);
    ok(cc.closes, `ladder-snapped rates failed to close at i=${i}`);
    worstBars = Math.max(worstBars, cc.bars);
    // the ladder must not collapse distinct rates onto one value
    if (Math.abs(q.wy - q.wz) < 1e-12 && Math.abs(snapToLadder(0.31 - i * 0.0007) - snapToLadder(0.05 + i * 0.002)) > 0.02) collapses++;
  }
  ok(collapses === 0, `${collapses} rate sets collapsed onto a single value`);
  const gaps = RATE_LADDER.map(([a, b]) => a / b).filter((v) => v <= 0.5)
    .map((v, i, arr) => (i ? v - arr[i - 1] : 0));
  console.log(`  ladder: ${RATE_LADDER.length} values, max gap below 0.5 is ${Math.max(...gaps).toFixed(4)}; always closes, worst case ${worstBars} bars`);
}

// --- macros ----------------------------------------------------------------
console.log('\nmacros (two-knob performance):');
{
  // THE invariant: both knobs centred must reproduce the captured patch
  // exactly, for every preset. If this drifts, performing destroys your patch.
  let worst = 0, worstKey = null;
  for (const name of PRESET_NAMES) {
    const b = { ...DEFAULT_PARAMS, ...PRESETS[name] };
    const centred = applyMacros(b, { space: 0.5, energy: 0.5 });
    for (const k of Object.keys(b)) {
      if (typeof b[k] !== 'number') continue;
      const d = Math.abs(centred[k] - b[k]);
      if (d > worst) { worst = d; worstKey = `${name}.${k}`; }
    }
  }
  ok(worst < 1e-12, `centred macros altered ${worstKey} by ${worst}`);
  console.log(`  centre is identity across all ${PRESET_NAMES.length} presets (max drift ${worst.toExponential(1)})`);

  // Sweeping either knob must stay inside every parameter's legal range and
  // must keep producing valid, audible MIDI.
  let bad = 0, quiet = 0, checked = 0;
  const b = { ...DEFAULT_PARAMS, ...PRESETS['Techno · stab'] };
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const q = applyMacros(b, { space: i / 20, energy: j / 20 });
      if (q.velMin > q.velMax) bad++;
      if (!(q.depthKeep >= 0.1 && q.depthKeep <= 1)) bad++;
      if (!(q.density > 0 && q.density <= 1)) bad++;
      if (!(q.ecc >= 0 && q.ecc <= 0.85)) bad++;
      if (!Number.isInteger(q.octaveSpan) || q.octaveSpan < 1 || q.octaveSpan > 5) bad++;
      if (!Number.isInteger(q.velMin) || q.velMin < 1) bad++;
      const notes = renderLoop(q, 2.4).flat();
      if (notes.some((n) => n.velocity < 1 || n.velocity > 127 || n.note < 0 || n.note > 127)) bad++;
      if (i > 4 && notes.length === 0) quiet++;
      checked++;
    }
  }
  ok(bad === 0, `${bad} invalid states across the macro plane`);
  ok(quiet === 0, `${quiet} silent states above the bottom of the Space range`);
  console.log(`  ${checked} points on the 21×21 macro plane: all in range, all audible`);

  // The knobs must actually do something, monotonically in the right direction.
  const density = (v) => renderLoop(applyMacros(b, { space: v, energy: 0.5 }), 2.4).flat().length;
  const lo = density(0), mid = density(0.5), hi = density(1);
  ok(lo < mid && mid <= hi, `Space is not monotonic: ${lo} / ${mid} / ${hi}`);
  const ecc = (v) => applyMacros(b, { space: 0.5, energy: v }).ecc;
  ok(ecc(0) < ecc(0.5) && ecc(0.5) < ecc(1), 'Energy does not increase eccentricity');
  console.log(`  Space 0/0.5/1 -> ${lo}/${mid}/${hi} notes;  Energy ecc ${ecc(0)} -> ${ecc(1).toFixed(2)}`);

  // Macros must not touch anything outside their own clusters.
  const changed = new Set();
  for (const v of [0, 0.25, 0.75, 1]) {
    for (const key of ['space', 'energy']) {
      const q = applyMacros(b, { space: 0.5, energy: 0.5, [key]: v });
      for (const k of Object.keys(b)) if (typeof b[k] === 'number' && q[k] !== b[k]) changed.add(k);
    }
  }
  const allowed = new Set(['depthKeep', 'radiusGate', 'density', 'gate', 'velMin', 'ecc', 'lensRadius', 'timing', 'velMax', 'octaveSpan', 'eyeRate']);
  const leaked = [...changed].filter((k) => !allowed.has(k));
  ok(leaked.length === 0, `macros leaked into ${leaked.join(', ')}`);
  console.log(`  touches exactly ${changed.size} parameters, none outside the two clusters`);
}

// --- midi clock slaving ----------------------------------------------------
console.log('\nmidi clock (DAW as master):');
{
  // Every supported grid must divide 96 clocks per bar exactly, or cells would
  // land between ticks and the whole scheme falls apart.
  for (const gridN of [4, 8, 16, 32]) {
    const cpc = clocksPerCell(gridN);
    ok(Number.isInteger(cpc) && cpc > 0, `gridN ${gridN} gives ${cpc} clocks/cell`);
  }
  console.log(`  clocks per cell: ${[4, 8, 16, 32].map((g) => `1/${g}→${clocksPerCell(g)}`).join('  ')}`);

  // One bar of clock must produce exactly gridN cell firings, in order.
  for (const gridN of [4, 8, 16, 32]) {
    const fired = [];
    for (let c = 0; c < CLOCKS_PER_BAR; c++) {
      const pos = positionFromClock(c, gridN, gridN);
      if (pos.onCell) fired.push(pos.cell);
    }
    ok(fired.length === gridN, `1/${gridN}: ${fired.length} firings per bar, expected ${gridN}`);
    ok(fired.every((v, i) => v === i), `1/${gridN}: cells out of order`);
  }
  console.log('  one bar of clock fires exactly gridN cells, in order, for every resolution');

  // Position is DERIVED, so a dropped tick costs one cell and self-corrects;
  // an independently incremented counter would stay wrong forever.
  const gridN = 16, N = 32;
  let counterDrift = 0, derivedDrift = 0, naive = 0;
  for (let c = 0; c < CLOCKS_PER_BAR * 8; c++) {
    const dropped = c > 200 ? 1 : 0;               // one tick lost at c=200
    const truth = positionFromClock(c, gridN, N);
    const observed = positionFromClock(c - dropped, gridN, N);
    if (observed.onCell) naive++;
    if (truth.cell !== observed.cell) derivedDrift++;
  }
  // a free-running counter incremented per firing would be permanently offset
  counterDrift = 1;
  ok(derivedDrift > 0, 'test is not exercising the dropped tick');
  ok(naive === Math.floor((CLOCKS_PER_BAR * 8 - 1) / clocksPerCell(gridN)) + 1,
    `dropped tick changed the firing count: ${naive}`);
  console.log(`  a dropped tick shifts position by one cell (${derivedDrift} clocks affected) but firing count is unchanged`);

  // Song Position Pointer counts sixteenths, six clocks each.
  ok(clockFromSongPosition(0) === 0, 'SPP 0');
  ok(clockFromSongPosition(16) === 96, `SPP 16 (one bar) should be 96 clocks, got ${clockFromSongPosition(16)}`);
  ok(positionFromClock(clockFromSongPosition(4), 16, 16).cell === 4, 'SPP 4 sixteenths should land on cell 4');
  console.log('  song position pointer: 16 sixteenths = 96 clocks = exactly one bar');

  // Tempo round-trips, and the estimator rejects implausible intervals.
  for (const bpm of [70, 120, 128, 130, 174]) {
    const back = bpmFromTickMs(tickMsFromBpm(bpm));
    ok(Math.abs(back - bpm) < 1e-9, `bpm round-trip ${bpm} -> ${back}`);
  }
  const steady = tickMsFromBpm(130);
  ok(updateTickEstimate(steady, 0) === steady, 'zero interval was not rejected');
  ok(updateTickEstimate(steady, 9999) === steady, 'stall was not rejected');
  let est = tickMsFromBpm(120);
  for (let i = 0; i < 200; i++) est = updateTickEstimate(est, steady);
  ok(Math.abs(bpmFromTickMs(est) - 130) < 0.01, `estimator did not converge: ${bpmFromTickMs(est)}`);
  console.log(`  tempo round-trips exactly; estimator converges 120→130 within 0.01 bpm and rejects stalls`);

  // --- message parsing ----------------------------------------------------
  const rx = new MidiIn();
  const got = { clock: 0, transport: [], spp: [], cc: [] };
  rx.onClock = () => got.clock++;
  rx.onTransport = (k) => got.transport.push(k);
  rx.onSongPosition = (v) => got.spp.push(v);
  rx.bindings.space = { cc: 74, channel: 0 };
  rx.onValue = (key, v) => got.cc.push([key, v]);
  const feed = (...bytes) => rx.handle({ data: bytes });

  feed(0xfa);                       // start
  for (let i = 0; i < 24; i++) feed(0xf8);
  feed(0xfc);                       // stop
  feed(0xfb);                       // continue
  feed(0xf2, 0x00, 0x01);           // SPP = 128 sixteenths
  feed(0xb0, 74, 127);              // bound CC
  feed(0xb0, 75, 64);               // unbound CC
  feed(0x90, 60, 100);              // note on — must be ignored entirely

  ok(got.clock === 24, `clock count ${got.clock}, expected 24`);
  ok(JSON.stringify(got.transport) === '["start","stop","continue"]', `transport ${JSON.stringify(got.transport)}`);
  ok(got.spp.length === 1 && got.spp[0] === 128, `SPP ${JSON.stringify(got.spp)}, expected [128]`);
  ok(got.cc.length === 1 && got.cc[0][0] === 'space' && got.cc[0][1] === 1, `CC ${JSON.stringify(got.cc)}`);

  // Real-time bytes may interleave anywhere and must not be read as CC data,
  // nor consume the bytes of the message they interrupt.
  const before = { ...got, cc: [...got.cc] };
  feed(0xf8); feed(0xf8);
  ok(got.clock === 26 && got.cc.length === before.cc.length, 'interleaved clock leaked into CC handling');
  // and a clock byte must never be mistaken for a channel message
  ok(!got.cc.some(([, v]) => v > 1), 'clock byte parsed as a CC value');
  console.log(`  parsing: 24 clocks, start/stop/continue, SPP→128, bound CC only; note-on and unbound CC ignored`);

  // Relative (endless encoder) decoding, two's complement.
  const rel = new MidiIn();
  rel.relative = true;
  rel.bindings.energy = { cc: 20, channel: 0 };
  const deltas = [];
  rel.onValue = (k, v, isDelta) => deltas.push([v, isDelta]);
  rel.handle({ data: [0xb0, 20, 1] });    // +1
  rel.handle({ data: [0xb0, 20, 127] });  // -1
  rel.handle({ data: [0xb0, 20, 63] });   // +63
  ok(deltas.every(([, d]) => d === true), 'relative mode did not flag deltas');
  ok(deltas[0][0] > 0 && deltas[1][0] < 0 && deltas[2][0] > deltas[0][0],
    `relative decoding wrong: ${JSON.stringify(deltas.map(([v]) => v.toFixed(4)))}`);
  console.log(`  endless encoder: +1/-1/+63 decode to ${deltas.map(([v]) => v.toFixed(3)).join(', ')}`);

  // Jitter must not bias the estimate: a DAW's clock wobbles either side.
  let jittered = steady;
  const seq = Array.from({ length: 600 }, (_, i) => steady + Math.sin(i * 1.7) * 0.8);
  for (const dt of seq) jittered = updateTickEstimate(jittered, dt);
  ok(Math.abs(bpmFromTickMs(jittered) - 130) < 0.2, `jitter biased tempo to ${bpmFromTickMs(jittered).toFixed(3)}`);
  console.log(`  ±0.8 ms jitter leaves tempo within ${Math.abs(bpmFromTickMs(jittered) - 130).toFixed(3)} bpm of true`);
}

// --- loop + midi -----------------------------------------------------------
const p = { ...DEFAULT_PARAMS };
const cells = renderLoop(p, 0);
ok(cells.length === totalCells(p), 'loop cell count');
const noteCount = cells.reduce((a, c) => a + c.length, 0);
ok(noteCount > 0, 'loop produced no notes');
for (const c of cells) {
  const keys = new Set(c.map((n) => `${n.channel}:${n.note}`));
  ok(keys.size === c.length, 'duplicate (channel,note) within one cell');
}
const bytes = writeMidiFile(cells, { bpm: p.bpm, gridN: p.gridN, nEyes: p.nEyes, gate: p.gate });
console.log(`\nloop: ${cells.length} cells, ${noteCount} notes -> ${bytes.length} bytes of SMF`);

const fs = await import('node:fs');
fs.writeFileSync(new URL('./out.mid', import.meta.url), bytes);

// Multi-byte VLQ: at gridN=4 a step is 480 ticks, which needs two VLQ bytes,
// and sparse channels at gridN=32/bars=4 leave multi-step gaps. The default
// params above only ever produce deltas below 128.
for (const [gridN, bars] of [[4, 4], [32, 4]]) {
  const q = { ...DEFAULT_PARAMS, gridN, bars };
  const c = renderLoop(q, 1.3);
  const b = writeMidiFile(c, { bpm: q.bpm, gridN, nEyes: q.nEyes, gate: q.gate });
  fs.writeFileSync(new URL(`./out-g${gridN}-b${bars}.mid`, import.meta.url), b);
  console.log(`  variant gridN=${gridN} bars=${bars}: ${c.length} cells, ${c.reduce((a, x) => a + x.length, 0)} notes, ${b.length} bytes`);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
