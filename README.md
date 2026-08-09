# Projective Geometry Sequencer

A Platonic solid spins. Eye-points orbit it. Each eye projects the solid's
vertices through a **true perspective divide** onto a circle; the circle is
quantized to a grid; the grid is MIDI.

```
3D  solid × rotation(ωx, ωy, ωz)      → vertex positions
2D  per eye: perspective divide x/w   → angle θ, depth w
1D  θ → grid cell (when) + velocity (how hard)
    w → pitch (what note)
    eye → MIDI channel (which voice)
```

## Run

```bash
python3 -m http.server 5177 -d ~/Desktop/projective-geometry-sequencer
```

Open <http://localhost:5177>. Space toggles play.

Headless math sweep (400+ parameter combinations, projection conditioning,
scale helpers, SMF byte output):

```bash
bun test/sweep.mjs
```

**[RECIPES.md](RECIPES.md)** has the presets, the measurements behind them, and
the three things (density law, velocity distributions, scale/solid decoupling)
worth knowing before you tune anything.

## Output

- **Preview synth** (on by default) — audible immediately, no DAW needed.
- **Live Web MIDI** — *Connect Web MIDI*, then pick a port. Chrome/Edge only
  (Safari does not implement Web MIDI), over localhost or https. On macOS a
  virtual bus requires the **IAC Driver** to be enabled in Audio MIDI Setup.
- **`.mid` export** — one track per eye, format 1, 480 PPQ, with tempo and
  time-signature meta events. Drag straight into Ableton.

OSC output is not implemented: a browser cannot open a UDP socket, so it would
need a local bridge process. The `.mid` and live-MIDI paths cover the spec's
"at least one, ideally two".

## Deviations from the spec

**Depth is measured along each eye's own view axis, not world z.** The spec's
`w = |Dz| / scale` is degenerate: `abs()` folds in-front and behind-the-eye
together, and when an orbiting eye reaches the world x-axis, `Dz ≈ 0` for most
vertices, every `w` slams into the clamp and the projection blows out. That
happens twice per orbit — at ordinary settings, not edge cases. The default
`view` mode builds an orthonormal basis per eye (`forward = normalize(-E)`) and
takes `w = dot(D, forward)`. Still a true perspective divide; the `1/w`
nonlinearity is untouched. The literal formula is kept as the **spec-literal
|Dz|** depth mode. `test/sweep.mjs` sweeps orbit phase 0→2π at 5° steps across
all five solids and reports 0 degenerate frames for `view`, 2 for `worldz`.

**No Three.js.** The viewport is dots, lines, and rays — its own small
perspective camera on a 2D canvas. The whole app is dependency-free vanilla ES
modules: no CDN, no npm install, no build step.

**The spec's ratio table is wrong in three places.** Vertices are generated
from standard coordinates normalized to unit circumradius, so edge/circumradius
is derived numerically rather than typed in:

| Solid | Spec says | Actual |
|---|---|---|
| Tetrahedron | 1.633 | 1.6330 ✓ |
| Octahedron | 1.414 | 1.4142 ✓ |
| Cube | 1.732 (space diagonal) | **1.1547** |
| Icosahedron | 1.0 | **1.0515** |
| Dodecahedron | 0.618 | **0.7136** |

The Native scale stacks this ratio as a just-intonation generator, folding each
step into (1, 2] before rounding to a semitone — the spec's raw 0.618 and 1.732
are not intervals within an octave.

Two Native scales are unusual but correct. **Octahedron derives to `[0, 6]`** —
a two-note tritone scale, because 12·log₂(√2) = 6 exactly, so the stack closes
on itself after one step. **Icosahedron derives to `[0,1,2,3,4,5,6]`**, a
chromatic cluster. Both are faithful to the derivation, not bugs; pick another
scale if you want them to sing differently.

## Additions the spec omitted

- **Note-offs.** The spec only describes Note On. There is a **Gate** control
  (note length as a fraction of a grid step) and every Note On gets a matching
  Note Off, in both the live stream and the file.
- **Velocity floor of 1.** The spec asks for "ghost notes (vel ~0)", but
  velocity 0 *is* Note Off on the wire — those notes would be silent or would
  cut a sounding note. Mapping is `1 + floor(frac × 126)`.
- **Grid-step sampling.** Geometry is sampled once per grid tick from a
  timestamped lookahead scheduler, not once per animation frame; emitting at
  60fps would flood the port.
- **Pause actually stops.** Both sinks are flushed on pause (`MIDIOutput.clear()`
  plus CC 123/120; scheduled oscillators stopped), because notes already queued
  inside the lookahead window would otherwise keep sounding after you hit pause —
  up to 2.2 s when the tab is in the background.
- **Guards.** `w_max − w_min → 0` (near-symmetric eye placement) would divide by
  zero and make pitch jitter across the full range; below a spread floor the
  pitch mapping holds at centre. Two vertices landing in one cell with the same
  channel and pitch are deduped, since the first Note Off would kill both.

One clamp worth knowing about: **Base note + Octaves can exceed MIDI range.**
At the slider extremes (base 84 + 5 octaves = 144) the top of the pitch map is
clamped to 127, so high notes pile onto a single pitch. Nothing breaks; keep
`baseNote + 12 × octaveSpan ≤ 127` for a fully expressed range.

## Groove

Three quantities the spec computes and discards are what make the output feel
like a pattern rather than a note generator. All three are on by default; the
**Revert to spec-literal** button restores the spec's exact behaviour.

**Micro-timing** (`timing`, default 0.35). `cell = floor(frac × N)` throws away
the sub-cell remainder — which is precisely the crowding-and-stretching the
`1/w` divide exists to produce. It is kept and applied as a tick offset on the
SMF note-on and as a timestamp offset on the live stream. 0 = hard on the grid,
1 = raw geometric position, unquantized.

**Moving rests** (`depthKeep` 0.8, `radiusGate` 0). Every vertex used to fire,
so there were no holes — and holes are what make a groove a groove. Vertices on
the far side of the form (normalized depth above `depthKeep`) and vertices too
close to the projection axis (normalized radius below `radiusGate`) go silent.
As the solid turns, the holes move. Gated vertices render as hollow dots in the
circle view, so the rests are visible rather than merely absent.

**Velocity source** (`velocitySource`, default `radius`). Measured over 120 time
samples, with the spec's angle-driven velocity:

| Source | Cell 0 velocity | Cell 15 velocity | Mean per-cell span |
|---|---|---|---|
| `angle` (spec) | always 1–8 | always 119–126 | **7.8** |
| `radius` | 1–127 | 1–127 | 126 |
| `approach` | 39–127 | 28–127 | 118 |

126/16 = 7.9, exactly one cell slice — so under the spec's mapping the first
cell is permanently a ghost note and the last is permanently an accent, forever.
`radius` uses the projected radius `r` (which the spec computes and never uses);
`approach` uses −dw/dt, so a vertex rushing the eye reads loud.

## Gravity — one mass at the origin

A single mass sits where the solid sits, and it does the two things mass does:
it governs the **orbits** of the eyes, and it **bends their rays**.

### Kepler orbits

[eyes.js](src/eyes.js) no longer moves the eyes on kinematic circles. They fall
into ellipses with the mass at a focus, and `eyeRate` becomes the *mean motion*
rather than a constant angular rate. Kepler's equation `M = E − e·sin E` is
solved per frame by Newton-Raphson.

The musical payload is **Kepler's second law**: equal areas in equal times, so
angular velocity is not constant. The eye sweeps fast at perihelion and slow at
aphelion, in the exact ratio `((1+e)/(1−e))²`:

| e | sweep ratio |
|---|---|
| 0 | 1× (identical to the pre-gravity circle) |
| 0.3 | 3.45× |
| 0.55 | 11.86× |
| 0.6 | 16× |

Since the perspective divide is distance-sensitive too — closer eye, harder warp
— closest approach delivers maximum sweep rate *and* maximum warp at the same
instant, then releases. That is a swell-and-collapse envelope once per orbit,
from orbital mechanics rather than an LFO. **Eccentricity is the only dial, and
e = 0 reproduces the original behaviour exactly** (verified to 8.9e-16).

`3rd law rates` makes the outer eyes obey `n ∝ a^(−3/2)` like real satellites,
instead of the spec's fractal φ ratios.

### Ray lensing

A point-mass thin lens in the image plane. The lens equation
`β = θ − θE²/θ` is inverted for the primary image:

```
θ = ( β + √(β² + 4·θE²) ) / 2      μ = 1 / (1 − (θE/θ)⁴)
```

**Correction to an earlier claim.** I said lensing would create a rhythmic
pocket by crowding notes toward an attractor angle. It does not, and cannot. The
mass is at the origin and every eye looks at the origin, so the lens projects to
the exact centre of each image; by circular symmetry the deflection is **purely
radial** and the polar angle is untouched. Lensing changes radius and brightness,
never timing. Verified directly: across 4800 vertex projections, 4800 radii
changed and **0 grid cells moved**, with a maximum θ shift of 8.9e-16.

The timing pocket comes from Kepler's second law instead — which is the better
answer anyway, since a pocket is a *temporal* phenomenon. An angular pocket would
require the mass to sit off the line of sight.

What lensing gives instead is **magnification**, which is a genuine new velocity
source: `μ` diverges as a vertex approaches the Einstein radius, so vertices
crossing the caustic are accents. At θE = 0.5 the observed range is 1.17× to
28.5×, mapped logarithmically and clamped at 50× so a caustic crossing is a loud
note rather than an infinity.

### What the tests establish

- Kepler's equation is solved to **1.8e-15** across e = 0 … 0.95.
- **Second law holds**: areal velocity `½r²·dν/dt` is constant to <1e-9 at
  e = 0, 0.35, 0.6, 0.85, even as r and dν/dt each swing by an order of magnitude.
- Measured sweep ratio matches `((1+e)/(1−e))²` to 1e-9.
- The lens equation is satisfied to 8.9e-16; μ ≥ 1 always (a lens cannot dim);
  θ ≥ θE always; θE = 0 is the exact identity.
- Lensing is radial-only — 0 grid cells moved, as above.

### The failure mode, and it is reachable

Perihelion is `a(1−e)`, and the solid's circumradius is 1. At the default
a = 2.4, eccentricity above ~0.58 puts the eye **inside the form**, where
vertices fall behind it, `w` goes negative and the `W_MIN` clamp catches it — the
same family of blowout as the spec's `|Dz|`. It is not clamped away, because it
is also a usable close-encounter effect; instead the readout warns as soon as
perihelion drops below 1.1. Stress-tested at e = 0.75 with 4 eyes over 32,000
projections: **no negative w, and only 0.41% of samples pinned to the clamp.**

## Driving a DAW — MIDI clock sync

Set **Clock → External — follow DAW** and the app slaves to incoming MIDI clock.
The DAW is master; the internal transport switches off and Play is disabled.

MIDI sends 24 timing clocks per quarter note, so 96 per bar in 4/4 — and every
grid resolution the app offers divides that exactly:

| Grid | 1/4 | 1/8 | 1/16 | 1/32 |
|---|---|---|---|---|
| Clocks per cell | 24 | 12 | 6 | 3 |

which is why **position is derived from the running tick count rather than
counted alongside it**. A dropped or duplicated tick shifts position by one cell
and then self-corrects; an independently incremented counter would stay wrong
for the rest of the session. Song Position Pointer is handled too (it counts
sixteenths, six clocks each), so relocating in the DAW relocates the app.

The measured tick period also drives `p.bpm`, so **every downstream duration
follows the DAW** — step length, gate, micro-timing offset, and tempo-synced
rotation rates all track tempo automation without any extra wiring. The estimate
is smoothed and rejects implausible intervals outright: verified to converge
from 120 to 130 BPM within 0.01 BPM, and ±0.8 ms of clock jitter leaves tempo
within 0.13 BPM of true.

### Setting it up in Ableton (macOS)

1. Enable the **IAC Driver** in Audio MIDI Setup (*Window → Show MIDI Studio*,
   double-click IAC Driver, tick *Device is online*). Add a bus if you want a
   dedicated one.
2. Open the app in **Chrome or Edge** — Safari has no Web MIDI, and embedded
   preview panes generally deny the permission. Click **Connect Web MIDI** and
   pick the bus as the output port.
3. Ableton → **Settings → Link/Tempo/MIDI**. For that IAC port: **Sync** ON for
   the *output* (so Ableton sends clock to the app) and **Track** ON for the
   *input* (so Ableton receives the notes).
4. Set the app's **Clock** to *External — follow DAW*.
5. Create 2–4 MIDI tracks. **MIDI From** = that IAC bus, and set the **channel**
   to 1, 2, 3, 4 — one per eye. Monitor **In**, and arm.
6. Untick **Preview synth** so you are not hearing the built-in voices as well.
7. Press play in Ableton.

All eyes share one bus and separate by channel; you do not need a bus each. The
readout shows the incoming tempo, the clocks-per-cell, and the measured tick
period, or `waiting for MIDI clock` if nothing is arriving.

**Zero-setup alternative:** *Export .mid* needs none of this — one track per
eye, correct tempo, drag it straight in. With **Export passes** at 8× you get an
evolving 16–32 bar take rather than one loop repeated.

## Performance mode — two knobs

There are around forty parameters here, which is a patch, not an instrument.
Performance mode borrows the monome Arc's premise: **two endless encoders and a
push**, where each knob moves a whole ecosystem rather than one value.

The architecture is the part that matters. **Macros are relative to a captured
base state.** You dial in a patch, press capture, and both knobs at centre
reproduce it *exactly* — verified across all eight presets to within 5.6e-17.
Turning pushes the whole cluster outward one way and back through your patch the
other, so performing can never overwrite where you started.

| Knob | Drives | From → to |
|---|---|---|
| **Space** | `depthKeep`, `radiusGate`, lattice `density`, `gate`, `velMin` | holes and silence → saturation |
| **Energy** | `ecc`, `lensRadius`, `timing`, `velMax`, `octaveSpan`, `eyeRate` (×) | flat and still → violent perihelion swings and caustic accents |

Measured on `Techno · stab`: Space sweeps **2 → 21 → 57 notes** per loop across
its travel, and Energy takes eccentricity 0 → 0.72. Across a 21×21 grid of the
macro plane, all 441 states stay in range and stay audible, and the macros touch
exactly 11 parameters — none outside their two clusters.

The two pushes: **C** re-captures (commit where you are as the new centre), and
**L** flips the lattice slope between rational (repeats every 8 steps) and 1/φ
(never repeats). One binary that changes the whole character.

**The display is an Arc ring.** This app already had one — the projection circle
— so performance mode makes it the entire screen: the score in the middle, and
the two macros wrapped around it as 64-segment LED rings, lit from twelve
o'clock exactly the way an Arc lights up.

**Driving it:** drag the left half of the screen for Space and the right half
for Energy; `←→` and `↑↓` for fine control (hold shift for finer); `space` to
play; `esc` to leave. Or bind hardware — **Learn Space CC / Learn Energy CC**
adds Web MIDI *input*, so any controller works. Endless encoders send relative
deltas rather than absolute positions, so there is an **Endless enc.** toggle
that reads the standard two's-complement convention (1–63 = +n, 127–65 = −n);
without it a real encoder would jump around.

One caveat: the phason is the only genuinely endless quantity here (it is mod 1,
so it walks locally-indistinguishable variants forever). Space and Energy have
real ends, so their encoders stall at the limits rather than wrapping — a wrap
from silence straight to saturation would be a cliff, not a knob.

## Tempo sync (optional, off by default)

By default there are **two clocks that share only an origin**. The geometry runs
on wall-clock seconds — `wx`, `eyeRate` and `phasonRate` are all per-second —
while the grid runs on musical time (`stepSeconds = (60/bpm) × 4 / gridN`).
Nothing converts between them, exactly as the spec asks: patterns drift across
bar lines and nothing ever closes.

That has three costs. Presets are not tempo-portable (moving `Techno · stab`
from 130 to 140 produces a *different* rhythm, not a faster one). Drift is
emergent rather than steerable — the presets sit between 2.4 and 11.2 cells per
loop, taking 21–38 bars for a pattern to travel all the way round. And **exact
repeats are impossible**.

Switching **Tempo sync** on reads the same parameters as **cycles per bar**.
Since step time is `bar/gridN`, the bar length cancels out of rate × time:

```
wx · 2π · cell / gridN
```

so the pattern becomes **exactly tempo-invariant** — verified identical across
70, 100, 120, 130, 145, 174 and 200 BPM — and rational rates return to their
starting orientation after a countable number of bars. Toggling the mode
converts the stored values so the motion you are hearing is preserved
(round-trips to 1.4e-17); you land on the equivalent cycles-per-bar figure and
can then round it to something that closes.

**Closure** is reported live. It is the LCM of every rational period: the three
rotation axes, each eye, the phason, the quasilattice and the loop itself.

- `Snap rates to rational` moves every rate onto a ladder whose denominators all
  divide 48, keeping the LCM bounded instead of exploding.
- **Eye rates** must be set to `Rational`. The spec's φ ratios (1 : φ⁻¹ : φ⁻²)
  are irrational *by design*, so a multi-eye rig can never realign no matter how
  rational the base rate is — the readout names the offending eye.
- The rate sliders display the exact fraction (`1/16`, not `0.063`) when synced,
  because they step at 0.001 and a nudge would otherwise destroy rationality
  invisibly.

Verified end to end: with ω = 1/8, 1/4, 1/2 and three rational eyes, closure is
reported at **96 bars**, the geometry actually returns to within **1.5e-14**,
and **no earlier bar realigns** — so the reported period is minimal, not merely
sufficient.

Two honest limitations. Closure length depends on the denominators, so slow
rates cost long periods (the `Techno · locked` preset snaps to 1/48, 1/24, 1/16
and closes at 288 bars; pick coarser fractions like 1/4 and 1/2 for a short
one). And below about 1/24 per bar the ladder is genuinely sparse, so nearby
rotation rates would merge onto one rung and stop the solid tumbling — the snap
skips already-taken rungs to keep the three axes distinct, at the cost of a
little accuracy.

## Quasilattice — hidden higher-dimensional periodicity

The rhythmic mask is a **cut-and-project** set: the 2D integer lattice sliced by
a line of irrational slope, with the points near that line projected down to 1D.
The whole construction is one line in [quasilattice.js](src/quasilattice.js):

```
step k fires  iff  frac(k·α + ρ) < density
```

That expression *is* the projection — `frac(k·α + ρ)` is the internal-space
coordinate of lattice point `(k, −floor(k·α + ρ))`, and `[0, density)` is the
acceptance window. The periodicity lives upstairs in Z², where the lattice
repeats perfectly. Downstairs you hear order with no repeating unit.

This is what the spec was reaching for with irrational rate ratios, and it
succeeds where those fail: the ear can lock onto order even when nothing
repeats. The geometry still decides pitch, velocity and which vertex — the
lattice only decides *whether a voice speaks*.

| Control | What it is | What it does |
|---|---|---|
| **Slope α** | the cut angle | rational p/q → period exactly q; irrational → never closes |
| **Density** | window width | onset density, independent of α |
| **Phason** | window offset in internal space | rearranges the pattern while preserving its statistics |
| **Drift** | phason velocity | the pattern continuously reconfigures without changing character |
| **Eye spread** | per-eye phason offset | each eye reads its own slice of the same lattice |

The slope presets walk the Fibonacci convergents — 1/2, 2/3, 3/5, 5/8, 8/13 —
which is literally walking the continued fraction of 1/φ. The period doubles and
redoubles, expectation gets harder to hold, and at 1/φ it never closes. That
single dropdown is the groove-to-drift dial.

### What the tests establish

- **Three-distance theorem.** Gaps between onsets take **at most 3 distinct
  values** — verified across 120 slope/density/phason configurations. That
  bounded gap alphabet is the "ordered" in "ordered but aperiodic"; a random
  mask of the same density fails it immediately. At 1/φ the alphabet is exactly
  `{1, 2}`, arranged in the Fibonacci word: `2 2 1 2 2 1 2 1 2 2 1 2 1 2 2 …`
- **Periodicity is real, and provably absent.** Rational slopes close at exactly
  2, 3, 5, 8, 13 steps. 1/φ and √2−1 do not close under a 256 × 2000 probe.
- **Phason preserves statistics.** Shifting ρ from 0 to 0.41 yields a different
  sequence with *identical* onset count (1236 vs 1236 of 2000) and an identical
  gap alphabet. Locally indistinguishable, globally rearranged — that is the
  phason flip, and it is why Drift morphs the pattern without wandering off.
- **Two properties are slope-dependent, and honestly so.** For irrational α,
  Weyl equidistribution makes measured density track the window to within
  0.0005. For rational p/q there are only q residues, so density **quantizes to
  multiples of 1/q** — at slope 3/5 it snaps to fifths. That is the lattice, not
  a rounding bug.

The mask is indexed by **absolute step**, not by loop cell, so it evolves bar to
bar instead of repeating with the loop. Rejected steps render as struck-out
columns in the grid, so the acceptance window is visible as a shape.

## Known design consequence

The spec's `1 : √2 : φ` default rate ratio is the most groove-hostile choice
available. Groove is expectation plus violation, and it needs a pattern to lean
against; φ is by construction the hardest real number to approximate by
rationals (its continued fraction is all 1s), so it is the slowest possible
approach to any near-repeat. The loop genuinely never repeats — and therefore
never accumulates the expectation that makes a displacement *feel* like
anything. It reads as drift, not swing.

Rational ratios (3:2, 5:4, 7:4) give recurrence with slow internal rotation,
which is where groove actually lives. The ω sliders are free, so this is
reachable by hand today; a snap-to-ratio control would make it steerable.
