// Minimal Standard MIDI File (format 1) writer. Hand-rolled so the app has
// zero dependencies. The two things that usually break in a writer like this
// are VLQ encoding and delta-encoding events that were never sorted by
// absolute tick — both are handled explicitly below.

export const PPQ = 480;

function vlq(n) {
  // 7 bits per byte, high bit set on all but the last
  let v = n >>> 0;
  const stack = [v & 0x7f];
  v >>>= 7;
  while (v > 0) { stack.push((v & 0x7f) | 0x80); v >>>= 7; }
  return stack.reverse();
}

function str(s) { return [...s].map((c) => c.charCodeAt(0)); }
function u32(n) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; }
function u16(n) { return [(n >>> 8) & 0xff, n & 0xff]; }

function chunk(id, data) { return [...str(id), ...u32(data.length), ...data]; }

/** events: [{tick, status, data:[..]}] — sorted here, then delta-encoded. */
function trackChunk(events, name) {
  const bytes = [];
  if (name) bytes.push(...vlq(0), 0xff, 0x03, ...vlq(name.length), ...str(name));

  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  for (const ev of sorted) {
    bytes.push(...vlq(ev.tick - last), ev.status, ...ev.data);
    last = ev.tick;
  }
  bytes.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  return chunk('MTrk', bytes);
}

/**
 * @param {Array<Array<{channel:number,note:number,velocity:number}>>} cells
 *        one entry per grid cell, in loop order
 * @param {{bpm:number, gridN:number, nEyes:number, gate:number, loopCells:number}} opts
 */
export function writeMidiFile(cells, opts) {
  const { bpm, gridN, nEyes, gate } = opts;
  const ticksPerStep = Math.round((PPQ * 4) / gridN);
  const gateTicks = Math.max(1, Math.round(ticksPerStep * gate));
  const loopTicks = ticksPerStep * cells.length;

  // conductor track: tempo + 4/4
  const usPerBeat = Math.round(60000000 / bpm);
  const meta = [
    { tick: 0, order: 0, status: 0xff, data: [0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff] },
    { tick: 0, order: 1, status: 0xff, data: [0x58, 0x04, 4, 2, 24, 8] },
  ];
  const tracks = [trackChunk(meta, 'Projective Geometry Sequencer')];

  for (let e = 0; e < nEyes; e++) {
    const ch = e & 0x0f;
    const evs = [];
    let order = 0;
    cells.forEach((cellEvents, ci) => {
      for (const n of cellEvents) {
        if (n.channel - 1 !== e) continue;
        // micro-timing: push the note off the grid line by its sub-cell
        // remainder. Events are sorted by absolute tick before delta encoding,
        // so an offset note can safely land after a later cell's grid position.
        const onTick = Math.min(
          loopTicks - 1,
          ci * ticksPerStep + Math.round((n.offset || 0) * ticksPerStep),
        );
        evs.push({ tick: onTick, order: order++, status: 0x90 | ch, data: [n.note, n.velocity] });
        evs.push({ tick: Math.min(onTick + gateTicks, loopTicks), order: order++, status: 0x80 | ch, data: [n.note, 0] });
      }
    });
    tracks.push(trackChunk(evs, `Eye ${e + 1}`));
  }

  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
