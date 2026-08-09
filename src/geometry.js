// Platonic solids: vertices normalized to unit circumradius, edges derived
// numerically (a pair is an edge iff its distance equals the minimum pairwise
// distance). Pure math, no DOM.

const PHI = (1 + Math.sqrt(5)) / 2;

function norm(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * Expand a base triple (0, b, c) into its 4 sign variants, then take the 3
 * cyclic permutations of each — 12 distinct points. The signs must ride the
 * nonzero coordinates, not fixed slots, or the permutations collapse.
 */
function signedCyclic(b, c) {
  const out = [];
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      const [x, y, z] = [0, s1 * b, s2 * c];
      out.push([x, y, z], [y, z, x], [z, x, y]);
    }
  }
  return out;
}

function tetrahedronVerts() {
  return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(norm);
}

function octahedronVerts() {
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
}

function cubeVerts() {
  const out = [];
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) out.push(norm([x, y, z]));
  return out;
}

function icosahedronVerts() {
  return signedCyclic(1, PHI).map(norm);
}

function dodecahedronVerts() {
  return [...cubeVerts(), ...signedCyclic(1 / PHI, PHI).map(norm)];
}

function deriveEdges(verts) {
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(
        verts[i][0] - verts[j][0],
        verts[i][1] - verts[j][1],
        verts[i][2] - verts[j][2],
      );
      if (d < min) min = d;
    }
  }
  const eps = min * 1e-6 + 1e-9;
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(
        verts[i][0] - verts[j][0],
        verts[i][1] - verts[j][1],
        verts[i][2] - verts[j][2],
      );
      if (Math.abs(d - min) <= eps) edges.push([i, j]);
    }
  }
  return { edges, edgeLength: min };
}

function build(name, verts) {
  const { edges, edgeLength } = deriveEdges(verts);
  // circumradius is 1 by construction, so edgeLength IS the edge/circumradius ratio
  return { name, verts, edges, edgeRatio: edgeLength };
}

export const SOLIDS = {
  tetrahedron: build('tetrahedron', tetrahedronVerts()),
  octahedron: build('octahedron', octahedronVerts()),
  cube: build('cube', cubeVerts()),
  icosahedron: build('icosahedron', icosahedronVerts()),
  dodecahedron: build('dodecahedron', dodecahedronVerts()),
};

export const SOLID_NAMES = Object.keys(SOLIDS);

// Rz(wz t) * Ry(wy t) * Rx(wx t) * V, per the spec. Angles are driven
// continuously by time and never interpolated, so gimbal lock cannot bite.
export function rotateVerts(verts, ax, ay, az, out) {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  const dst = out || new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    // Rx
    const x1 = v[0];
    const y1 = v[1] * cx - v[2] * sx;
    const z1 = v[1] * sx + v[2] * cx;
    // Ry
    const x2 = x1 * cy + z1 * sy;
    const y2 = y1;
    const z2 = -x1 * sy + z1 * cy;
    // Rz
    const x3 = x2 * cz - y2 * sz;
    const y3 = x2 * sz + y2 * cz;
    const z3 = z2;
    const t = dst[i];
    if (t) { t[0] = x3; t[1] = y3; t[2] = z3; }
    else dst[i] = [x3, y3, z3];
  }
  return dst;
}
