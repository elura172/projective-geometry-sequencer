// MIDI clock slaving. The DAW is the master; this file is the arithmetic that
// turns its clock into grid positions.
//
// MIDI sends 24 timing clocks per quarter note, so 96 per bar in 4/4. Every
// grid resolution the app offers divides that exactly:
//
//     1/4 -> 24 clocks    1/8 -> 12    1/16 -> 6    1/32 -> 3
//
// which is why position can be *derived* from the running clock count rather
// than incremented alongside it. Derived position cannot drift: a dropped or
// duplicated tick shifts one cell and then self-corrects, where an independent
// counter would stay wrong forever.

export const CLOCKS_PER_QUARTER = 24;
export const CLOCKS_PER_BAR = CLOCKS_PER_QUARTER * 4;

/** Timing clocks per grid cell. Integer for every supported gridN. */
export function clocksPerCell(gridN) {
  return CLOCKS_PER_BAR / gridN;
}

/** Absolute step and loop cell for a running clock count. */
export function positionFromClock(count, gridN, totalCells) {
  const cpc = clocksPerCell(gridN);
  const stepIndex = Math.floor(count / cpc);
  return { stepIndex, cell: ((stepIndex % totalCells) + totalCells) % totalCells, onCell: count % cpc === 0 };
}

/** Song Position Pointer counts sixteenth notes; six clocks each. */
export function clockFromSongPosition(sixteenths) {
  return sixteenths * (CLOCKS_PER_QUARTER / 4);
}

export function bpmFromTickMs(tickMs) {
  return 60000 / (tickMs * CLOCKS_PER_QUARTER);
}

export function tickMsFromBpm(bpm) {
  return 60000 / (bpm * CLOCKS_PER_QUARTER);
}

/**
 * Smoothed tick period. A DAW's clock jitters by a millisecond or two, and a
 * raw reading would make every derived duration jitter with it; outliers
 * (a stall, a scheduler hiccup) are rejected outright rather than averaged in.
 */
export function updateTickEstimate(prevMs, deltaMs, alpha = 0.15) {
  if (!(deltaMs > 0.5) || deltaMs > 500) return prevMs;   // implausible: ignore
  return prevMs * (1 - alpha) + deltaMs * alpha;
}
