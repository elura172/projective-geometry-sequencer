// A safe, patch-relative path through the instrument's parameter space.
//
// Continuous values move on every gesture. Topology-changing values switch as
// one bundle at a scheduler-provided bar boundary, so a morph cannot change the
// solid, scale, voice count, or pitch map halfway through a bar.

export const CORRIDOR_CONTINUOUS = [
  'eyeRadius', 'tilt',
  'gate', 'timing', 'depthKeep', 'radiusGate',
  'ecc', 'lensRadius',
  'density', 'rho', 'eyeSpread',
  'velMin', 'velMax',
];

// These describe the global clock or the recurrence contract. A corridor is a
// performance gesture inside that contract, not a transport reconfiguration.
export const CORRIDOR_EXCLUDED = new Set([
  'gridN', 'bars', 'bpm', 'tempoSync', 'alpha',
]);

const INTEGER_CONTINUOUS = new Set(['velMin', 'velMax']);
const CONTINUOUS = new Set(CORRIDOR_CONTINUOUS);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function clonePatch(patch) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [
    key,
    Array.isArray(value) ? [...value] : value,
  ]));
}

function equalValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return Object.is(a, b);
}

export function interpolateCorridor(a, b, position) {
  const t = clamp01(position);
  const values = {};
  for (const key of CORRIDOR_CONTINUOUS) {
    if (!Number.isFinite(a?.[key]) || !Number.isFinite(b?.[key])) continue;
    const value = a[key] + (b[key] - a[key]) * t;
    values[key] = INTEGER_CONTINUOUS.has(key) ? Math.round(value) : value;
  }
  if (values.velMin > values.velMax) {
    [values.velMin, values.velMax] = [values.velMax, values.velMin];
  }
  return values;
}

export function discreteCorridorValues(patch) {
  const values = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (CONTINUOUS.has(key) || CORRIDOR_EXCLUDED.has(key)) continue;
    values[key] = Array.isArray(value) ? [...value] : value;
  }
  return values;
}

export function corridorDifferences(a, b) {
  if (!a || !b) return [];
  return Object.keys(discreteCorridorValues(a))
    .filter((key) => !equalValue(a[key], b[key]));
}

export function createCorridorController({
  initial,
  isRunning = () => false,
  onContinuous = () => {},
  onDiscrete = () => {},
  onChange = () => {},
} = {}) {
  if (!initial) throw new Error('corridor requires an initial patch');

  const state = {
    a: clonePatch(initial),
    b: null,
    position: 0,
    appliedSide: 'a',
    pendingSide: null,
  };

  function view() {
    return {
      ready: Boolean(state.b),
      position: state.position,
      appliedSide: state.appliedSide,
      pendingSide: state.pendingSide,
      discreteChanges: corridorDifferences(state.a, state.b),
    };
  }

  function emit() {
    const current = view();
    onChange(current);
    return current;
  }

  function commit(side) {
    const patch = state[side];
    if (!patch) return false;
    onDiscrete(discreteCorridorValues(patch), side);
    state.appliedSide = side;
    state.pendingSide = null;
    return true;
  }

  function capture(side, patch) {
    if (side !== 'a' && side !== 'b') throw new Error(`unknown corridor side: ${side}`);
    state[side] = clonePatch(patch);
    state.position = side === 'a' ? 0 : 1;
    state.appliedSide = side;
    state.pendingSide = null;
    return emit();
  }

  function reset(patch) {
    state.a = clonePatch(patch);
    state.b = null;
    state.position = 0;
    state.appliedSide = 'a';
    state.pendingSide = null;
    return emit();
  }

  function setPosition(position, { immediate = false } = {}) {
    if (!state.b) return emit();
    state.position = clamp01(position);
    onContinuous(interpolateCorridor(state.a, state.b, state.position));

    const desiredSide = state.position < 0.5 ? 'a' : 'b';
    if (desiredSide === state.appliedSide) {
      state.pendingSide = null;
    } else if (isRunning() && !immediate) {
      state.pendingSide = desiredSide;
    } else {
      commit(desiredSide);
    }
    return emit();
  }

  function returnToA({ immediate = false } = {}) {
    state.position = 0;
    onContinuous(interpolateCorridor(state.a, state.b || state.a, 0));
    if (isRunning() && !immediate) state.pendingSide = 'a';
    else commit('a');
    return emit();
  }

  function flushAtStep(stepIndex, cellsPerBar) {
    if (!state.pendingSide || !Number.isInteger(stepIndex) || !Number.isInteger(cellsPerBar) || cellsPerBar < 1) {
      return false;
    }
    if (stepIndex % cellsPerBar !== 0) return false;
    const side = state.pendingSide;
    const committed = commit(side);
    if (committed) emit();
    return committed;
  }

  return { state, view, capture, reset, setPosition, returnToA, flushAtStep };
}
