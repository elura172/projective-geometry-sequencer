// Canvas 2D renderers for the three views. No 3D library: the viewport camera
// is its own small perspective projection, independent of the musical eyes.

import { EYE_COLORS } from './eyes.js';
import { orbitState } from './kepler.js';

const TAU = Math.PI * 2;

function fitDPR(canvas) {
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

// --- viewport camera -------------------------------------------------------
const CAM = { dist: 6.4, pitch: 0.42, yaw: 0.6, focal: 3.4 };

function camProject(p, w, h) {
  const cy = Math.cos(CAM.yaw), sy = Math.sin(CAM.yaw);
  const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  const x1 = p[0] * cy - p[2] * sy;
  const z1 = p[0] * sy + p[2] * cy;
  const y2 = p[1] * cp - z1 * sp;
  const z2 = p[1] * sp + z1 * cp;
  const zc = z2 + CAM.dist;
  const k = (CAM.focal * Math.min(w, h) * 0.28) / Math.max(zc, 0.1);
  return [w / 2 + x1 * k, h / 2 - y2 * k, zc];
}

export function drawViewport(canvas, state, p) {
  const { ctx, w, h } = fitDPR(canvas);
  ctx.clearRect(0, 0, w, h);

  const { solid, verts, perEye } = state;

  // the projection plane, drawn as a ring below the form
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * TAU;
    const q = camProject([Math.cos(a) * 1.5, -1.7, Math.sin(a) * 1.5], w, h);
    i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
  }
  ctx.stroke();

  // orbit traces — an ellipse with the mass at a focus, so eccentricity is
  // visible as the form sitting off-centre inside the path
  for (const e of perEye) {
    const a = e.orbit.a, ecc = p.ecc || 0;
    const ct = Math.cos(p.tilt), st = Math.sin(p.tilt);
    ctx.strokeStyle = EYE_COLORS[e.eye] + '30';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const s = orbitState(a, ecc, 1, (i / 96) * TAU);
      const q = camProject([s.x, -s.y * st, s.y * ct], w, h);
      i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
    }
    ctx.stroke();
  }

  const P = verts.map((v) => camProject(v, w, h));

  // projection rays, eye -> vertex, extended past the vertex
  for (const e of perEye) {
    const E = camProject(e.position, w, h);
    ctx.strokeStyle = EYE_COLORS[e.eye] + '2e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      const far = camProject([
        e.position[0] + (verts[i][0] - e.position[0]) * 2.1,
        e.position[1] + (verts[i][1] - e.position[1]) * 2.1,
        e.position[2] + (verts[i][2] - e.position[2]) * 2.1,
      ], w, h);
      ctx.moveTo(E[0], E[1]);
      ctx.lineTo(far[0], far[1]);
    }
    ctx.stroke();
  }

  // wireframe
  ctx.strokeStyle = 'rgba(220,232,255,0.62)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (const [a, b] of solid.edges) {
    ctx.moveTo(P[a][0], P[a][1]);
    ctx.lineTo(P[b][0], P[b][1]);
  }
  ctx.stroke();

  for (const q of P) {
    const r = Math.max(1.6, 4.4 - (q[2] - CAM.dist) * 0.9);
    ctx.fillStyle = '#eaf1ff';
    ctx.beginPath();
    ctx.arc(q[0], q[1], r, 0, TAU);
    ctx.fill();
  }

  // eye glyphs
  for (const e of perEye) {
    const E = camProject(e.position, w, h);
    const c = EYE_COLORS[e.eye];
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(E[0], E[1], 8, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(E[0], E[1], 3, 0, TAU); ctx.fill();
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`eye ${e.eye + 1}`, E[0] + 12, E[1] + 3);
  }
}

// --- circle view -----------------------------------------------------------
export function drawCircle(canvas, state, p, playCell) {
  const { ctx, w, h } = fitDPR(canvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38;
  const N = p.gridN * p.bars;

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

  // grid ticks; the cell currently sounding is highlighted
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const inner = i === playCell ? R * 0.80 : R * 0.92;
    ctx.strokeStyle = i === playCell ? 'rgba(255,255,255,0.85)'
      : (i % (N / p.bars / 4) === 0 ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.13)');
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * R * 1.06, cy + Math.sin(a) * R * 1.06);
    ctx.stroke();
  }

  for (const e of state.perEye) {
    const col = EYE_COLORS[e.eye];
    for (const hit of e.hits) {
      const a = hit.theta;
      // radial position carries projected radius (clamped), purely visual
      const rr = R * Math.min(1.28, 0.42 + hit.radius * 0.22);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;

      // gated vertices are drawn hollow — the rests are visible, not just absent
      if (hit.gated) {
        ctx.strokeStyle = col + '3a';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.stroke();
        continue;
      }
      ctx.strokeStyle = col + '55';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, hit.cell === playCell ? 5 : 3, 0, TAU); ctx.fill();
    }
  }
}

// --- grid / timeline -------------------------------------------------------
export function drawGrid(canvas, cells, p, playCell, showPitch, mask) {
  const { ctx, w, h } = fitDPR(canvas);
  ctx.clearRect(0, 0, w, h);
  const N = p.gridN * p.bars;
  const cw = w / N;
  // the drum map is not a scale, so its pitch axis spans the map's own notes
  const dm = p.scale === 'drum' && p.drumMap && p.drumMap.length ? p.drumMap : null;
  const lo = dm ? Math.min(...dm) : p.baseNote;
  const hi = dm ? Math.max(...dm) : p.baseNote + p.octaveSpan * 12;

  for (let i = 0; i < N; i++) {
    const beat = i % (p.gridN / 4) === 0;
    ctx.fillStyle = i === playCell ? 'rgba(255,255,255,0.12)'
      : beat ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.015)';
    ctx.fillRect(i * cw, 0, cw - 1, h);
    // steps the quasilattice rejects are drawn as struck-out columns, so the
    // projected acceptance window is visible as a shape, not just as silence
    if (mask && !mask[i]) {
      ctx.fillStyle = 'rgba(10,12,18,0.62)';
      ctx.fillRect(i * cw, 0, cw - 1, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(i * cw, h); ctx.lineTo(i * cw + cw - 1, 0);
      ctx.stroke();
    }
  }

  cells.forEach((cell, i) => {
    for (const n of cell) {
      const c = EYE_COLORS[n.eye];
      const vh = (n.velocity / 127) * (h - 8);
      // micro-timing is drawn where it is heard: off the grid line
      const x = (i + (n.offset || 0)) * cw + 1;
      if (showPitch) {
        const t = (n.note - lo) / Math.max(1, hi - lo);
        const y = h - 6 - Math.max(0, Math.min(1, t)) * (h - 14);
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.35 + (n.velocity / 127) * 0.65;
        ctx.fillRect(x, y - 3, Math.max(2, cw - 3), 6);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, h - 4 - vh, Math.max(2, cw - 3), vh);
        ctx.globalAlpha = 1;
      }
    }
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(playCell * cw, 0); ctx.lineTo(playCell * cw, h);
  ctx.stroke();
}
