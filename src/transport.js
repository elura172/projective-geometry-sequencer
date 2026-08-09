import { cellEvents, stepSeconds, totalCells } from './sequencer.js';

export const TRANSPORT_TICK_MS = 25;

/**
 * Internal timestamped lookahead transport.
 *
 * Time, timers, sinks, and UI-facing state are injected so this runtime stays
 * independent of the DOM and can be verified headlessly.
 */
export function createTransportController({
  params,
  midi,
  synth,
  previewEnabled = () => false,
  now = () => performance.now(),
  lookaheadMs = () => 140,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (timer) => clearInterval(timer),
  beforeStep = () => {},
  onPlayingChange = () => {},
} = {}) {
  if (!params || !midi || !synth) throw new Error('transport requires params, midi, and synth');

  const state = {
    playing: false,
    startMs: 0,
    pausedAt: 0,
    nextCell: 0,
    nextStep: 0,
    nextTimeMs: 0,
    timer: null,
  };

  function musicalTimeMs() {
    return state.playing ? now() - state.startMs : state.pausedAt;
  }

  function schedule() {
    const horizon = now() + lookaheadMs();

    while (state.nextTimeMs < horizon) {
      beforeStep({
        stepIndex: state.nextStep,
        cell: state.nextCell,
        timeMs: state.nextTimeMs,
      });
      const stepMs = stepSeconds(params) * 1000;
      const gateMs = stepMs * params.gate;
      const cellCount = totalCells(params);
      state.nextCell = state.nextStep % cellCount;
      const t = (state.nextTimeMs - state.startMs) / 1000;
      const events = cellEvents(params, t, state.nextCell, state.nextStep);
      for (const event of events) {
        const when = state.nextTimeMs + (event.offset || 0) * stepMs;
        if (midi.port) midi.send(event.channel, event.note, event.velocity, when, gateMs);
        if (previewEnabled()) synth.send(event.channel, event.note, event.velocity, when, gateMs);
      }
      state.nextStep += 1;
      state.nextCell = state.nextStep % cellCount;
      state.nextTimeMs += stepMs;
    }
  }

  function start() {
    if (state.playing) return;
    state.playing = true;
    state.startMs = now() - state.pausedAt;
    const stepMs = stepSeconds(params) * 1000;
    const elapsedSteps = Math.ceil(state.pausedAt / stepMs);
    state.nextCell = elapsedSteps % totalCells(params);
    state.nextStep = elapsedSteps;
    state.nextTimeMs = state.startMs + elapsedSteps * stepMs;
    state.timer = setIntervalFn(schedule, TRANSPORT_TICK_MS);
    schedule();
    onPlayingChange(true);
  }

  function stop() {
    if (!state.playing) return;
    state.pausedAt = musicalTimeMs();
    state.playing = false;
    clearIntervalFn(state.timer);
    state.timer = null;
    midi.panic();
    synth.panic();
    onPlayingChange(false);
  }

  function reset() {
    const wasPlaying = state.playing;
    if (wasPlaying) stop();
    state.pausedAt = 0;
    if (wasPlaying) start();
  }

  return { state, musicalTimeMs, schedule, start, stop, reset };
}
