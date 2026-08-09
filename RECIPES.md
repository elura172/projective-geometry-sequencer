# Recipes

Starting points, and the measurements behind them. Every number here came from
running the generator, not from taste — so when you build your own, you can
reason about density and register instead of guessing.

All presets live in [src/presets.js](src/presets.js) and load from the **Preset**
dropdown at the top of the sidebar. Adding one is a copy-paste; see
[Adding your own](#adding-your-own) at the bottom.

---

## Three things to know before you tune anything

### 1. The density law

**Total notes ≈ vertices × eyes, regardless of loop length.**

Each vertex lands in exactly one grid cell per sample, so lengthening the loop
*dilutes* the pattern rather than filling it. Measured with a dodecahedron and
3 eyes, gates open:

| Loop | 1 bar | 2 bars | 4 bars | 8 bars | 16 bars |
|---|---|---|---|---|---|
| Notes | 61 | 60 | 58 | 60 | 58 |

Sixty notes every time — spread over 16 cells or over 256. So **density is
chosen by the solid and the eye count**, never by the number of bars:

| | 1 eye | 2 eyes | 3 eyes | 4 eyes |
|---|---|---|---|---|
| Tetrahedron (4V) | 4 | 8 | 12 | 16 |
| Octahedron (6V) | 6 | 12 | 18 | 24 |
| Cube (8V) | 9 | 17 | 25 | 33 |
| Icosahedron (12V) | 12 | 23 | 36 | 48 |
| Dodecahedron (20V) | 21 | 41 | 61 | 82 |

That is the ceiling *before* the depth gate, the radius gate and the
quasilattice each take their cut. A cube over 4 bars is a bassline; if you want
a busy 4-bar groove you need a dodecahedron or icosahedron and 3–4 eyes.

**The corollary that matters most for exporting.** Do not reach for a long loop
to get a long take — you get the same handful of notes stretched over more bars.
Use **Export passes** instead: it concatenates N successive renders of a short
loop, each sampled at the time it would actually play. Same 16 bars, measured on
`Techno · stab`:

| | cells | notes |
|---|---|---|
| One 16-bar loop | 256 | **32** |
| 8 passes of 2 bars | 256 | **202** |

All 8 passes come out distinct, because between passes the solid has turned, the
eyes have moved along their orbits, and the quasilattice has advanced. That is
the setting for a long evolving take.

### 2. Velocity sources are not interchangeable

Measured over 24 loop renders, dodecahedron, 3 eyes, lens 0.4:

| Source | min | p25 | median | p75 | max | below vel 20 |
|---|---|---|---|---|---|---|
| `angle` (spec) | 1 | 33 | 63 | 96 | 126 | 15% |
| `radius` | 1 | 57 | 95 | 119 | 127 | **11%** |
| `approach` | 1 | 31 | 64 | 96 | 127 | 18% |
| `magnification` | 1 | 3 | **10** | 30 | 127 | **64%** |

`radius` is the healthy default. **`magnification` is an accent source, not a
general one** — its distribution is so skewed that two thirds of notes land
below velocity 20, effectively inaudible. Use it when you want rare, violent
accents on vertices crossing the lens caustic, and raise **Vel min** to keep the
rest of the pattern present.

Remember `angle` is structurally pinned: velocity is a pure function of grid
position, so cell 0 is permanently quiet. See the main README.

### 3. Pick the solid for density, the scale separately

The Native scales are derived from each solid's own edge/circumradius ratio, and
some are more usable than others:

| Solid | Native scale | Character |
|---|---|---|
| Cube | `0 2 3 5 7 10` | **minor hexatonic — genuinely musical** |
| Dodecahedron | `0 1 6 7` | dark tetrad: root, ♭2, tritone, 5 |
| Tetrahedron | `0 1 3 5 6 8 10 11` | octatonic, chromatic-heavy |
| Octahedron | `0 6` | two notes, tritone only |
| Icosahedron | `0 1 2 3 4 5 6` | chromatic cluster |

The cube's Native scale is the pick of the bunch — but the cube is only 8
vertices, so it is sparse. **Decouple the two**: choose the solid for density,
then set **Scale → Custom** and type the degrees you want. `0,3,5,7,10` (minor
pentatonic) is the default there and works everywhere.

---

## Deep techno

All four share 130 BPM, 1/16 grid, `radius` velocity, tilt 0.5, lens 0.25,
slope 1/φ, eye spread 0.382, velocity window 40–122.

Densities below are measured at a single loop render; they drift a little as the
geometry turns, which is the point.

### `Techno · bass` — cube, 2 eyes, 2 bars
Custom `0,3,5,7,10` · base 36, span 1 · gate 0.45 · timing 0.10 · depth keep 0.9
· density 0.7 · orbit r 3.0, rate 0.075, e 0.35 · ω 0.05

→ **12 notes / 32 cells, 66% rest.** Pitches C2 D#2 F2 A#2. One orbital swell
every 45 bars.

### `Techno · stab` — dodecahedron, 3 eyes, 4 bars
Custom `0,3,5,7,10` · base 57, span 2, transpose `0,0,-12` · gate 0.20 · timing
0.12 · depth keep 0.72 · density 0.6 · orbit r 2.4, rate 0.06, e 0.45 · ω 0.06

→ **24 notes / 64 cells, 72% rest.** Clean A minor pentatonic across A3–D5, with
eye 3 dropped an octave for weight. Swell every 57 bars.

### `Techno · drums` — icosahedron, 4 eyes, 4 bars
Scale **Drum map** · gate 0.12 · timing 0.15 · depth keep 0.68 · density 0.55 ·
orbit r 2.3, rate 0.11, e 0.5 · ω 0.09 · velocity window 55–127

→ **15 notes / 64 cells, 77% rest** across all four channels. Depth walks the
drum map from kick through hats into metals, so near/far stays musical.

### `Techno · locked` — cube, 3 eyes, 2 bars
Slope **5/8**, drift 0, density 0.75, eye spread 0.125 · depth keep 1.0 · timing
0.08 · base 36, span 2, transpose `0,12,24`

→ **23 notes / 32 cells, 38% rest.** The rational slope makes the mask repeat
with a period of **exactly 8 steps — half a bar**, so this one genuinely locks.

**The move:** run `locked` and `stab` together. A rational-slope voice that
repeats every half bar underneath an irrational-slope voice that never repeats
at all. That contrast is most of what "hypnotic" means.

### Making a preset tempo-portable

These recipes are tuned at **130 BPM and only work there**, because by default
the geometry runs on wall-clock seconds while the grid runs on musical time.
Move one to 140 and you get a different rhythm, not the same one faster.

To port a recipe to another tempo — or to make a pattern that genuinely repeats:

1. Load the preset, set the tempo you want.
2. Turn on **Tempo sync**. The rates convert to cycles per bar with the motion
   preserved, and the pattern becomes tempo-invariant from then on.
3. Set **Eye rates → Rational**. The spec's φ ratios are irrational by design,
   so a multi-eye rig can never close while they are in use.
4. Hit **Snap rates to rational** and read the closure line.

The rate sliders then show exact fractions (`1/16`, not `0.063`). Coarse
fractions like 1/4 and 1/2 close in a handful of bars; slow ones cost long
periods — `Techno · locked` snaps to ω 1/48, 1/24, 1/16 and closes at 288 bars.

### Orbit rate is your arrangement dial

One revolution at rate 0.06–0.11 takes 57–105 seconds — **31 to 57 bars** at
130 BPM. The Kepler swell (see the README) then operates at track scale rather
than bar scale, which is where deep techno wants its movement. Slower rate =
longer arc.

---

## Other territory

**`Ambient · slow orbit`** — dodecahedron, 3 eyes, 76 BPM, 1/8, no lattice,
gate 0.95, timing 0.5, eccentricity 0.55 at rate 0.03 (a 3½-minute orbit).
53 notes over 32 cells: dense, overlapping, breathing.

**`Close encounter`** — octahedron at eccentricity 0.72 with orbital radius 1.9,
so perihelion is 0.53 and the eye passes **inside the form**. Velocity from
`magnification` with a large Einstein radius, so caustic crossings are the
accents. The readout warns; that is the effect, not a fault.

---

## Into a DAW

**Export** writes one track per eye, so a `.mid` drops into Ableton already
split by voice — eye 1 on its own track, eye 2 on the next.

**Live**, eyes 1–4 are MIDI channels 1–4 over the IAC bus (Chrome/Edge only, and
the IAC Driver has to be enabled in Audio MIDI Setup). Set **Clock → External —
follow DAW** and turn **Sync** on for that port in Ableton's MIDI settings, and
the app slaves to Ableton's transport — press record in Ableton and the take is
in time by construction. Full setup in the README.

Two workflow notes:

- The **solid and grid are global**, so a single pass gives every voice the same
  form and resolution. To layer a cube bassline under an icosahedron percussion
  part, export two passes and stack them.
- **Per-eye transpose** covers register within one pass, but pitch *range* is
  still shared. If eye 1 should be a bass and eye 2 a lead, transpose eye 2 up
  rather than trying to widen the octave span for both.

---

## Adding your own

Presets are plain objects in [src/presets.js](src/presets.js), applied on top of
`DEFAULT_PARAMS`, so each one is a complete statement and nothing leaks between
them. Keys are exactly the parameter names in `DEFAULT_PARAMS`:

```js
'My preset': {
  solid: 'icosahedron', nEyes: 3, bars: 4,
  bpm: 132, gridN: 16,
  scale: 'custom', customDegrees: [0, 3, 5, 7, 10],
  baseNote: 48, octaveSpan: 2, eyeTranspose: [0, 12, -12, 0],
  velocitySource: 'radius', velMin: 40, velMax: 122,
  timing: 0.12, depthKeep: 0.7, radiusGate: 0,
  lattice: true, alpha: 1 / 1.618, density: 0.6, phasonRate: 0.005,
  ecc: 0.4, lensRadius: 0.25, eyeRadius: 2.4, eyeRate: 0.07,
  wx: 0.06, wy: 0.085, wz: 0.097,
},
```

`test/sweep.mjs` renders **every** preset and asserts it produces in-range,
audible, non-silent notes and a valid MIDI export — so a new preset is checked
the moment you run `bun test/sweep.mjs`.

A rough order for dialling in something new:

1. **Solid + eye count** → sets your ceiling (density law above).
2. **Bars + grid** → how thinly that ceiling is spread.
3. **Depth keep, radius gate, lattice density** → cut down to the rest you want.
   Aim for 60–80% empty cells for techno, 20–40% for something dense.
4. **Scale + base note + transpose** → register and harmony.
5. **Velocity source + window** → dynamics. Start with `radius`, 40–122.
6. **Eccentricity + orbit rate** → the long arc. Rate 0.03–0.12 is arrangement
   scale; above ~0.3 it becomes an audible wobble instead.
7. **Slope** → rational to lock, 1/φ to never repeat.
