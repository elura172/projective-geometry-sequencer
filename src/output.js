// Output sinks: a live Web MIDI port and a built-in preview synth.
// Both take (channel, note, velocity, whenMs, durationMs).

export class MidiOut {
  constructor() { this.access = null; this.port = null; this.ports = []; }

  async init() {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI unavailable (Chrome/Edge on localhost or https only — Safari does not implement it)');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.refresh();
    this.access.onstatechange = () => this.refresh();
    return this.ports;
  }

  refresh() {
    this.ports = [...this.access.outputs.values()];
    if (this.port && !this.ports.includes(this.port)) this.port = null;
    if (!this.port) this.port = this.ports[0] || null;
  }

  select(id) { this.port = this.ports.find((p) => p.id === id) || null; }

  send(channel, note, velocity, whenMs, durationMs) {
    if (!this.port) return;
    const ch = (channel - 1) & 0x0f;
    this.port.send([0x90 | ch, note, velocity], whenMs);
    this.port.send([0x80 | ch, note, 0], whenMs + durationMs);
  }

  /**
   * Stop now. clear() drops messages already queued in the port with future
   * timestamps — without it, everything inside the lookahead window still
   * fires after the CC 123, so pause has an audible tail.
   */
  panic() {
    if (!this.port) return;
    if (typeof this.port.clear === 'function') this.port.clear();
    for (let ch = 0; ch < 16; ch++) {
      this.port.send([0xb0 | ch, 123, 0]);
      this.port.send([0xb0 | ch, 120, 0]);
    }
  }
}

/**
 * MIDI control input with CC learn, so hardware encoders can drive the macros.
 *
 * Two encoder conventions are supported. Absolute controls send 0..127
 * directly. Endless encoders send relative deltas, near-universally as
 * two's complement: 1..63 means +n and 127..65 means -(128-n). An endless
 * encoder read as absolute jumps wildly, so the mode is explicit.
 */
export class MidiIn {
  constructor() {
    this.access = null;
    this.bindings = {};     // macro key -> {cc, channel}
    this.relative = false;
    this.learning = null;   // macro key awaiting a control
    this.onValue = null;    // (key, absOrDelta, isDelta) => void
    this.onLearned = null;
    this.onClock = null;    // one MIDI timing clock (24 per quarter)
    this.onTransport = null;// 'start' | 'continue' | 'stop'
    this.onSongPosition = null;
  }

  async init() {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI unavailable (Chrome/Edge, localhost or https)');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    const attach = () => {
      for (const input of this.access.inputs.values()) input.onmidimessage = (m) => this.handle(m);
    };
    attach();
    this.access.onstatechange = attach;
    return [...this.access.inputs.values()];
  }

  learn(key) { this.learning = key; }
  cancelLearn() { this.learning = null; }
  clear(key) { delete this.bindings[key]; }

  handle(msg) {
    const [status, cc, value] = msg.data;

    // System real-time messages carry no data bytes and may interleave
    // anywhere, including inside another message's byte stream.
    if (status >= 0xf8) {
      if (status === 0xf8) this.onClock?.();
      else if (status === 0xfa) this.onTransport?.('start');
      else if (status === 0xfb) this.onTransport?.('continue');
      else if (status === 0xfc) this.onTransport?.('stop');
      return;
    }
    if (status === 0xf2) {                     // song position pointer
      this.onSongPosition?.((msg.data[2] << 7) | msg.data[1]);
      return;
    }

    if ((status & 0xf0) !== 0xb0) return;      // control change only
    const channel = status & 0x0f;

    if (this.learning) {
      const key = this.learning;
      this.learning = null;
      this.bindings[key] = { cc, channel };
      this.onLearned?.(key, cc, channel);
      return;
    }
    for (const [key, b] of Object.entries(this.bindings)) {
      if (b.cc !== cc || b.channel !== channel) continue;
      if (this.relative) {
        const delta = value < 64 ? value : value - 128;
        this.onValue?.(key, delta / 64, true);
      } else {
        this.onValue?.(key, value / 127, false);
      }
    }
  }
}

const EYE_TIMBRE = [
  { type: 'triangle', detune: 0 },
  { type: 'sine', detune: 4 },
  { type: 'square', detune: -6 },
  { type: 'sawtooth', detune: 8 },
];

/** Small polysynth so the app is audible without a DAW. */
export class PreviewSynth {
  constructor() { this.ctx = null; this.bus = null; this.voices = []; }

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.bus = this.ctx.createGain();
      this.bus.gain.value = 0.16;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 5200;
      this.bus.connect(filter).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** whenMs is in performance.now() time; converted to AudioContext time here. */
  send(channel, note, velocity, whenMs, durationMs) {
    const ctx = this.ensure();
    const t = ctx.currentTime + Math.max(0, (whenMs - performance.now())) / 1000;
    const dur = Math.max(0.04, durationMs / 1000);
    const timbre = EYE_TIMBRE[(channel - 1) % EYE_TIMBRE.length];

    const osc = ctx.createOscillator();
    osc.type = timbre.type;
    osc.detune.value = timbre.detune;
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);

    const g = ctx.createGain();
    const peak = (velocity / 127) ** 1.6 * 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);

    // voices scheduled in AudioContext time are already committed; keep
    // handles so pause can actually silence them
    this.voices = this.voices.filter((v) => v.end > ctx.currentTime);
    this.voices.push({ osc, g, end: t + dur + 0.05 });
  }

  panic() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), now);
        v.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        v.osc.stop(now + 0.03);
      } catch { /* already stopped */ }
    }
    this.voices = [];
  }
}

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
