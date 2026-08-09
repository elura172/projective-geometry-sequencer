import {
  bpmFromTickMs,
  clockFromSongPosition,
  clocksPerCell,
  positionFromClock,
  tickMsFromBpm,
  updateTickEstimate,
} from './clock.js';
import { cellEvents, totalCells } from './sequencer.js';

export const CLOCK_LATENCY_MS = 2;

/** External MIDI-clock runtime. The DAW replaces the internal scheduler. */
export function createClockController({
  params,
  transport,
  midi,
  synth,
  previewEnabled = () => false,
  now = () => performance.now(),
  beforeStep = () => {},
  onPlayingChange = () => {},
} = {}) {
  if (!params || !transport || !midi || !synth) {
    throw new Error('clock controller requires params, transport, midi, and synth');
  }

  const state = {
    external: false,
    running: false,
    count: 0,
    tickMs: tickMsFromBpm(120),
    lastTickMs: 0,
    lastSeenMs: 0,
    ticks: 0,
  };

  function alive() {
    return Boolean(state.external && state.lastSeenMs && now() - state.lastSeenMs < 500);
  }

  function geometrySeconds() {
    return state.external
      ? (state.count * state.tickMs) / 1000
      : transport.musicalTimeMs() / 1000;
  }

  function onTick() {
    const tickNow = now();
    if (state.lastTickMs) state.tickMs = updateTickEstimate(state.tickMs, tickNow - state.lastTickMs);
    state.lastTickMs = tickNow;
    state.lastSeenMs = tickNow;
    state.ticks += 1;

    const bpm = bpmFromTickMs(state.tickMs);
    if (isFinite(bpm) && bpm > 20 && bpm < 400) params.bpm = bpm;
    if (!state.external || !state.running) return;

    let clocks = clocksPerCell(params.gridN);
    let position = positionFromClock(state.count, params.gridN, totalCells(params));
    if (position.onCell) {
      beforeStep({
        stepIndex: position.stepIndex,
        cell: position.cell,
        timeMs: tickNow,
      });
      // A boundary callback may atomically switch topology-sensitive patch
      // state. Re-derive position so this exact cell uses the committed state.
      clocks = clocksPerCell(params.gridN);
      position = positionFromClock(state.count, params.gridN, totalCells(params));
      const cellMs = state.tickMs * clocks;
      const events = cellEvents(params, geometrySeconds(), position.cell, position.stepIndex);
      const gateMs = cellMs * params.gate;
      for (const event of events) {
        const when = tickNow + CLOCK_LATENCY_MS + (event.offset || 0) * cellMs;
        if (midi.port) midi.send(event.channel, event.note, event.velocity, when, gateMs);
        if (previewEnabled()) synth.send(event.channel, event.note, event.velocity, when, gateMs);
      }
    }
    state.count += 1;
  }

  function onTransport(kind) {
    if (!state.external) return;
    if (kind === 'start') {
      state.count = 0;
      state.running = true;
    } else if (kind === 'continue') {
      state.running = true;
    } else if (kind === 'stop') {
      state.running = false;
      midi.panic();
      synth.panic();
    }
    onPlayingChange(state.running);
  }

  function setExternal(external) {
    state.external = external;
    if (external) {
      if (transport.state.playing) transport.stop();
      transport.state.pausedAt = 0;
      state.running = false;
      state.count = 0;
    } else {
      state.running = false;
      midi.panic();
      synth.panic();
    }
    onPlayingChange(state.running);
  }

  function setSongPosition(sixteenths) {
    state.count = clockFromSongPosition(sixteenths);
  }

  return { state, alive, geometrySeconds, onTick, onTransport, setExternal, setSongPosition };
}
