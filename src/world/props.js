import * as THREE from 'three';
import { HALF, PISTE_OFF, SUMMIT_ELEV, BASE_ELEV } from '../shared/terrain.js';

// Everything standing on the mountain that is not the mountain.
//
// Trees are the expensive part. Six thousand full spruces would be three million
// triangles, so the forest runs in two tiers: real geometry for the trees you
// could ski into, and a six-face proxy for the rest of the valley. The swap
// happens on distance and is invisible because the proxy shares the silhouette.

const NEAR_RADIUS = 165; // metres — full geometry inside this
const NEAR_BUDGET = 620; // instances of each variant kept hot
const TREELINE = BASE_ELEV + 232;

/**
 * Nothing grows where the resort is. A forest that ignores the buildings puts a
 * spruce through the rental shop roof and another one under the chairlift, and
 * both look exactly as wrong as they are.
 */
function makeBlocker(keepOut) {
  if (!keepOut) return () => false;
  const circles = keepOut.circles || [];
  const corridors = keepOut.corridors || [];
  return (x, z) => {
    for (const c of circles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    for (const k of corridors) {
      const dx = k.x1 - k.x0, dz = k.z1 - k.z0;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - k.x0) * dx + (z - k.z0) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = k.x0 + dx * t, pz = k.z0 + dz * t;
      const ddx = x - px, ddz = z - pz;
      if (ddx * ddx + ddz * ddz < k.r * k.r) return true;
    }
    return false;
  };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the forest grows. Not a uniform sprinkle: trees avoid the pistes and
 * their shoulders, thin out with altitude until they stop at the treeline, and
 * refuse anything too steep to hold roots.
 */
export function scatterTrees(terrain, sampler, count = 5200, seed = 7717, keepOut = null) {
  const rand = mulberry(seed);
  const blocked = makeBlocker(keepOut);
  const trees = [];
  const variants = ['tree_spruce_a', 'tree_spruce_b', 'tree_spruce_c', 'tree_spruce_d'];
  let attempts = 0;
  while (trees.length < count && attempts < count * 26) {
    attempts++;
    const x = (rand() * 2 - 1) * (HALF - 24);
    const z = (rand() * 2 - 1) * (HALF - 24);

    if (blocked(x, z)) continue;
    if (sampler.samplePiste(x, z) !== PISTE_OFF) continue;
    // Keep a clear margin either side of a run: a tree on the edge of the piste
    // is a tree somebody skis into at 60 km/h through no fault of their own.
    let nearPiste = false;
    for (const [ox, oz] of [[9, 0], [-9, 0], [0, 9], [0, -9], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
      if (sampler.samplePiste(x + ox, z + oz) !== PISTE_OFF) { nearPiste = true; break; }
    }
    if (nearPiste) continue;

    const y = sampler.sampleHeight(x, z);
    if (y > TREELINE) continue;
    const slope = sampler.sampleSlope(x, z);
    if (slope > 0.86) continue; // 49 degrees: bare rock above that

    // Thinner higher up, and thinner still right at the treeline.
    const alt = (y - BASE_ELEV) / (SUMMIT_ELEV - BASE_ELEV);
    const chance = (1 - alt * 0.55) * (1 - Math.pow(Math.max(0, (y - (TREELINE - 60)) / 60), 1.5));
    if (rand() > chance) continue;

    // Clumping: small trees crowd the bigger ones.
    let v = 0;
    const r = rand();
    if (alt > 0.55) v = r < 0.5 ? 3 : 1;
    else if (r < 0.34) v = 0;
    else if (r < 0.62) v = 1;
    else if (r < 0.82) v = 2;
    else v = 3;

    trees.push({
      x, y, z,
      variant: variants[v],
      scale: 0.78 + rand() * 0.52,
      rot: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.06,
    });
  }
  return trees;
}

export function scatterRocks(terrain, sampler, count = 420, seed = 313, keepOut = null) {
  const rand = mulberry(seed);
  const blocked = makeBlocker(keepOut);
  const rocks = [];
  const variants = ['rock_a', 'rock_b', 'rock_c'];
  let attempts = 0;
  while (rocks.length < count && attempts < count * 30) {
    attempts++;
    const x = (rand() * 2 - 1) * (HALF - 20);
    const z = (rand() * 2 - 1) * (HALF - 20);
    if (blocked(x, z)) continue;
    if (sampler.samplePiste(x, z) !== PISTE_OFF) continue;
    const y = sampler.sampleHeight(x, z);
    const slope = sampler.sampleSlope(x, z);
    // Rocks belong where the snow cannot hold: steep ground and high ground.
    const wants = (y > TREELINE ? 0.75 : 0.14) + Math.max(0, slope - 0.5) * 0.9;
    if (rand() > wants) continue;
    rocks.push({
      x, y: y - 0.35, z,
      variant: variants[(rand() * 3) | 0],
      scale: 0.55 + rand() * 1.1,
      rot: rand() * Math.PI * 2,
    });
  }
  return rocks;
}

// --------------------------------------------------------------- rendering

/** A six-face cone that reads as a spruce from 200 m. */
function proxyGeometry(height, radius) {
  const geo = new THREE.ConeGeometry(radius, height * 0.82, 6, 1, false);
  geo.translate(0, height * 0.41 + height * 0.12, 0);
  const trunk = new THREE.CylinderGeometry(radius * 0.09, radius * 0.12, height * 0.3, 4);
  trunk.translate(0, height * 0.15, 0);
  const merged = mergeSimple([geo, trunk]);
  return merged;
}

function mergeSimple(geometries) {
  const positions = [];
  const normals = [];
  for (const g of geometries) {
    const gp = g.toNonIndexed();
    positions.push(...gp.attributes.position.array);
    normals.push(...gp.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return out;
}

export class TreeField {
  constructor(assets, trees, rocks) {
    this.group = new THREE.Group();
    this.group.name = 'forest';
    this.trees = trees;
    this.rocks = rocks;
    this.variants = new Map();
    this.dummy = new THREE.Object3D();
    this.lastCentre = new THREE.Vector3(1e9, 0, 1e9);
    this.densityScale = 1;

    // near tier: the real thing
    const byVariant = new Map();
    for (const t of trees) {
      if (!byVariant.has(t.variant)) byVariant.set(t.variant, []);
      byVariant.get(t.variant).push(t);
    }
    for (const [name, list] of byVariant) {
      const prims = assets.primitives(name);
      const size = assets.size(name);
      const meshes = prims.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, NEAR_BUDGET);
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        this.group.add(im);
        return im;
      });
      this.variants.set(name, { list, meshes, size });
    }

    // far tier: one proxy per variant, everything at once
    // Far trees are silhouettes, but a pure black silhouette against snow reads as
    // a hole in the world. This is the average of a snow-loaded spruce at range.
    this.farMaterial = new THREE.MeshLambertMaterial({ color: 0x4a5a55 });
    for (const [name, entry] of this.variants) {
      const h = entry.size.y;
      const proxy = proxyGeometry(h, entry.size.x * 0.5);
      const im = new THREE.InstancedMesh(proxy, this.farMaterial, entry.list.length);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      entry.far = im;
      this.group.add(im);
      // The far tier never moves, so its matrices are written exactly once.
      for (let i = 0; i < entry.list.length; i++) {
        const t = entry.list[i];
        this.dummy.position.set(t.x, t.y, t.z);
        this.dummy.rotation.set(0, t.rot, 0);
        this.dummy.scale.setScalar(t.scale);
        this.dummy.updateMatrix();
        im.setMatrixAt(i, this.dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.count = entry.list.length;
    }

    // rocks: few enough to keep as real geometry everywhere
    const rockByVariant = new Map();
    for (const r of rocks) {
      if (!rockByVariant.has(r.variant)) rockByVariant.set(r.variant, []);
      rockByVariant.get(r.variant).push(r);
    }
    this.rockMeshes = [];
    for (const [name, list] of rockByVariant) {
      for (const p of assets.primitives(name)) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          this.dummy.position.set(r.x, r.y, r.z);
          this.dummy.rotation.set(0, r.rot, 0);
          this.dummy.scale.setScalar(r.scale);
          this.dummy.updateMatrix();
          im.setMatrixAt(i, this.dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
        this.rockMeshes.push(im);
      }
    }
  }

  setDensity(scale) {
    this.densityScale = scale;
    for (const [, entry] of this.variants) {
      entry.far.count = Math.floor(entry.list.length * THREE.MathUtils.clamp(scale, 0.2, 1.4));
    }
    this.lastCentre.set(1e9, 0, 1e9);
  }

  update(dt, elapsed, camera) {
    const p = camera.position;
    // Repopulating the near tier is only worth doing when the camera has actually
    // gone somewhere; every frame would cost more than the trees do.
    if (p.distanceToSquared(this.lastCentre) < 18 * 18) return;
    this.lastCentre.copy(p);
    const r2 = NEAR_RADIUS * NEAR_RADIUS;
    for (const [, entry] of this.variants) {
      let n = 0;
      const budget = Math.min(entry.meshes[0].instanceMatrix.count, Math.floor(NEAR_BUDGET * this.densityScale));
      for (const t of entry.list) {
        if (n >= budget) break;
        const dx = t.x - p.x, dz = t.z - p.z;
        if (dx * dx + dz * dz > r2) continue;
        this.dummy.position.set(t.x, t.y, t.z);
        this.dummy.rotation.set(t.tilt, t.rot, t.tilt * 0.6);
        this.dummy.scale.setScalar(t.scale);
        this.dummy.updateMatrix();
        for (const m of entry.meshes) m.setMatrixAt(n, this.dummy.matrix);
        n++;
      }
      for (const m of entry.meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

// --------------------------------------------------------------- piste furniture

/**
 * The things that make a slope a marked run: marker poles down both edges, the
 * gates and rails the features asked for, netting on the corners where a mistake
 * would put you in the trees, and signage where runs part company.
 */
export class PisteFurniture {
  constructor(assets, terrain, sampler) {
    this.group = new THREE.Group();
    this.group.name = 'furniture';
    this.assets = assets;
    this.terrain = terrain;
    this.sampler = sampler;
    this.gates = [];
    this.rails = [];
    this.build();
  }

  place(name, x, z, rotY = 0, scale = 1, yOffset = 0, tiltToSlope = false) {
    const ob = this.assets.instance(name);
    const y = this.sampler.sampleHeight(x, z);
    ob.position.set(x, y + yOffset, z);
    ob.rotation.y = rotY;
    ob.scale.setScalar(scale);
    if (tiltToSlope) {
      const n = this.sampler.sampleNormal(x, z, 2);
      const up = new THREE.Vector3(n[0], n[1], n[2]);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      ob.quaternion.premultiply(q);
      ob.rotateY(rotY);
    }
    this.group.add(ob);
    return ob;
  }

  build() {
    const { terrain, sampler } = this;

    // --- marker poles down both edges of every run
    for (const run of terrain.runs) {
      const step = Math.max(6, Math.round(26 / 3));
      for (let i = 4; i < run.line.length - 4; i += step) {
        const [x, z] = run.line[i];
        const [nx, nz] = run.line[Math.min(i + 1, run.line.length - 1)];
        const dx = nx - x, dz = nz - z;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len, pz = dx / len;
        for (const side of [-1, 1]) {
          const w = run.halfWidth + 1.2;
          this.place('piste_marker', x + px * w * side, z + pz * w * side, 0, 1, 0, true);
        }
      }
    }

    // --- features
    for (const f of terrain.features) {
      const heading = Math.atan2(f.dir[0], f.dir[1]);
      const across = [-f.dir[1], f.dir[0]];
      if (f.type === 'gates') {
        for (let k = 0; k < f.count; k++) {
          const t = k / Math.max(1, f.count - 1);
          const along = (k - (f.count - 1) / 2) * f.spacing;
          const side = k % 2 === 0 ? 1 : -1;
          const x = f.x + f.dir[0] * along + across[0] * side * f.width * 0.5;
          const z = f.z + f.dir[1] * along + across[1] * side * f.width * 0.5;
          const model = side > 0 ? 'gate_pole_red' : 'gate_pole_blue';
          const pole = this.place(model, x, z, heading, 1, 0, true);
          this.gates.push({ x, z, y: pole.position.y, feature: f, index: k, side, taken: false, t });
        }
      } else if (f.type === 'rail') {
        const ob = this.place('park_rail', f.x, f.z, heading, f.length / 12, 0.05, true);
        this.rails.push({ x: f.x, z: f.z, dir: f.dir, length: f.length, height: f.height, feature: f, object: ob });
      } else if (f.type === 'box') {
        const ob = this.place('park_box', f.x, f.z, heading, 1, 0.02, true);
        this.rails.push({ x: f.x, z: f.z, dir: f.dir, length: f.length, height: f.height, feature: f, object: ob, box: true });
      }
    }

    // --- netting where a run turns hard with trees on the outside
    for (const run of terrain.runs) {
      for (let i = 12; i < run.line.length - 12; i += 4) {
        const a = run.line[i - 10], b = run.line[i], c = run.line[i + 10];
        const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]);
        const h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
        let turn = h2 - h1;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        if (Math.abs(turn) < 0.32) continue;
        const side = turn > 0 ? -1 : 1; // netting on the outside of the bend
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len * side, pz = dx / len * side;
        const w = run.halfWidth + 2.6;
        this.place('safety_net', b[0] + px * w, b[1] + pz * w,
          Math.atan2(dx, dz), 1, 0, true);
        i += 8;
      }
    }

    // --- signage where the runs leave the summit and where the black joins the red
    const summit = terrain.stations.summit;
    this.place('signpost', summit.x + 7, summit.z + 11, -0.5, 1, 0, true);
    this.place('signpost', summit.x - 9, summit.z + 8, 0.7, 1, 0, true);
    const black = terrain.runs.find((r) => r.key === 'black');
    if (black) {
      const end = black.line[black.line.length - 3];
      this.place('signpost', end[0] + 6, end[1] - 4, 1.9, 1, 0, true);
    }
  }
}
