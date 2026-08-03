// Terrain generation for SKI Together.
// Pure JS, no three.js — runs in Node (tests) and in the browser (client + host).
// One mountain, three runs. The runs are not authored bumps on a flat plane: the
// mountain has its own shape and each run is carved into it, so a run's difficulty
// comes from the line it takes down a real slope, exactly like a real resort.

export const WORLD = 1536; // metres per side, centred on the origin
export const HRES = 1024; // heightmap cells per side
export const CELL = WORLD / HRES; // 1.5 m per cell
export const HALF = WORLD / 2;

export const BASE_ELEV = 1240; // metres above sea level at the base station
export const DROP = 320; // vertical drop to the summit
export const SUMMIT_ELEV = BASE_ELEV + DROP;

export const Z_BASE = 620; // base station sits here
export const Z_SUMMIT = -600; // summit station sits here

export const PISTE_OFF = 0;
export const PISTE_BLUE = 1;
export const PISTE_RED = 2;
export const PISTE_BLACK = 3;
export const PISTE_NURSERY = 4; // the nursery slope by the base station

// ---------------------------------------------------------------- noise

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

function fbm(x, z, seed, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = x, fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(fx, fz, seed + i * 131) * 2 - 1) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fz *= lacunarity;
  }
  return sum / norm;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, v) => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- run lines

// Centre lines run summit -> base. Blue traverses hard so its path is far longer
// than its drop; black falls almost straight down the east face. Same mountain,
// very different gradients — the difficulty is in the line, not in a difficulty tag.
export const RUN_DEFS = [
  {
    id: PISTE_BLUE,
    key: 'blue',
    name: 'Panorama',
    colour: 0x2e6fd9,
    halfWidth: 17,
    shoulder: 11,
    maxGrade: 0.36,
    minGrade: 0.075,
    tieBase: true,
    // Long lateral swings across the fall line: the blue is easy because it
    // refuses to go straight down, not because the mountain is soft there.
    points: [
      [10, -572], [-120, -500], [-280, -420], [-390, -300], [-410, -160],
      [-330, -40], [-200, 40], [-150, 150], [-250, 250], [-360, 340],
      [-330, 440], [-220, 510], [-100, 560], [-20, 600],
    ],
  },
  {
    id: PISTE_RED,
    key: 'red',
    name: 'Kanciarz',
    colour: 0xd3352c,
    halfWidth: 12.5,
    shoulder: 8,
    maxGrade: 0.50,
    minGrade: 0.095,
    tieBase: true,
    points: [
      [22, -570], [56, -470], [24, -350], [-6, -230], [40, -110],
      [70, 30], [30, 170], [-4, 300], [26, 430], [10, 545], [0, 600],
    ],
  },
  {
    id: PISTE_BLACK,
    key: 'black',
    name: 'Ostrze',
    colour: 0x14181f,
    halfWidth: 8.5,
    shoulder: 6,
    maxGrade: 0.70,
    minGrade: 0.13,
    // The black does not reach the valley. It falls down the east face and feeds
    // into the red halfway down, which is both how real resorts work and why the
    // lower red gets skied out first.
    tieBase: false,
    joins: 'red',
    points: [
      [46, -566], [128, -472], [178, -368], [192, -250], [172, -140],
      [196, -30], [168, 60], [110, 130], [34, 168],
    ],
  },
];

export const NURSERY = { cx: -168, cz: 556, halfW: 62, halfL: 74 };

// ---------------------------------------------------------------- polyline helpers

function resample(points, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    let t = carry;
    while (t < len) {
      out.push([x0 + (dx * t) / len, z0 + (dz * t) / len]);
      t += step;
    }
    carry = t - len;
  }
  out.push(points[points.length - 1].slice());
  return out;
}

// Chaikin corner cutting: turns the hand-placed control points into a line a
// skier could actually hold, without a spline library.
function smoothLine(points, iterations = 4) {
  let pts = points.map((p) => p.slice());
  for (let it = 0; it < iterations; it++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      next.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25]);
      next.push([x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function polylineLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return l;
}

// ---------------------------------------------------------------- base surface

// Elevation of the untouched mountain, before any run is carved into it.
function baseElevation(x, z, seed) {
  const t = clamp((Z_BASE - z) / (Z_BASE - Z_SUMMIT), 0, 1); // 0 at base, 1 at summit

  // Rise: gentle down low, steep up high. This single curve is why the upper
  // mountain is genuinely hard and the run-out is genuinely easy.
  const rise = DROP * Math.pow(t, 1.55);

  // Outer flanks close the bowl in so the world reads as a valley, not a ramp.
  const flank = 78 * Math.pow(t, 0.7) * Math.pow(smoothstep(360, 700, Math.abs(x)), 1.6);

  // A low rib between the red and black runs so they feel like separate places.
  const rib = 13 * Math.pow(t, 0.55) * Math.exp(-Math.pow((x - 118) / 52, 2));

  // A shallow gully west of centre that the blue run traverses across.
  const gully = -9 * Math.pow(t, 0.5) * Math.exp(-Math.pow((x + 250) / 90, 2));

  // Terrain relief: bigger and coarser up high where nobody grooms.
  const relief = 1 + 2.6 * t;
  const rough = fbm(x / 190, z / 190, seed, 4) * 7.5 * relief
    + fbm(x / 46, z / 46, seed + 77, 3) * 1.9 * relief;

  return BASE_ELEV + rise + flank + rib + gully + rough;
}

// ---------------------------------------------------------------- generation

export function generateTerrain(seed = 20260802) {
  const height = new Float32Array(HRES * HRES);
  const piste = new Uint8Array(HRES * HRES);
  const blend = new Float32Array(HRES * HRES); // how strongly a run owns this cell

  const idx = (i, j) => j * HRES + i;
  const cellX = (i) => -HALF + (i + 0.5) * CELL;
  const cellZ = (j) => -HALF + (j + 0.5) * CELL;
  const toI = (x) => Math.floor((x + HALF) / CELL);
  const toJ = (z) => Math.floor((z + HALF) / CELL);

  for (let j = 0; j < HRES; j++) {
    const z = cellZ(j);
    for (let i = 0; i < HRES; i++) height[idx(i, j)] = baseElevation(cellX(i), z, seed);
  }

  // --- flatten the two stations before carving, so the runs meet real ground
  // `packed` marks the disc as trodden ground rather than deep powder. The base
  // area of any resort is beaten solid by boots and machines all day, and without
  // it the walk from the car park to the rental shop is a wade through knee-deep
  // snow — which is exactly how it played before this line existed.
  const flattenDisc = (cx, cz, radius, feather, targetElev, packed = false) => {
    const i0 = Math.max(0, toI(cx - radius - feather)), i1 = Math.min(HRES - 1, toI(cx + radius + feather));
    const j0 = Math.max(0, toJ(cz - radius - feather)), j1 = Math.min(HRES - 1, toJ(cz + radius + feather));
    for (let j = j0; j <= j1; j++) {
      const z = cellZ(j);
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(cellX(i) - cx, z - cz);
        const w = 1 - smoothstep(radius, radius + feather, d);
        if (w <= 0) continue;
        const k = idx(i, j);
        height[k] = mix(height[k], targetElev, w);
        if (packed && w > 0.35 && piste[k] === PISTE_OFF) piste[k] = PISTE_NURSERY;
      }
    }
  };

  const baseArea = { x: 0, z: Z_BASE, elev: BASE_ELEV };
  const summitArea = { x: 0, z: Z_SUMMIT, elev: 0 }; // filled in below

  // Summit plateau takes the height the mountain already has there.
  summitArea.elev = height[idx(toI(0), toJ(Z_SUMMIT))];
  flattenDisc(baseArea.x, baseArea.z, 92, 74, BASE_ELEV, true);
  flattenDisc(summitArea.x, summitArea.z, 46, 46, summitArea.elev, true);

  // --- carve each run
  const runs = [];
  for (const def of RUN_DEFS) {
    const line = resample(smoothLine(def.points, 5), 3);

    // Elevation the run should have at each station along its length: sample the
    // mountain, then smooth hard and force it monotonically downhill. A run that
    // goes uphill anywhere is a run nobody can ski.
    const raw = line.map(([x, z]) => {
      const i = clamp(toI(x), 0, HRES - 1), j = clamp(toJ(z), 0, HRES - 1);
      return height[idx(i, j)];
    });
    const boxBlur = (arr, win) => arr.map((_, n) => {
      let s = 0, c = 0;
      for (let k = -win; k <= win; k++) {
        const m = n + k;
        if (m < 0 || m >= arr.length) continue;
        s += arr[m];
        c++;
      }
      return s / c;
    });

    let smooth = boxBlur(raw, 26);

    // Tie the ends: the top of every run meets the summit station; only the runs
    // that actually reach the valley meet the base station. The black meets
    // whatever the red already carved where it joins.
    const endBlend = 60;
    const tailTarget = def.tieBase ? BASE_ELEV : smooth[smooth.length - 1];
    for (let n = 0; n < endBlend && n < smooth.length; n++) {
      const w = 1 - n / endBlend;
      const ease = w * w * (3 - 2 * w);
      smooth[n] = mix(smooth[n], summitArea.elev, ease);
      const m = smooth.length - 1 - n;
      smooth[m] = mix(smooth[m], tailTarget, ease);
    }
    smooth = boxBlur(smooth, 10);

    // Relaxation under constraints: every step must fall, and no step may fall
    // faster than this run's steepest allowed pitch. Relaxing (rather than
    // clamping forward) keeps the ends where the stations are.
    const step = 3;
    // Every metre of every run has to keep you moving. A traverse flattened to 1%
    // is a place where the game silently stops, and the player blames themselves.
    const minDrop = (def.minGrade ?? 0.05) * step;
    const maxDrop = def.maxGrade * step;
    for (let pass = 0; pass < 220; pass++) {
      let worst = 0;
      for (let n = 1; n < smooth.length - 1; n++) {
        const dIn = smooth[n - 1] - smooth[n];
        const dOut = smooth[n] - smooth[n + 1];
        let push = 0;
        if (dIn > maxDrop) push += (dIn - maxDrop) * 0.5;
        if (dOut > maxDrop) push -= (dOut - maxDrop) * 0.5;
        if (dIn < minDrop) push -= (minDrop - dIn) * 0.5;
        if (dOut < minDrop) push += (minDrop - dOut) * 0.5;
        if (push !== 0) {
          smooth[n] += push;
          worst = Math.max(worst, Math.abs(push));
        }
      }
      if (worst < 0.002) break;
    }
    // Final guarantee: never climb, whatever the relaxation left behind.
    for (let n = 1; n < smooth.length; n++) {
      if (smooth[n] > smooth[n - 1] - 0.005) smooth[n] = smooth[n - 1] - 0.005;
    }

    const reach = def.halfWidth + def.shoulder;
    for (let n = 0; n < line.length - 1; n++) {
      const [ax, az] = line[n], [bx, bz] = line[n + 1];
      const i0 = Math.max(0, toI(Math.min(ax, bx) - reach)), i1 = Math.min(HRES - 1, toI(Math.max(ax, bx) + reach));
      const j0 = Math.max(0, toJ(Math.min(az, bz) - reach)), j1 = Math.min(HRES - 1, toJ(Math.max(az, bz) + reach));
      const dx = bx - ax, dz = bz - az;
      const segLen2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) {
        const pz = cellZ(j);
        for (let i = i0; i <= i1; i++) {
          const px = cellX(i);
          let t = ((px - ax) * dx + (pz - az) * dz) / segLen2;
          t = clamp(t, 0, 1);
          const qx = ax + dx * t, qz = az + dz * t;
          const d = Math.hypot(px - qx, pz - qz);
          if (d > reach) continue;
          const w = 1 - smoothstep(def.halfWidth, reach, d);
          if (w <= 0.001) continue;
          const k = idx(i, j);
          if (w <= blend[k]) continue;
          const target = mix(smooth[n], smooth[n + 1], t);
          height[k] = mix(height[k], target, w * w * (3 - 2 * w));
          blend[k] = w;
          if (w > 0.32) piste[k] = def.id;
        }
      }
    }

    runs.push({
      id: def.id,
      key: def.key,
      name: def.name,
      colour: def.colour,
      halfWidth: def.halfWidth,
      line,
      profile: smooth,
      length: polylineLength(line),
      topElev: smooth[0],
      bottomElev: smooth[smooth.length - 1],
    });
  }

  // --- nursery slope: a small, deliberately dull rectangle by the base station
  {
    const { cx, cz, halfW, halfL } = NURSERY;
    const feather = 24;
    const i0 = Math.max(0, toI(cx - halfW - feather)), i1 = Math.min(HRES - 1, toI(cx + halfW + feather));
    const j0 = Math.max(0, toJ(cz - halfL - feather)), j1 = Math.min(HRES - 1, toJ(cz + halfL + feather));
    for (let j = j0; j <= j1; j++) {
      const z = cellZ(j);
      for (let i = i0; i <= i1; i++) {
        const x = cellX(i);
        const wx = 1 - smoothstep(halfW, halfW + feather, Math.abs(x - cx));
        const wz = 1 - smoothstep(halfL, halfL + feather, Math.abs(z - cz));
        const w = wx * wz;
        if (w <= 0.001) continue;
        const k = idx(i, j);
        // A steady 11% gradient falling towards the base station.
        const target = BASE_ELEV + 0.11 * (cz + halfL - z);
        height[k] = mix(height[k], target, w);
        if (w > 0.5 && piste[k] === PISTE_OFF) piste[k] = PISTE_NURSERY;
      }
    }
  }

  // Where two runs meet, two independently smoothed profiles collide and leave a
  // step. Blur the pistes once everything is carved — before the features go on,
  // so the kicker lips stay sharp.
  smoothPistes(height, blend, 2);

  const features = buildFeatures(runs, seed);
  applyFeatureTerrain(height, piste, features, { idx, toI, toJ, cellX, cellZ });

  return {
    seed,
    height,
    piste,
    runs,
    features,
    stations: {
      base: { x: baseArea.x, z: baseArea.z, elev: BASE_ELEV },
      summit: { x: summitArea.x, z: summitArea.z, elev: summitArea.elev },
    },
  };
}

function smoothPistes(height, blend, passes) {
  const tmp = new Float32Array(height.length);
  for (let pass = 0; pass < passes; pass++) {
    tmp.set(height);
    for (let j = 1; j < HRES - 1; j++) {
      for (let i = 1; i < HRES - 1; i++) {
        const k = j * HRES + i;
        const w = blend[k];
        if (w <= 0.02) continue;
        const avg = (
          tmp[k] * 4
          + tmp[k - 1] + tmp[k + 1] + tmp[k - HRES] + tmp[k + HRES]
          + (tmp[k - HRES - 1] + tmp[k - HRES + 1] + tmp[k + HRES - 1] + tmp[k + HRES + 1]) * 0.5
        ) / 10;
        height[k] = mix(tmp[k], avg, Math.min(1, w) * 0.85);
      }
    }
  }
}

// ---------------------------------------------------------------- features

// Kickers are terrain, not props: the skier physics already knows how to launch
// off a ramp, so a jump costs nothing extra in the movement code.
function buildFeatures(runs, seed) {
  const out = [];
  let n = 0;
  const place = (run, s, spec) => {
    const line = run.line;
    const at = clamp(Math.round(s * (line.length - 1)), 1, line.length - 2);
    const [x, z] = line[at];
    const [px, pz] = line[at - 1];
    const [nx, nz] = line[at + 1];
    const dirX = nx - px, dirZ = nz - pz;
    const len = Math.hypot(dirX, dirZ) || 1;
    out.push({
      ...spec,
      id: `${run.key}-${spec.type}-${n++}`,
      run: run.key,
      runId: run.id,
      x, z,
      elev: run.profile[at],
      dir: [dirX / len, dirZ / len],
      s,
    });
  };

  for (const run of runs) {
    const rng = (k) => hash2(run.id * 91, k, seed);
    if (run.key === 'blue') {
      place(run, 0.18, { type: 'kicker', size: 0.7, points: 60 });
      place(run, 0.34, { type: 'gates', count: 8, spacing: 15, width: 9, points: 25 });
      place(run, 0.52, { type: 'kicker', size: 0.85, points: 80 });
      place(run, 0.66, { type: 'rail', length: 11, height: 0.55, points: 110 });
      place(run, 0.82, { type: 'gates', count: 10, spacing: 14, width: 8, points: 25 });
    } else if (run.key === 'red') {
      place(run, 0.14, { type: 'kicker', size: 1.15, points: 140 });
      place(run, 0.29, { type: 'gates', count: 12, spacing: 12, width: 6.5, points: 35 });
      place(run, 0.45, { type: 'rail', length: 14, height: 0.7, points: 150 });
      place(run, 0.58, { type: 'kicker', size: 1.35, points: 190 });
      place(run, 0.72, { type: 'box', length: 9, width: 1.6, height: 0.5, points: 120 });
      place(run, 0.88, { type: 'kicker', size: 1.0, points: 120 });
    } else if (run.key === 'black') {
      place(run, 0.12, { type: 'kicker', size: 1.6, points: 260 });
      place(run, 0.3, { type: 'gates', count: 14, spacing: 10, width: 5, points: 55 });
      place(run, 0.47, { type: 'rail', length: 17, height: 0.95, points: 240 });
      place(run, 0.63, { type: 'kicker', size: 1.85, points: 320 });
      place(run, 0.79, { type: 'gates', count: 12, spacing: 9.5, width: 4.6, points: 55 });
      place(run, 0.9, { type: 'kicker', size: 1.4, points: 210 });
    }
    void rng;
  }
  return out;
}

function applyFeatureTerrain(height, piste, features, ctx) {
  const { idx, toI, toJ, cellX, cellZ } = ctx;
  for (const f of features) {
    if (f.type !== 'kicker') continue;
    // A kicker throws you because its surface points UP relative to the slope it
    // sits on, not because it is tall. A fixed rise makes a big jump on a steep
    // black weaker than a small one on the blue — so the ramp's gradient, not its
    // height, is what scales with size.
    // Takeoff angle is what throws you; height is what makes it look like a jump.
    // Both scale with size, and the ramp length falls out of the two, so every
    // kicker is a believable 6 m of run-up with a steeper lip the bigger it gets.
    const grade = 0.20 + 0.14 * f.size;
    const rise = Math.min(1.2 + 0.9 * f.size, 3.2);
    const rampLen = rise / grade;
    const halfW = 4.6 * f.size + 1.2;
    const reach = rampLen + halfW + 6;
    const i0 = Math.max(0, toI(f.x - reach)), i1 = Math.min(HRES - 1, toI(f.x + reach));
    const j0 = Math.max(0, toJ(f.z - reach)), j1 = Math.min(HRES - 1, toJ(f.z + reach));
    const [dx, dz] = f.dir;
    for (let j = j0; j <= j1; j++) {
      const pz = cellZ(j);
      for (let i = i0; i <= i1; i++) {
        const px = cellX(i);
        const rx = px - f.x, rz = pz - f.z;
        const along = rx * dx + rz * dz; // + is downhill
        const across = -rx * dz + rz * dx;
        if (along > 2.6 || along < -rampLen - 2 || Math.abs(across) > halfW + 2) continue;
        const t = clamp((along + rampLen) / rampLen, 0, 1);
        const lateral = 1 - smoothstep(halfW - 2.2, halfW, Math.abs(across));
        // Full height AT the lip, then back to the natural slope over a couple of
        // metres. Cutting the top off the ramp is what makes a jump not jump.
        const lip = 1 - smoothstep(0.0, 2.2, along);
        // Quadratic ramp — a takeoff that actually throws you up, not a speed bump.
        const h = rise * t * t * lateral * lip;
        if (h <= 0.001) continue;
        const k = idx(i, j);
        height[k] += h;
        if (piste[k] === 0) piste[k] = f.runId;
      }
    }
  }
}

// ---------------------------------------------------------------- sampling

export function makeSampler(terrain) {
  const { height, piste } = terrain;
  const inv = 1 / CELL;

  function sampleHeight(x, z) {
    const fx = (x + HALF) * inv - 0.5;
    const fz = (z + HALF) * inv - 0.5;
    let i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    i = clamp(i, 0, HRES - 2);
    j = clamp(j, 0, HRES - 2);
    const k = j * HRES + i;
    const h00 = height[k], h10 = height[k + 1];
    const h01 = height[k + HRES], h11 = height[k + HRES + 1];
    return mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);
  }

  function sampleNormal(x, z, eps = 1.0) {
    const hL = sampleHeight(x - eps, z), hR = sampleHeight(x + eps, z);
    const hD = sampleHeight(x, z - eps), hU = sampleHeight(x, z + eps);
    let nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function samplePiste(x, z) {
    const i = clamp(Math.floor((x + HALF) * inv), 0, HRES - 1);
    const j = clamp(Math.floor((z + HALF) * inv), 0, HRES - 1);
    return piste[j * HRES + i];
  }

  function sampleSlope(x, z) {
    const n = sampleNormal(x, z);
    return Math.acos(clamp(n[1], -1, 1));
  }

  return { sampleHeight, sampleNormal, samplePiste, sampleSlope };
}

export const terrainUtils = { clamp, smoothstep, mix, fbm, valueNoise, hash2, polylineLength, smoothLine, resample };
