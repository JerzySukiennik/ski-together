// The forest, from arithmetic.
//
// Five thousand of these stand on the mountain, so they are the single biggest
// thing the eye reads after the snow itself. Two rules do most of the work:
//
//   * A spruce is not a cone. It is a stack of skirts that get wider going down,
//     each one ragged at its edge and drooping, with the trunk showing through
//     the gaps near the bottom. A cone reads as a Christmas decoration; skirts
//     read as a tree, at a cost of a few hundred triangles.
//
//   * Snow sits on what points up. It is put here by splitting the canopy by the
//     tilt of each triangle and lifting only the flat-enough ones — never by
//     painting the tree white, which is how the old forest came out as a field
//     of white spikes.

import {
  merge, transform, lathe, sphere, displace, splitByTilt, shell, filterTriangles, rng, TAU,
} from './mesh.mjs';

export const MATERIALS = {
  // Two greens: the shaded inside of the tree and the outer needles that catch
  // the light. The game has no per-leaf shading, so the difference has to be
  // built into the model or every spruce is one flat silhouette.
  Needle: { colour: [0.055, 0.105, 0.075], roughness: 0.94 },
  NeedleLit: { colour: [0.115, 0.205, 0.130], roughness: 0.88 },
  SnowLoad: { colour: [0.880, 0.925, 0.975], roughness: 0.70 },
  Bark: { colour: [0.120, 0.088, 0.068], roughness: 0.95 },
  Rock: { colour: [0.105, 0.100, 0.098], roughness: 0.92 },
  RockLight: { colour: [0.215, 0.210, 0.200], roughness: 0.88 },
};

/**
 * One tier of the canopy: a steep, ragged cone.
 *
 * The first version of this used shallow skirts and produced a stack of white
 * parasols on a black pole. A spruce tier is STEEP — roughly as tall as it is
 * wide — and the tiers overlap enough that no daylight, and no trunk, shows
 * between them.
 */
function tier(radius, height, rand, segments = 9) {
  const wobble = [];
  for (let i = 0; i < segments; i++) wobble.push(0.80 + rand() * 0.34);
  const mesh = lathe([[radius, 0], [radius * 0.34, height * 0.62], [0, height]], segments,
    { capBottom: false });
  return displace(mesh, (x, y, z) => {
    const a = Math.atan2(z, x);
    const seg = Math.round(((a + TAU) % TAU) / TAU * segments) % segments;
    const w = wobble[seg];
    const t = Math.min(1, Math.hypot(x, z) / radius);
    const k = 1 + (w - 1) * t;
    // The rim of each tier hangs, which is the line that makes a spruce a spruce.
    return [x * k, y - (1 - t) * 0 - t * height * 0.16 * (2 - w), z * k];
  });
}

function spruce({ height, girth, tiers, seed, trunkBare = 0.16 }) {
  const rand = rng(seed);
  const canopyBottom = height * trunkBare;
  const canopyHeight = height - canopyBottom;

  // Trunk: visible below the canopy only. The old model let a bare leader spike
  // out of the top of every tree; this one stops well inside the last tier.
  const trunk = lathe(
    [[girth, 0], [girth * 0.85, canopyBottom], [girth * 0.45, canopyBottom + canopyHeight * 0.5]],
    7, { capBottom: true },
  );

  const dark = [];
  const lit = [];
  const snow = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1); // 0 at the bottom tier, 1 at the top
    // Widest low down, tapering to the leader. The exponent is what decides
    // whether the silhouette reads as spruce (narrow, spiky) or fir (fat).
    const radius = girth * 10.5 * Math.pow(1 - t * 0.94, 0.85) + 0.08;
    const tierH = radius * (1.55 + 0.5 * t);
    // Tiers overlap by more than half their height: no gaps, no visible trunk.
    const y = canopyBottom + canopyHeight * t * 0.86;
    const mesh = transform(tier(radius, tierH, rand, t > 0.66 ? 7 : 9), { pos: [0, y, 0] });
    // Light and shade come from the RADIUS, not the height. Splitting the tree
    // into a dark bottom and a light top drew a horizontal band across every
    // spruce in the forest; splitting each tier into its shaded core and its
    // outer needles gives the same contrast with no seam anywhere.
    const outer = (x, z) => Math.hypot(x, z) / radius > 0.46;
    lit.push(filterTriangles(mesh, (x, y2, z) => outer(x, z)));
    dark.push(filterTriangles(mesh, (x, y2, z) => !outer(x, z)));
    // Snow sits on the outer part of a branch, in patches, never underneath.
    // Radius fraction plus a hash: patchy, and the same on every build.
    if (t > 0.10) {
      const { flat } = splitByTilt(mesh, 0.42);
      const load = filterTriangles(flat, (x, y2, z, n) => {
        const r = Math.hypot(x, z) / radius;
        return r > 0.55 && ((n * 2654435761) >>> 9) % 100 < 30 + 34 * t;
      });
      if (load.indices.length) snow.push(shell(load, 0.04 + 0.05 * t));
    }
  }

  return [
    { material: 'Bark', mesh: trunk },
    { material: 'Needle', mesh: merge(...dark) },
    { material: 'NeedleLit', mesh: merge(...lit) },
    { material: 'SnowLoad', mesh: merge(...snow) },
  ];
}

/** A boulder: a sphere pushed around by noise, squashed, with a snow cap. */
function rock({ size, seed, squash = 0.62 }) {
  const rand = rng(seed);
  const lumps = [];
  for (let i = 0; i < 5; i++) {
    lumps.push({
      dir: [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1],
      amount: 0.12 + rand() * 0.34,
      sharp: 1.4 + rand() * 3.0,
    });
  }
  const base = displace(sphere(size, 2), (x, y, z) => {
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    let k = 1;
    for (const l of lumps) {
      const d = Math.hypot(...l.dir) || 1;
      const dot = (nx * l.dir[0] + ny * l.dir[1] + nz * l.dir[2]) / d;
      k += l.amount * Math.pow(Math.max(0, dot), l.sharp);
    }
    return [x * k, y * k * squash, z * k];
  });
  const { flat, steep } = splitByTilt(base, 0.62);
  return [
    { material: 'Rock', mesh: steep },
    { material: 'RockLight', mesh: flat },
    { material: 'SnowLoad', mesh: shell(flat, size * 0.035) },
  ];
}

export function buildVegetation() {
  const trees = [
    // The game scatters these four at random, so they have to differ in
    // silhouette, not only in scale — four sizes of the same tree reads as one
    // tree badly copied.
    { name: 'tree_spruce_a', parts: spruce({ height: 12.2, girth: 0.19, tiers: 11, seed: 11 }) },
    { name: 'tree_spruce_b', parts: spruce({ height: 8.6, girth: 0.165, tiers: 9, seed: 23, trunkBare: 0.10 }) },
    { name: 'tree_spruce_c', parts: spruce({ height: 16.4, girth: 0.215, tiers: 13, seed: 37, trunkBare: 0.20 }) },
    { name: 'tree_spruce_d', parts: spruce({ height: 5.1, girth: 0.105, tiers: 7, seed: 51, trunkBare: 0.07 }) },
  ];
  const rocks = [
    { name: 'rock_a', parts: rock({ size: 2.4, seed: 71 }) },
    { name: 'rock_b', parts: rock({ size: 1.35, seed: 89, squash: 0.74 }) },
    { name: 'rock_c', parts: rock({ size: 0.8, seed: 103, squash: 0.55 }) },
  ];
  return [...trees, ...rocks].map(({ name, parts }) => ({
    name,
    primitives: parts
      .filter((p) => p.mesh.indices.length > 0)
      .map((p) => ({ material: p.material, ...p.mesh })),
  }));
}
