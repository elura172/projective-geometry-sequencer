// Scale degrees are semitone offsets from the root, within one octave.

const PENTATONIC = [0, 2, 4, 7, 9];
const WHOLE_TONE = [0, 2, 4, 6, 8, 10];
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Fold any positive ratio into (1, 2]. */
export function foldOctave(ratio) {
  let r = ratio;
  if (!(r > 0) || !isFinite(r)) return 2;
  while (r <= 1) r *= 2;
  while (r > 2) r /= 2;
  return r;
}

/**
 * "Native" scale: stack the solid's own edge/circumradius ratio as a
 * just-intonation generator, folding every step back into one octave.
 * Degrees are rounded to the nearest semitone so they land on MIDI notes.
 */
export function nativeScale(edgeRatio, steps = 7) {
  const gen = foldOctave(edgeRatio);
  const set = new Set([0]);
  let r = 1;
  for (let i = 0; i < steps; i++) {
    r = foldOctave(r * gen);
    const semis = Math.round(12 * Math.log2(r)) % 12;
    set.add((semis + 12) % 12);
  }
  return [...set].sort((a, b) => a - b);
}

export function getScale(name, solid, customDegrees) {
  switch (name) {
    case 'pentatonic': return PENTATONIC;
    case 'wholetone': return WHOLE_TONE;
    case 'chromatic': return CHROMATIC;
    case 'custom':
      return (customDegrees && customDegrees.length) ? customDegrees : CHROMATIC;
    case 'drum':
      return CHROMATIC; // unused — the drum map bypasses scale quantization
    case 'native':
    default:
      return nativeScale(solid.edgeRatio);
  }
}

/** Snap a continuous semitone offset above the root to the nearest scale degree. */
export function quantizeToScale(semitones, degrees) {
  if (!degrees.length) return Math.round(semitones);
  const oct = Math.floor(semitones / 12);
  const within = semitones - oct * 12;
  let best = degrees[0], bestD = Infinity;
  for (const d of [...degrees, degrees[0] + 12]) {
    const dist = Math.abs(d - within);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return oct * 12 + best;
}

const EPS = 1e-6;
/** Minimum accepted spread of w; below this the pitch mapping would jitter wildly. */
const MIN_SPREAD = 1e-3;

/**
 * Depth -> MIDI note. w is normalized against the min/max across THIS eye's
 * view of the solid, so the same vertex sings a different note per eye.
 */
export function depthToNote(w, wMin, wMax, baseNote, octaveSpan, degrees) {
  const spread = wMax - wMin;
  const n = spread > MIN_SPREAD ? (w - wMin) / (spread + EPS) : 0.5;
  const semis = Math.max(0, Math.min(1, n)) * octaveSpan * 12;
  const note = baseNote + quantizeToScale(semis, degrees);
  return Math.max(0, Math.min(127, Math.round(note)));
}

/** Angle -> velocity. Floored to 1: velocity 0 is Note Off on the wire. */
export function fracToVelocity(frac) {
  return Math.max(1, Math.min(127, 1 + Math.floor(frac * 126)));
}

/**
 * Map a normalized [0,1] drive into a velocity window. The floor matters in
 * practice: a velocity-1 note is inaudible in most drum racks, so a raw 1..127
 * mapping throws away the quiet half of every pattern.
 */
export function mapVelocity(norm, lo = 1, hi = 127) {
  const a = Math.max(1, Math.min(127, Math.round(lo)));
  const b = Math.max(a, Math.min(127, Math.round(hi)));
  const n = Math.max(0, Math.min(1, norm));
  return Math.max(1, Math.min(127, Math.round(a + (b - a) * n)));
}

/**
 * General MIDI percussion, ordered for techno: the depth axis walks from kick
 * through the hats and into the metals, so "near" and "far" stay musically
 * meaningful rather than arbitrary. Edit freely — it is just a note list.
 */
export const DEFAULT_DRUM_MAP = [
  36, // bass drum
  38, // acoustic snare
  42, // closed hi-hat
  46, // open hi-hat
  39, // hand clap
  37, // side stick / rim
  75, // claves
  56, // cowbell
  51, // ride cymbal
  44, // pedal hi-hat
  43, // low tom
  49, // crash cymbal
];

/** Depth -> a slot in the drum map. Bypasses scale and octave entirely. */
export function drumNote(wNorm, map) {
  const m = (map && map.length) ? map : DEFAULT_DRUM_MAP;
  const i = Math.max(0, Math.min(m.length - 1, Math.floor(wNorm * m.length)));
  return Math.max(0, Math.min(127, Math.round(m[i])));
}
