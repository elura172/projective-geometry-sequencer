// Performance view: one focal point, two rings, nothing else.
//
// The monome Arc is an LED ring — 64 discrete lamps lit up to the encoder's
// position. This app already had a ring (the projection circle), so the two
// converge: the score sits in the middle and the macros wrap around it as
// segmented rings, drawn the same way an Arc lights up.

import { EYE_COLORS } from './eyes.js';
import { MACROS } from './macros.js';

const TAU = Math.PI * 2;
const SEGMENTS = 64;          // an Arc ring has 64 LEDs
const GAP = 0.28;             // fraction of each segment left dark

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** One segmented LED ring, lit from 12 o'clock clockwise to `value`. */
function ring(ctx, cx, cy, radius, thickness, value, color) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * SEGMENTS);
  const step = TAU / SEGMENTS;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'butt';
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = -Math.PI / 2 + i * step + step * GAP * 0.5;
    const a1 = a0 + step * (1 - GAP);
    ctx.strokeStyle = i < lit ? color : 'rgba(255,255,255,0.055)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, a0, a1);
    ctx.stroke();
  }
  // the encoder's own position, brighter than the trail behind it
  const head = -Math.PI / 2 + (lit / SEGMENTS) * TAU;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + Math.cos(head) * radius, cy + Math.sin(head) * radius, thickness * 0.42, 0, TAU);
  ctx.fill();
}

export function drawPerf(canvas, state, p, macroValues, info) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.30;
  const N = p.gridN * p.bars;

  // --- the score, in the middle -------------------------------------------
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (i / N) * TAU;
    const on = i === info.playCell;
    ctx.strokeStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * (on ? 0.86 : 0.94), cy + Math.sin(a) * R * (on ? 0.86 : 0.94));
    ctx.lineTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04);
    ctx.stroke();
  }

  for (const e of state.perEye) {
    const col = EYE_COLORS[e.eye];
    for (const hit of e.hits) {
      const a = -Math.PI / 2 + hit.frac * TAU;
      const rr = R * Math.min(0.92, 0.30 + hit.radius * 0.16);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (hit.gated) {
        ctx.strokeStyle = col + '30';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.stroke();
        continue;
      }
      ctx.strokeStyle = col + '38';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = col;
      const near = hit.cell === info.playCell;
      ctx.beginPath(); ctx.arc(x, y, near ? 6 : 3.2, 0, TAU); ctx.fill();
    }
  }

  // --- the two encoders ----------------------------------------------------
  const keys = ['space', 'energy'];
  keys.forEach((key, i) => {
    ring(ctx, cx, cy, R * (1.16 + i * 0.15), 9, macroValues[key], MACROS[key].color);
  });

  // --- hud, pinned to the corners so nothing overlaps the rings ------------
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.font = '500 12px ui-monospace, monospace';
  ctx.fillText(info.title, 22, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(info.subtitle, 22, 52);
  ctx.fillText(info.keys, 22, h - 22);

  // macro readouts stacked bottom-right, each with its ring's colour
  ctx.textAlign = 'right';
  keys.forEach((key, i) => {
    const m = MACROS[key];
    const v = macroValues[key];
    const y = h - 44 + i * 22;
    ctx.fillStyle = m.color;
    ctx.font = '500 12px ui-monospace, monospace';
    ctx.fillText(`${m.name.toUpperCase()}  ${String(Math.round(v * 100)).padStart(3)}%`, w - 22, y);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${m.hint}${info.bound[key] !== undefined ? `   cc${info.bound[key]}` : ''}`, w - 130, y);
  });

  if (info.learning) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffb454';
    ctx.font = '500 12px ui-monospace, monospace';
    ctx.fillText(`learning ${info.learning.toUpperCase()} — move a control`, cx, h - 48);
  }
}
