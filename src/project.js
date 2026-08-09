// True projective (perspective) divide. Not a sine warp — the 1/w
// nonlinearity is the whole instrument.

export const W_MIN = 0.05;
const TAU = Math.PI * 2;

/**
 * Point-mass thin gravitational lens, in the image plane.
 *
 * The lens equation is  beta = theta - thetaE^2 / theta, where beta is the
 * true (unlensed) angular position of the source and theta the observed image
 * position. Inverting for the primary image:
 *
 *   theta = ( beta + sqrt(beta^2 + 4·thetaE^2) ) / 2
 *
 * and its magnification is  mu = 1 / (1 - (thetaE/theta)^4).
 *
 * NOTE — the deflection is purely RADIAL. The mass sits at the origin and every
 * eye looks at the origin, so the lens projects to the exact centre of each
 * image; by circular symmetry there is no tangential component and the polar
 * ANGLE is untouched. Lensing therefore changes radius and brightness, never
 * timing. The timing pocket comes from Kepler's second law, not from here.
 */
export function lensPoint(r, einsteinRadius) {
  const tE = einsteinRadius;
  if (!(tE > 0)) return { r, mu: 1 };
  const E2 = tE * tE;
  const rl = (r + Math.sqrt(r * r + 4 * E2)) / 2;   // always >= tE
  const ratio = Math.min(1, tE / Math.max(rl, 1e-12));
  // mu diverges at the Einstein radius (r -> 0); clamp so a vertex crossing the
  // caustic is a loud accent rather than an infinity
  const mu = 1 / Math.max(0.02, 1 - ratio ** 4);
  return { r: rl, mu: Math.min(mu, 50) };
}

/**
 * Build an orthonormal view basis for an eye looking at the origin.
 * forward points from the eye toward the origin; right/up span the image plane.
 */
export function viewBasis(E) {
  let fx = -E[0], fy = -E[1], fz = -E[2];
  const fm = Math.hypot(fx, fy, fz) || 1;
  fx /= fm; fy /= fm; fz /= fm;

  // right = up_world x forward, with a fallback when forward is near-vertical
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(fy) > 0.999) { ux = 0; uy = 0; uz = 1; }
  let rx = uy * fz - uz * fy;
  let ry = uz * fx - ux * fz;
  let rz = ux * fy - uy * fx;
  const rm = Math.hypot(rx, ry, rz) || 1;
  rx /= rm; ry /= rm; rz /= rm;

  // up = forward x right
  const vx = fy * rz - fz * ry;
  const vy = fz * rx - fx * rz;
  const vz = fx * ry - fy * rx;

  return { f: [fx, fy, fz], r: [rx, ry, rz], u: [vx, vy, vz] };
}

/**
 * Project every rotated vertex through one eye.
 *
 * mode 'view'   — w = depth along the eye's own view axis (default; well-conditioned
 *                 at every orbit phase, and always > 0 for vertices in front of the eye)
 * mode 'worldz' — the spec's literal w = |Dz| / scale. Kept for fidelity; it
 *                 degenerates whenever the eye's view axis is near-perpendicular
 *                 to world z, which happens twice per orbit.
 *
 * @returns {{theta:number, frac:number, r:number, w:number, index:number}[]}
 */
export function projectVertices(verts, E, opts = {}) {
  const mode = opts.mode || 'view';
  const scale = opts.scale ?? 1;
  const lens = opts.lens ?? 0;   // Einstein radius in image-plane units
  const basis = viewBasis(E);
  const out = new Array(verts.length);

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const dx = v[0] - E[0], dy = v[1] - E[1], dz = v[2] - E[2];

    let w, px, py;
    if (mode === 'worldz') {
      w = Math.max(Math.abs(dz) / scale, W_MIN);
      px = dx / w;
      py = dy / w;
    } else {
      const raw = (dx * basis.f[0] + dy * basis.f[1] + dz * basis.f[2]) / scale;
      w = Math.max(raw, W_MIN);
      px = (dx * basis.r[0] + dy * basis.r[1] + dz * basis.r[2]) / w;
      py = (dx * basis.u[0] + dy * basis.u[1] + dz * basis.u[2]) / w;
    }

    // the lens scales px and py by the same positive factor, so theta — and
    // therefore the grid cell — comes out identical either way
    let radius = Math.hypot(px, py);
    let mu = 1;
    if (lens > 0) {
      const L = lensPoint(radius, lens);
      const k = radius > 1e-12 ? L.r / radius : 1;
      px *= k; py *= k;
      radius = L.r;
      mu = L.mu;
    }

    let theta = Math.atan2(py, px);
    if (theta < 0) theta += TAU;
    let frac = theta / TAU;
    if (!(frac >= 0) || frac >= 1) frac = 0; // NaN / boundary guard

    out[i] = { theta, frac, r: radius, mu, w, index: i };
  }
  return out;
}
