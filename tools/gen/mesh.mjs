// Geometry, built from arithmetic.
//
// Every builder returns the same plain shape:
//
//   { positions: [x,y,z, ...], normals: [x,y,z, ...], indices: [a,b,c, ...] }
//
// Positions are flat arrays of doubles, triangles are counter-clockwise seen
// from outside, and everything is Y-up in metres. That is the whole contract —
// it is what the GLB writer wants and what three.js wants, so nothing in between
// has to translate.

export const TAU = Math.PI * 2;

export function emptyMesh() {
  return { positions: [], normals: [], indices: [] };
}

/** One mesh made of several, with each one's vertices renumbered. */
export function merge(...meshes) {
  const out = emptyMesh();
  for (const m of meshes) {
    if (!m) continue;
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    out.normals.push(...m.normals);
    for (const i of m.indices) out.indices.push(i + base);
  }
  return out;
}

/** Rotation is applied X, then Y, then Z; scale first, translation last. */
export function transform(mesh, { pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  const [rx, ry, rz] = rot;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const rotate = (x, y, z) => {
    let y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    let x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    const x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
    return [x3, y3, z2];
  };
  const out = { positions: [], normals: [], indices: [...mesh.indices] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [x, y, z] = rotate(mesh.positions[i] * s[0], mesh.positions[i + 1] * s[1], mesh.positions[i + 2] * s[2]);
    out.positions.push(x + pos[0], y + pos[1], z + pos[2]);
    // Non-uniform scale needs the inverse transpose; the scales here are close
    // enough to uniform that normalising after the same rotation is honest, and
    // it keeps this file free of a matrix library.
    const [nx, ny, nz] = rotate(mesh.normals[i] / s[0], mesh.normals[i + 1] / s[1], mesh.normals[i + 2] / s[2]);
    const len = Math.hypot(nx, ny, nz) || 1;
    out.normals.push(nx / len, ny / len, nz / len);
  }
  return out;
}

/** Push one triangle with a flat normal. Used by every builder below. */
function tri(mesh, a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const base = mesh.positions.length / 3;
  for (const p of [a, b, c]) {
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.normals.push(nx, ny, nz);
  }
  mesh.indices.push(base, base + 1, base + 2);
}

export function quad(mesh, a, b, c, d) {
  tri(mesh, a, b, c);
  tri(mesh, a, c, d);
}

/**
 * A surface of revolution. `profile` is [[radius, y], ...] from bottom to top;
 * this is the workhorse — a trunk, a skirt of needles, a pole, a bullwheel and a
 * chimney are all lathes with different profiles.
 */
export function lathe(profile, segments = 10, { capBottom = false, capTop = false, twist = 0 } = {}) {
  const mesh = emptyMesh();
  const at = (ri, si) => {
    const [r, y] = profile[ri];
    const a = (si / segments) * TAU + twist * (y);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let ri = 0; ri < profile.length - 1; ri++) {
    for (let si = 0; si < segments; si++) {
      const s2 = (si + 1) % segments;
      const a = at(ri, si), b = at(ri, s2), c = at(ri + 1, s2), d = at(ri + 1, si);
      // Wound so the normal points OUT. Getting this backwards makes a mesh that
      // measures perfectly, renders as its own inside, and reads to every later
      // step — including "which faces point up, for snow" — as the opposite of
      // what it is. It cost this generator a whole build of white parasols.
      if (profile[ri][0] < 1e-6) tri(mesh, a, d, c);
      else if (profile[ri + 1][0] < 1e-6) tri(mesh, a, c, b);
      else quad(mesh, a, d, c, b);
    }
  }
  if (capBottom && profile[0][0] > 1e-6) {
    const centre = [0, profile[0][1], 0];
    for (let si = 0; si < segments; si++) tri(mesh, centre, at(0, (si + 1) % segments), at(0, si));
  }
  if (capTop && profile[profile.length - 1][0] > 1e-6) {
    const top = profile.length - 1;
    const centre = [0, profile[top][1], 0];
    for (let si = 0; si < segments; si++) tri(mesh, centre, at(top, si), at(top, (si + 1) % segments));
  }
  return mesh;
}

export function cone(radius, height, segments = 10, { y0 = 0, capBottom = true } = {}) {
  return lathe([[radius, y0], [0, y0 + height]], segments, { capBottom });
}

export function cylinder(radius, height, segments = 8, { y0 = 0, topRadius = radius, caps = true } = {}) {
  return lathe([[radius, y0], [topRadius, y0 + height]], segments, { capBottom: caps, capTop: caps });
}

export function box(w, h, d, { pos = [0, 0, 0] } = {}) {
  const mesh = emptyMesh();
  const x = w / 2, y = h / 2, z = d / 2;
  const p = (sx, sy, sz) => [pos[0] + sx * x, pos[1] + sy * y, pos[2] + sz * z];
  quad(mesh, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));    // +z
  quad(mesh, p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1)); // -z
  quad(mesh, p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1));    // +x
  quad(mesh, p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1)); // -x
  quad(mesh, p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1));    // +y
  quad(mesh, p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)); // -y
  return mesh;
}

/** A sphere from a subdivided octahedron — even triangles, no polar crowding. */
export function sphere(radius, subdivisions = 2) {
  const mesh = emptyMesh();
  const top = [0, 1, 0], bottom = [0, -1, 0];
  const ring = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
  const faces = [];
  for (let i = 0; i < 4; i++) {
    faces.push([top, ring[i], ring[(i + 1) % 4]]);
    faces.push([bottom, ring[(i + 1) % 4], ring[i]]);
  }
  const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const mid = (a, b) => norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  let current = faces;
  for (let s = 0; s < subdivisions; s++) {
    const next = [];
    for (const [a, b, c] of current) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    current = next;
  }
  for (const [a, b, c] of current) {
    // Same rule as the lathe: outward winding.
    tri(mesh, a.map((v) => v * radius), c.map((v) => v * radius), b.map((v) => v * radius));
  }
  return mesh;
}

/**
 * Move every vertex by a function of its position, then rebuild the normals from
 * the faces. This is how a sphere becomes a boulder and a cone becomes a tree
 * that is not a perfect cone.
 */
export function displace(mesh, fn) {
  const out = { positions: [], normals: [], indices: [...mesh.indices] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = fn(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
    out.positions.push(p[0], p[1], p[2]);
    out.normals.push(0, 0, 0);
  }
  return faceNormals(out);
}

/** Recompute flat-ish normals by accumulating face normals per vertex. */
export function faceNormals(mesh) {
  const n = new Float64Array(mesh.positions.length);
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3, b = mesh.indices[i + 1] * 3, c = mesh.indices[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  const out = [];
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    out.push(n[i] / l, n[i + 1] / l, n[i + 2] / l);
  }
  return { positions: mesh.positions, normals: out, indices: mesh.indices };
}

/**
 * Split a mesh in two by the tilt of each face: the flat-enough triangles go in
 * one pile, the rest in the other.
 *
 * This is how snow gets on things. Snow does not coat a tree evenly — it sits on
 * what points up. Painting the whole canopy white is how 5200 spruces came out
 * as white cones, and separating the faces by their own normal is a rule rather
 * than a guess about where it should go.
 */
export function splitByTilt(mesh, cosLimit) {
  const flat = emptyMesh();
  const steep = emptyMesh();
  const p = mesh.positions, nrm = mesh.normals;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i], ib = mesh.indices[i + 1], ic = mesh.indices[i + 2];
    const up = (nrm[ia * 3 + 1] + nrm[ib * 3 + 1] + nrm[ic * 3 + 1]) / 3;
    const target = up >= cosLimit ? flat : steep;
    const base = target.positions.length / 3;
    for (const k of [ia, ib, ic]) {
      target.positions.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
      target.normals.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
    }
    target.indices.push(base, base + 1, base + 2);
  }
  return { flat, steep };
}

/**
 * Keep only the triangles a predicate likes, called with the centroid.
 *
 * Snow on a branch is patchy: it sits on the outer half where the needles are
 * flat and slides off the steep inside. Keeping every upward face is what turns
 * a spruce into a white parasol, which is exactly what the first attempt at this
 * generator produced.
 */
export function filterTriangles(mesh, keep) {
  const out = emptyMesh();
  const p = mesh.positions, n = mesh.normals;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i], ib = mesh.indices[i + 1], ic = mesh.indices[i + 2];
    const cx = (p[ia * 3] + p[ib * 3] + p[ic * 3]) / 3;
    const cy = (p[ia * 3 + 1] + p[ib * 3 + 1] + p[ic * 3 + 1]) / 3;
    const cz = (p[ia * 3 + 2] + p[ib * 3 + 2] + p[ic * 3 + 2]) / 3;
    if (!keep(cx, cy, cz, i / 3)) continue;
    const base = out.positions.length / 3;
    for (const k of [ia, ib, ic]) {
      out.positions.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
      out.normals.push(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]);
    }
    out.indices.push(base, base + 1, base + 2);
  }
  return out;
}

/** Lift a mesh's vertices along their own normals — a snow layer over a shape. */
export function shell(mesh, thickness) {
  const out = { positions: [], normals: [...mesh.normals], indices: [...mesh.indices] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out.positions.push(
      mesh.positions[i] + mesh.normals[i] * thickness,
      mesh.positions[i + 1] + mesh.normals[i + 1] * thickness,
      mesh.positions[i + 2] + mesh.normals[i + 2] * thickness,
    );
  }
  return out;
}

/**
 * What fraction of a shape's faces point away from its own centre.
 *
 * A closed, roughly convex model should score near 1. Anything under about 0.6
 * is inside out, which is a mistake that renders as "the model is fine but the
 * light is wrong" and hides for a whole session. The build prints this.
 */
export function outwardFraction(mesh) {
  const p = mesh.positions;
  if (!p.length) return 1;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  const n = p.length / 3;
  cx /= n; cy /= n; cz /= n;
  let out = 0, total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3, b = mesh.indices[i + 1] * 3, c = mesh.indices[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (p[a] + p[b] + p[c]) / 3 - cx;
    const my = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - cy;
    const mz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz > 0) out++;
    total++;
  }
  return total ? out / total : 1;
}

export function triangleCount(mesh) {
  return mesh.indices.length / 3;
}

/** Deterministic noise, so a rebuild produces the same models byte for byte. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0;
    return s / 4294967296;
  };
}
