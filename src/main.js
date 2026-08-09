import { SOLID_NAMES, SOLIDS } from './geometry.js';
import { EYE_COLORS } from './eyes.js';
import { DEFAULT_PARAMS, SPEC_LITERAL, frameState, renderLoop, renderTake, latticeMask, stepSeconds, totalCells } from './sequencer.js';
import { SLOPE_PRESETS, gapStats, detectPeriod } from './quasilattice.js';
import { sweepRatio, impliedGM } from './kepler.js';
import { PRESETS, PRESET_NAMES } from './presets.js';
import { convertRates, snapToLadder, closure, rationalize } from './tempo.js';
import { getScale } from './scale.js';
import { writeMidiFile } from './midifile.js';
import { drawViewport, drawCircle, drawGrid } from './render.js';
import { MidiOut, MidiIn, PreviewSynth, downloadBytes } from './output.js';
import { MACROS, MACRO_TARGETS, applyMacros, LOCK_ALPHA, FREE_ALPHA } from './macros.js';
import { drawPerf } from './perf.js';
import { clocksPerCell, positionFromClock } from './clock.js';
import { createTransportController } from './transport.js';
import { createClockController } from './clock-controller.js';
import { createCorridorController } from './corridor.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const p = { ...DEFAULT_PARAMS };

const midi = new MidiOut();
const midiIn = new MidiIn();
const synth = new PreviewSynth();

// --- macros ----------------------------------------------------------------
// The captured patch is the origin; the two knobs orbit it. Both at 0.5
// reproduce `base` exactly, so nothing you dial in can be lost by performing.
let base = { ...DEFAULT_PARAMS };
let unlockedAlpha = base.alpha;
let locked = false;
const macroValues = { space: 0.5, energy: 0.5 };

function applyMacroState({ sync = true } = {}) {
  Object.assign(p, applyMacros(base, macroValues));
  p.alpha = locked ? LOCK_ALPHA : unlockedAlpha;
  lastLoopBuild = -1e9;
  if (!sync) return;
  syncMacroUI();
  // push the driven parameters back onto their own sliders, so you can watch a
  // single knob move the whole ecosystem — that feedback is the point
  for (const id of MACRO_TARGETS) {
    if (!$(id)) continue;
    $(id).value = p[id];
    if ($(id + '_v')) $(id + '_v').textContent = RATE_IDS.has(id) ? fmtRate(p[id]) : p[id].toFixed(CONTROLS.ranges[id] ?? 2);
  }
}

function syncMacroUI() {
  for (const key of Object.keys(MACROS)) {
    const id = key === 'space' ? 'mSpace' : 'mEnergy';
    $(id).value = macroValues[key];
    $(id + '_v').textContent = `${Math.round(macroValues[key] * 100)}%`;
  }
  $('lockToggle').textContent = `Lock: ${locked ? 'on' : 'off'}`;
}

function syncCorridorUI(current = corridor.view()) {
  const morph = $('corridorMorph');
  if (!morph) return;
  morph.disabled = !current.ready;
  morph.value = current.position;
  morph.setAttribute('aria-valuetext', current.ready
    ? `${Math.round(current.position * 100)} percent from A to B`
    : 'Capture B to enable the corridor');
  $('corridorMorph_v').textContent = current.ready
    ? `${Math.round(current.position * 100)}%`
    : 'set B';
  $('corridorA').setAttribute('aria-pressed', String(current.appliedSide === 'a'));
  $('corridorB').setAttribute('aria-pressed', String(current.appliedSide === 'b'));

  const state = $('corridorState');
  if (!current.ready) {
    state.textContent = 'A is safe. Shape another patch, then capture B.';
    state.dataset.state = 'setup';
    return;
  }
  if (current.pendingSide) {
    const count = current.discreteChanges.length;
    state.textContent = `${count} topology change${count === 1 ? '' : 's'} queued for ${current.pendingSide.toUpperCase()} at a bar boundary.`;
    state.dataset.state = 'queued';
    return;
  }
  state.textContent = `Following ${current.appliedSide.toUpperCase()}. ${current.discreteChanges.length} topology change${current.discreteChanges.length === 1 ? '' : 's'} cross at centre.`;
  state.dataset.state = 'ready';
}

function captureBase() {
  base = { ...p };
  unlockedAlpha = locked ? unlockedAlpha : p.alpha;
  macroValues.space = 0.5;
  macroValues.energy = 0.5;
  syncMacroUI();
  status('Captured — both knobs centred on this patch.');
}

function captureCorridorSide(side) {
  base = { ...p };
  unlockedAlpha = locked ? unlockedAlpha : p.alpha;
  macroValues.space = 0.5;
  macroValues.energy = 0.5;
  corridor.capture(side, base);
  syncControls();
  syncMacroUI();
  status(`Corridor ${side.toUpperCase()} captured. This endpoint is now home-safe.`);
}

function applyCorridorValues(values) {
  Object.assign(base, values);
  applyMacroState({ sync: !perfOpen() });
  if (!perfOpen()) syncControls();
}

function nudgeMacro(key, delta) {
  macroValues[key] = Math.max(0, Math.min(1, macroValues[key] + delta));
  applyMacroState({ sync: !perfOpen() });
  if (perfOpen()) syncMacroUI();
}

const perfOpen = () => !$('perf').hidden;
const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg; };

// --- runtimes --------------------------------------------------------------
// Geometry is sampled once per grid step. The internal transport schedules on
// performance.now(); the external controller replaces it with MIDI clock.
const corridor = createCorridorController({
  initial: base,
  isRunning: () => transport.state.playing || (clock.state.external && clock.state.running),
  onContinuous: applyCorridorValues,
  onDiscrete: applyCorridorValues,
  onChange: (state) => syncCorridorUI(state),
});

const transport = createTransportController({
  params: p,
  midi,
  synth,
  previewEnabled: () => $('preview').checked,
  lookaheadMs: () => (document.hidden ? 2200 : 140),
  beforeStep: ({ stepIndex }) => corridor.flushAtStep(stepIndex, p.gridN),
  onPlayingChange: (playing) => { $('play').textContent = playing ? 'Pause' : 'Play'; },
});

const clock = createClockController({
  params: p,
  transport,
  midi,
  synth,
  previewEnabled: () => $('preview').checked,
  beforeStep: ({ stepIndex }) => corridor.flushAtStep(stepIndex, p.gridN),
  onPlayingChange: (playing) => { $('play').textContent = playing ? 'Pause' : 'Play'; },
});

// --- draw loop -------------------------------------------------------------
let cachedLoop = [];
let lastLoopBuild = -1e9;

function currentPlayCell() {
  if (clock.state.external) return positionFromClock(clock.state.count, p.gridN, totalCells(p)).cell;
  const stepMs = stepSeconds(p) * 1000;
  return Math.floor(transport.musicalTimeMs() / stepMs) % totalCells(p);
}

function frame() {
  const t = clock.geometrySeconds();
  const state = frameState(p, t);
  const cell = currentPlayCell();

  if (perfOpen()) {
    drawPerf($('perfCanvas'), state, p, macroValues, {
      playCell: cell,
      title: `${p.solid} · ${p.nEyes} eyes · ${Math.round(p.bpm)} bpm · ${p.bars} bar${p.bars > 1 ? 's' : ''}`,
      subtitle: locked ? `locked — mask repeats every 8 steps` : `free — 1/φ, never repeats`,
      keys: 'drag halves · arrows macros · [ ] corridor · H return A · C capture · L lock · space play · esc exit',
      bound: { space: midiIn.bindings.space?.cc, energy: midiIn.bindings.energy?.cc },
      learning: midiIn.learning,
      corridor: corridor.view(),
    });
    requestAnimationFrame(frame);
    return;
  }

  drawViewport($('viewport'), state, p);
  drawCircle($('circle'), state, p, cell);

  const now = performance.now();
  if (now - lastLoopBuild > 110) {
    cachedLoop = renderLoop(p, t);
    lastLoopBuild = now;
  }
  const mask = p.lattice ? latticeMask(p, t, 0) : null;
  drawGrid($('grid'), cachedLoop, p, cell, $('showPitch').checked, mask);

  const solid = SOLIDS[p.solid];
  const degrees = getScale(p.scale, solid, p.customDegrees);
  const notes = cachedLoop.reduce((a, c) => a + c.length, 0);
  const lines = [
    `solid       ${p.solid}`,
    `V / E       ${solid.verts.length} / ${solid.edges.length}`,
    `edge/circR  ${solid.edgeRatio.toFixed(4)}`,
    p.scale === 'drum'
      ? `drum map    [${(p.drumMap || []).join(' ')}]`
      : `scale       ${p.scale} [${degrees.join(' ')}]  transpose [${(p.eyeTranspose || []).slice(0, p.nEyes).join(' ')}]`,
    `cells       ${totalCells(p)}   step ${(stepSeconds(p) * 1000).toFixed(1)} ms`,
    `loop notes  ${notes}`,
    `play cell   ${cell}`,
    '',
  ];
  if (clock.state.external) {
    lines.push(clock.alive()
      ? `clock in    ${clock.state.running ? 'RUNNING' : 'stopped'} · ${p.bpm.toFixed(2)} bpm from DAW · ${clocksPerCell(p.gridN)} clocks/cell · tick ${clock.state.tickMs.toFixed(2)} ms`
      : `clock in    waiting for MIDI clock — press play in the DAW`);
  }
  if (p.tempoSync) {
    const per = p.lattice ? detectPeriod(p.alpha, p.density, p.rho) : null;
    const c = closure(p, per);
    lines.push(`clock       tempo-synced — rates in cycles/bar, pattern is tempo-invariant`);
    lines.push(`closure     ${c.closes ? `everything realigns after ${c.bars} bars (${c.steps} steps)` : `never closes — ${c.blocked}`}`);
  } else {
    lines.push('clock       async — geometry on wall-clock seconds, grid on musical time');
  }

  if (p.ecc > 0 || p.lensRadius > 0) {
    const e0 = state.states[0];
    lines.push(`orbit       a=${e0.a.toFixed(2)}  e=${p.ecc.toFixed(3)}  peri ${e0.peri.toFixed(2)} … apo ${e0.apo.toFixed(2)}`);
    lines.push(`sweep       ${sweepRatio(p.ecc).toFixed(2)}× faster at perihelion   GM=${impliedGM(e0.a, e0.n).toFixed(3)}`);
    const mus = state.perEye.flatMap((e) => e.hits.map((h) => h.mu));
    lines.push(`lens        θE=${p.lensRadius.toFixed(3)}  magnification ${Math.min(...mus).toFixed(2)}× … ${Math.max(...mus).toFixed(2)}×`);
    // an eye passing inside the form flips w negative and blows out the divide
    if (e0.peri < 1.1) lines.push(`  ⚠ perihelion ${e0.peri.toFixed(2)} is inside/near the form (circumradius 1)`);
  }

  const allHits = state.perEye.flatMap((e) => e.hits);
  const rested = allHits.filter((h) => h.gated).length;
  const empty = cachedLoop.filter((c) => c.length === 0).length;
  lines.push(`rests       ${rested}/${allHits.length} vertices gated, ${empty}/${cachedLoop.length} cells empty`);
  lines.push(`velocity    ${p.velocitySource}   micro-timing ${(p.timing * 100).toFixed(0)}%`);
  if (p.lattice) {
    const g = gapStats(p.alpha, p.density, p.rho + p.phasonRate * t);
    const period = detectPeriod(p.alpha, p.density, p.rho + p.phasonRate * t);
    lines.push(`lattice     α=${p.alpha.toFixed(6)}  density ${p.density.toFixed(2)}`);
    lines.push(`period      ${period ? `${period} steps` : 'none — aperiodic'}`);
    lines.push(`gap word    ${g.gaps.slice(0, 18).join(' ')} …`);
    lines.push(`distinct    {${g.distinct.join(', ')}}  (3-distance bound: ≤3)`);
  }
  lines.push('');

  for (const e of state.perEye) {
    lines.push(`eye ${e.eye + 1}  ch${e.eye + 1}  w ${e.wMin.toFixed(3)} … ${e.wMax.toFixed(3)}`);
    const sample = e.hits.filter((h) => !h.gated).slice(0, 3)
      .map((h) => `c${String(h.cell).padStart(2)}${h.offset > 0.005 ? '+' + h.offset.toFixed(2).slice(1) : '    '} n${h.note} v${String(h.velocity).padStart(3)}`);
    lines.push('        ' + (sample.join('  ') || '— all gated —'));
  }
  $('readout').textContent = lines.join('\n');

  requestAnimationFrame(frame);
}

// --- controls --------------------------------------------------------------
// Rate sliders step at 0.001, so an exact 1/16 would read "0.063" and any
// nudge would silently destroy the rationality that closure depends on.
// Showing the fraction makes both the exact value and its loss visible.
const RATE_IDS = new Set(['wx', 'wy', 'wz', 'eyeRate']);
function fmtRate(v) {
  if (!p.tempoSync) return v.toFixed(3);
  const f = rationalize(v, 96);
  if (!f) return v.toFixed(3);
  return f.q === 1 ? String(f.p) : `${f.p}/${f.q}`;
}

function bindRange(id, key, fmt = (v) => v.toFixed(2)) {
  const el = $(id), out = $(id + '_v');
  el.value = p[key];
  out.textContent = fmt(p[key]);
  el.addEventListener('input', () => {
    p[key] = parseFloat(el.value);
    out.textContent = fmt(p[key]);
    lastLoopBuild = -1e9;
  });
}

function bindSelect(id, key, cast = (v) => v) {
  const el = $(id);
  el.value = p[key];
  el.addEventListener('change', () => {
    p[key] = cast(el.value);
    lastLoopBuild = -1e9;
    if (key === 'gridN' || key === 'bars' || key === 'bpm') transport.reset();
    if (key === 'nEyes') renderEyeLegend();
  });
}

// Browsers restore form-control values across a reload, which would silently
// desync the DOM from `p`. Re-assert state -> DOM whenever the page is shown.
const CONTROLS = {
  ranges: {
    wx: 3, wy: 3, wz: 3, eyeRadius: 2, eyeRate: 3, tilt: 2, bpm: 0, gate: 2,
    baseNote: 0, octaveSpan: 0, timing: 2, depthKeep: 2, radiusGate: 2,
    density: 2, rho: 2, phasonRate: 3, eyeSpread: 2, ecc: 3, lensRadius: 3,
    velMin: 0, velMax: 0,
  },
  lists: ['customDegrees', 'drumMap', 'eyeTranspose'],
  selects: ['solid', 'nEyes', 'projMode', 'gridN', 'bars', 'scale', 'velocitySource', 'eyeRates'],
};

function syncControls() {
  for (const [id, digits] of Object.entries(CONTROLS.ranges)) {
    $(id).value = p[id];
    $(id + '_v').textContent = RATE_IDS.has(id) ? fmtRate(p[id]) : p[id].toFixed(digits);
  }
  for (const id of CONTROLS.selects) $(id).value = p[id];
  for (const id of CONTROLS.lists) $(id).value = (p[id] || []).join(',');
  $('lattice').checked = p.lattice;
  $('tempoSync').checked = p.tempoSync;
  $('rateUnit').textContent = p.tempoSync ? '/bar' : 'rad/s';
  // the slope select holds indices, so find the preset matching the live value
  const ai = SLOPE_PRESETS.findIndex((s) => Math.abs(s.value - p.alpha) < 1e-9);
  if (ai >= 0) $('alphaPreset').value = String(ai);
  renderEyeLegend();
  lastLoopBuild = -1e9;
}

function renderEyeLegend() {
  $('eyeLegend').innerHTML = Array.from({ length: p.nEyes }, (_, i) =>
    `<span><i style="background:${EYE_COLORS[i]}"></i>eye ${i + 1} → ch ${i + 1}</span>`).join('');
}

function populateOptions() {
  $('solid').innerHTML = SOLID_NAMES
    .map((n) => `<option value="${n}">${n[0].toUpperCase()}${n.slice(1)}</option>`).join('');

  $('alphaPreset').innerHTML = SLOPE_PRESETS
    .map((s, i) => `<option value="${i}">${s.name}</option>`).join('');

  $('preset').innerHTML = PRESET_NAMES
    .map((n) => `<option value="${n}">${n}</option>`).join('');
}

function bindGeometryControls() {
  bindSelect('solid', 'solid');
  bindSelect('nEyes', 'nEyes', Number);
  bindSelect('projMode', 'projMode');
  bindSelect('gridN', 'gridN', Number);
  bindSelect('bars', 'bars', Number);
  bindSelect('scale', 'scale');

  bindRange('wx', 'wx', fmtRate);
  bindRange('wy', 'wy', fmtRate);
  bindRange('wz', 'wz', fmtRate);
  bindRange('eyeRadius', 'eyeRadius');
  bindRange('eyeRate', 'eyeRate', fmtRate);
  bindRange('tilt', 'tilt', (v) => v.toFixed(2));
  bindRange('bpm', 'bpm', (v) => String(Math.round(v)));
  bindRange('gate', 'gate');
  bindRange('baseNote', 'baseNote', (v) => String(Math.round(v)));
  bindRange('octaveSpan', 'octaveSpan', (v) => String(Math.round(v)));
  bindRange('timing', 'timing');
  bindRange('depthKeep', 'depthKeep');
  bindRange('radiusGate', 'radiusGate');
  bindSelect('velocitySource', 'velocitySource');
  bindSelect('eyeRates', 'eyeRates');

  $('specLiteral').addEventListener('click', () => {
    Object.assign(p, SPEC_LITERAL);
    syncControls();
    status('Spec-literal: hard grid, no gating, angle-driven velocity, |Dz| depth.');
  });

  for (const id of CONTROLS.lists) {
    $(id).addEventListener('input', (e) => {
      p[id] = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
      lastLoopBuild = -1e9;
    });
  }
  bindRange('velMin', 'velMin', (v) => String(Math.round(v)));
  bindRange('velMax', 'velMax', (v) => String(Math.round(v)));
}

function bindLatticeControls() {
  $('alphaPreset').addEventListener('change', (e) => {
    p.alpha = SLOPE_PRESETS[Number(e.target.value)].value;
    lastLoopBuild = -1e9;
  });
  $('lattice').addEventListener('change', (e) => { p.lattice = e.target.checked; lastLoopBuild = -1e9; });
  bindRange('ecc', 'ecc', (v) => v.toFixed(3));
  bindRange('lensRadius', 'lensRadius', (v) => v.toFixed(3));
  bindRange('density', 'density');
  bindRange('rho', 'rho');
  bindRange('phasonRate', 'phasonRate', (v) => v.toFixed(3));
  bindRange('eyeSpread', 'eyeSpread');
}

function bindPresetControls() {
  $('preset').addEventListener('change', (e) => {
    // presets are applied over DEFAULT_PARAMS so nothing leaks from the last one
    Object.assign(p, DEFAULT_PARAMS, PRESETS[e.target.value]);
    // a preset is a new origin for the knobs, or they would orbit a stale patch
    locked = false;
    unlockedAlpha = p.alpha;
    base = { ...p };
    macroValues.space = 0.5;
    macroValues.energy = 0.5;
    corridor.reset(base);
    syncControls();
    syncMacroUI();
    transport.reset();
    status(`Preset: ${e.target.value}`);
  });
}

function bindTempoControls() {
  // Toggling sync converts the stored rates so the motion you are hearing is
  // preserved — you land on the equivalent cycles-per-bar value and can then
  // round it to something that closes.
  $('tempoSync').addEventListener('change', (e) => {
    Object.assign(p, convertRates(p, e.target.checked));
    p.tempoSync = e.target.checked;
    syncControls();
    status(e.target.checked
      ? 'Tempo sync ON — rates are cycles per bar; the pattern is now tempo-invariant.'
      : 'Tempo sync OFF — rates are radians/second (spec behaviour); nothing closes.');
  });

  $('snapRational').addEventListener('click', () => {
    if (!p.tempoSync) { status('Snap needs tempo sync on — wall-clock rates cannot close.'); return; }
    // the three rotation rates must stay distinct or the solid stops tumbling;
    // the orbit and phason are separate quantities and may share a rung
    const taken = new Set();
    for (const k of ['wx', 'wy', 'wz']) {
      p[k] = snapToLadder(p[k], taken);
      taken.add(Math.abs(p[k]));
    }
    p.eyeRate = snapToLadder(p.eyeRate);
    p.phasonRate = snapToLadder(p.phasonRate);
    syncControls();
    status('Rates snapped to the rational ladder — see the closure line in the readout.');
  });

  $('irrational').addEventListener('click', () => {
    const base = p.wx || 0.2;
    p.wy = base * Math.SQRT2;
    p.wz = base * PHI;
    for (const k of ['wy', 'wz']) { $(k).value = p[k]; $(k + '_v').textContent = p[k].toFixed(3); }
    lastLoopBuild = -1e9;
  });
}

function bindTransportControls() {
  $('bpm').addEventListener('change', () => transport.reset());
  $('play').addEventListener('click', () => {
    if (transport.state.playing) transport.stop();
    else { synth.ensure(); transport.start(); }
  });
  $('reset').addEventListener('click', () => transport.reset());
}

function bindMidiOutputControls() {
  $('connect').addEventListener('click', async () => {
    try {
      const ports = await midi.init();
      if (!ports.length) {
        status('Web MIDI connected, but no output ports found.\nOn macOS enable the IAC Driver in Audio MIDI Setup, then reconnect.');
        return;
      }
      $('midiPort').innerHTML = ports.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
      midi.select(ports[0].id);
      status(`MIDI out: ${ports[0].name}`);
    } catch (err) {
      status(String(err.message || err));
    }
  });
  $('midiPort').addEventListener('change', (e) => {
    midi.select(e.target.value);
    status(`MIDI out: ${midi.port ? midi.port.name : 'none'}`);
  });
}

function bindExportControls() {
  $('export').addEventListener('click', () => {
    const passes = Number($('passes').value) || 1;
    const cells = renderTake(p, transport.musicalTimeMs() / 1000, passes);
    const bytes = writeMidiFile(cells, { bpm: p.bpm, gridN: p.gridN, nEyes: p.nEyes, gate: p.gate });
    downloadBytes(bytes, `${p.solid}-${p.nEyes}eye-${p.bars}bar-x${passes}-${Math.round(p.bpm)}bpm.mid`);
    const n = cells.reduce((a, c) => a + c.length, 0);
    status(`Exported ${passes}× ${p.bars} bars = ${p.bars * passes} bars, ${n} notes, ${bytes.length} bytes.`);
  });
}

function nudgeCorridor(delta) {
  const current = corridor.view();
  if (!current.ready) {
    status('Capture corridor B before morphing.');
    return;
  }
  corridor.setPosition(current.position + delta);
}

function bindCorridorControls() {
  $('corridorA').addEventListener('click', () => captureCorridorSide('a'));
  $('corridorB').addEventListener('click', () => captureCorridorSide('b'));
  $('corridorMorph').addEventListener('input', (event) => {
    corridor.setPosition(parseFloat(event.target.value));
  });
  $('corridorHome').addEventListener('click', () => {
    corridor.returnToA();
    status(corridor.view().pendingSide
      ? 'Return to A queued for a bar boundary.'
      : 'Returned to corridor A.');
  });
}

function bindMacroControls() {
  for (const [key, id] of [['space', 'mSpace'], ['energy', 'mEnergy']]) {
    $(id).addEventListener('input', (e) => {
      macroValues[key] = parseFloat(e.target.value);
      applyMacroState();
    });
  }
  $('capture').addEventListener('click', captureBase);
  $('lockToggle').addEventListener('click', () => {
    locked = !locked;
    applyMacroState();
    status(locked ? 'Locked — rational slope, the mask repeats every 8 steps.' : 'Free — 1/φ, never repeats.');
  });
}

function enterPerf() {
  $('perf').hidden = false;
  $('perf').focus();
}

function exitPerf() {
  $('perf').hidden = true;
  syncControls();
  syncMacroUI();
}

function bindPerformanceControls() {
  $('perfMode').addEventListener('click', enterPerf);

  // drag: left half of the screen is Space, right half is Energy
  // track the delta ourselves rather than trusting movementY, which is absent
  // on synthetic events and inconsistent across pointer capture and DPI
  let dragKey = null, lastY = 0;
  $('perf').addEventListener('pointerdown', (e) => {
    // split on the overlay's own box, not window.innerWidth — some embedded
    // browser contexts report innerWidth as 0, which silently pins every drag
    // to one macro
    const r = $('perf').getBoundingClientRect();
    dragKey = (e.clientX - r.left) < r.width / 2 ? 'space' : 'energy';
    lastY = e.clientY;
    try { $('perf').setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
  });
  $('perf').addEventListener('pointermove', (e) => {
    if (!dragKey) return;
    const dy = e.clientY - lastY;
    lastY = e.clientY;
    nudgeMacro(dragKey, -dy * 0.0035);
  });
  const endDrag = () => { dragKey = null; };
  $('perf').addEventListener('pointerup', endDrag);
  $('perf').addEventListener('pointercancel', endDrag);
}

function bindMidiInputAndClock() {
  for (const [key, btn] of [['space', 'learnSpace'], ['energy', 'learnEnergy']]) {
    $(btn).addEventListener('click', async () => {
      try {
        if (!midiIn.access) {
          const ins = await midiIn.init();
          if (!ins.length) { status('Web MIDI connected, but no input ports found.'); return; }
        }
        midiIn.learn(key);
        status(`Learning ${key} — move a knob or fader on your controller.`);
      } catch (err) { status(String(err.message || err)); }
    });
  }
  $('relativeCC').addEventListener('change', (e) => { midiIn.relative = e.target.checked; });

  $('clockSource').addEventListener('change', async (e) => {
    const external = e.target.value === 'external';
    if (external) {
      try {
        if (!midiIn.access) {
          const ins = await midiIn.init();
          if (!ins.length) {
            e.target.value = 'internal';
            status('No MIDI inputs found. Enable the IAC Driver in Audio MIDI Setup,\nand switch Sync on for that port in Ableton.');
            return;
          }
        }
      } catch (err) { e.target.value = 'internal'; status(String(err.message || err)); return; }
    }
    clock.setExternal(external);
    $('play').disabled = external;
    status(external
      ? 'External clock — the app now follows the DAW.\nIn Ableton: Settings → Link/Tempo/MIDI → Sync ON for the IAC output port.'
      : 'Internal clock — the app runs its own transport.');
  });
  midiIn.onClock = () => clock.onTick();
  midiIn.onTransport = (kind) => clock.onTransport(kind);
  midiIn.onSongPosition = (sixteenths) => clock.setSongPosition(sixteenths);
  midiIn.onLearned = (key, cc, ch) => {
    status(`${key} bound to CC ${cc} on channel ${ch + 1}.`);
    $(key === 'space' ? 'learnSpace' : 'learnEnergy').textContent = `${key === 'space' ? 'Space' : 'Energy'}: cc${cc}`;
  };
  midiIn.onValue = (key, v, isDelta) => {
    if (isDelta) nudgeMacro(key, v);
    else { macroValues[key] = v; applyMacroState({ sync: !perfOpen() }); if (perfOpen()) syncMacroUI(); }
  };
}

function bindKeyboardControls() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const step = e.shiftKey ? 0.005 : 0.02;
    switch (e.code) {
      case 'Space': e.preventDefault(); $('play').click(); break;
      case 'ArrowLeft': e.preventDefault(); nudgeMacro('space', -step); break;
      case 'ArrowRight': e.preventDefault(); nudgeMacro('space', step); break;
      case 'ArrowDown': e.preventDefault(); nudgeMacro('energy', -step); break;
      case 'ArrowUp': e.preventDefault(); nudgeMacro('energy', step); break;
      case 'KeyC': captureBase(); break;
      case 'KeyL': $('lockToggle').click(); break;
      case 'BracketLeft': e.preventDefault(); nudgeCorridor(e.shiftKey ? -0.01 : -0.05); break;
      case 'BracketRight': e.preventDefault(); nudgeCorridor(e.shiftKey ? 0.01 : 0.05); break;
      case 'KeyH': e.preventDefault(); $('corridorHome').click(); break;
      case 'KeyP': perfOpen() ? exitPerf() : enterPerf(); break;
      case 'Escape': if (perfOpen()) exitPerf(); break;
      default: break;
    }
  });
}

function init() {
  populateOptions();
  bindGeometryControls();
  bindLatticeControls();
  bindPresetControls();
  bindTempoControls();
  bindTransportControls();
  bindMidiOutputControls();
  bindExportControls();
  bindCorridorControls();
  bindMacroControls();
  bindPerformanceControls();
  bindMidiInputAndClock();
  bindKeyboardControls();

  syncControls();
  syncMacroUI();
  syncCorridorUI();
  window.addEventListener('pageshow', syncControls);
  status('Ready. Preview synth is on; Connect Web MIDI to drive a DAW\n(Chrome/Edge only, and macOS needs the IAC Driver enabled).');
  requestAnimationFrame(frame);
}

init();
