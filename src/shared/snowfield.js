// The snow. This is the heart of SKI Together.
//
// A grid of 0.5 m cells over the skiable part of the mountain. Every cell holds
// two bytes:
//
//   cond  255 = freshly groomed corduroy ... 0 = scraped ice with rock showing
//   carve 0   = untouched surface        ... 255 = a rut cut CARVE_MAX deep
//
// Both are read by the physics on the CPU and uploaded to the GPU as textures,
// so the rut you feel under the ski is the same rut you see. Nothing regenerates
// on its own: the only way snow comes back is a player driving the groomer.

export const SNOW_CELL = 0.5; // metres
export const SNOW_W = 2048; // cells, x
export const SNOW_H = 2560; // cells, z
export const SNOW_X0 = -512; // world x of cell 0
export const SNOW_Z0 = -640; // world z of cell 0
export const CARVE_MAX = 0.28; // metres of rut at carve = 255

export const COND_GROOMED = 255;
export const COND_ICE = 0;

// Off-piste starts as untracked powder: soft, slow, deep, and never groomed.
export const POWDER_COND = 200;
export const PISTE_START_COND = 255;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class SnowField {
  constructor(terrain) {
    this.terrain = terrain;
    this.cond = new Uint8Array(SNOW_W * SNOW_H);
    this.carve = new Uint8Array(SNOW_W * SNOW_H);
    // Cells that are on a piste; off-piste behaves as powder and cannot be groomed.
    this.onPiste = new Uint8Array(SNOW_W * SNOW_H);
    this.dirty = null;
    this.version = 0;
    this.groomedArea = 0; // m^2 restored this session, for scoring
    this.reset();
  }

  reset() {
    const { piste } = this.terrain;
    const HRES = Math.round(Math.sqrt(piste.length));
    const CELLT = 1536 / HRES;
    for (let j = 0; j < SNOW_H; j++) {
      const z = SNOW_Z0 + (j + 0.5) * SNOW_CELL;
      const tj = clamp(Math.floor((z + 768) / CELLT), 0, HRES - 1);
      for (let i = 0; i < SNOW_W; i++) {
        const x = SNOW_X0 + (i + 0.5) * SNOW_CELL;
        const ti = clamp(Math.floor((x + 768) / CELLT), 0, HRES - 1);
        const p = piste[tj * HRES + ti];
        const k = j * SNOW_W + i;
        this.onPiste[k] = p ? 1 : 0;
        this.cond[k] = p ? PISTE_START_COND : POWDER_COND;
        this.carve[k] = 0;
      }
    }
    this.markAll();
  }

  markAll() {
    this.dirty = { i0: 0, j0: 0, i1: SNOW_W - 1, j1: SNOW_H - 1 };
    this.version++;
  }

  markDirty(i0, j0, i1, j1) {
    if (!this.dirty) this.dirty = { i0, j0, i1, j1 };
    else {
      const d = this.dirty;
      if (i0 < d.i0) d.i0 = i0;
      if (j0 < d.j0) d.j0 = j0;
      if (i1 > d.i1) d.i1 = i1;
      if (j1 > d.j1) d.j1 = j1;
    }
  }

  takeDirty() {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  inBounds(x, z) {
    return x >= SNOW_X0 && z >= SNOW_Z0
      && x < SNOW_X0 + SNOW_W * SNOW_CELL && z < SNOW_Z0 + SNOW_H * SNOW_CELL;
  }

  index(x, z) {
    const i = clamp(Math.floor((x - SNOW_X0) / SNOW_CELL), 0, SNOW_W - 1);
    const j = clamp(Math.floor((z - SNOW_Z0) / SNOW_CELL), 0, SNOW_H - 1);
    return j * SNOW_W + i;
  }

  // Bilinear read of both channels — the physics needs a continuous surface, not
  // a staircase, or the skier chatters every half metre.
  sample(x, z) {
    const fx = (x - SNOW_X0) / SNOW_CELL - 0.5;
    const fz = (z - SNOW_Z0) / SNOW_CELL - 0.5;
    let i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    i = clamp(i, 0, SNOW_W - 2);
    j = clamp(j, 0, SNOW_H - 2);
    const k = j * SNOW_W + i;
    const c = this.cond, v = this.carve;
    const cond = (c[k] * (1 - tx) + c[k + 1] * tx) * (1 - tz)
      + (c[k + SNOW_W] * (1 - tx) + c[k + SNOW_W + 1] * tx) * tz;
    const carve = (v[k] * (1 - tx) + v[k + 1] * tx) * (1 - tz)
      + (v[k + SNOW_W] * (1 - tx) + v[k + SNOW_W + 1] * tx) * tz;
    return {
      cond: cond / 255,
      carve: carve / 255,
      depth: (carve / 255) * CARVE_MAX,
      onPiste: this.onPiste[this.index(x, z)] === 1,
    };
  }

  /**
   * A ski, a boot or a board passing over the snow.
   * @param edge 0 = flat and gliding, 1 = fully on edge / braking hard
   * @param load how hard the pass bites, scaled by speed and weight
   */
  pass(x, z, radius, wear, cut) {
    if (!this.inBounds(x, z)) return;
    const r = Math.max(SNOW_CELL, radius);
    const i0 = clamp(Math.floor((x - r - SNOW_X0) / SNOW_CELL), 0, SNOW_W - 1);
    const i1 = clamp(Math.ceil((x + r - SNOW_X0) / SNOW_CELL), 0, SNOW_W - 1);
    const j0 = clamp(Math.floor((z - r - SNOW_Z0) / SNOW_CELL), 0, SNOW_H - 1);
    const j1 = clamp(Math.ceil((z + r - SNOW_Z0) / SNOW_CELL), 0, SNOW_H - 1);
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const cz = SNOW_Z0 + (j + 0.5) * SNOW_CELL;
      const dz = cz - z;
      for (let i = i0; i <= i1; i++) {
        const cx = SNOW_X0 + (i + 0.5) * SNOW_CELL;
        const dx = cx - x;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const falloff = 1 - d2 / r2;
        const k = j * SNOW_W + i;
        if (wear > 0) {
          const w = this.cond[k] - wear * falloff;
          this.cond[k] = w < 0 ? 0 : w | 0;
        }
        if (cut > 0) {
          const v = this.carve[k] + cut * falloff;
          this.carve[k] = v > 255 ? 255 : v | 0;
        }
      }
    }
    this.markDirty(i0, j0, i1, j1);
  }

  /** The groomer's tiller: fills the ruts and lays fresh corduroy. */
  groom(x, z, halfWidth, heading) {
    if (!this.inBounds(x, z)) return 0;
    const r = halfWidth + 1;
    const i0 = clamp(Math.floor((x - r - SNOW_X0) / SNOW_CELL), 0, SNOW_W - 1);
    const i1 = clamp(Math.ceil((x + r - SNOW_X0) / SNOW_CELL), 0, SNOW_W - 1);
    const j0 = clamp(Math.floor((z - r - SNOW_Z0) / SNOW_CELL), 0, SNOW_H - 1);
    const j1 = clamp(Math.ceil((z + r - SNOW_Z0) / SNOW_CELL), 0, SNOW_H - 1);
    const ux = Math.cos(heading), uz = Math.sin(heading);
    let restored = 0;
    for (let j = j0; j <= j1; j++) {
      const cz = SNOW_Z0 + (j + 0.5) * SNOW_CELL;
      for (let i = i0; i <= i1; i++) {
        const cx = SNOW_X0 + (i + 0.5) * SNOW_CELL;
        const dx = cx - x, dz = cz - z;
        const along = dx * ux + dz * uz;
        const across = -dx * uz + dz * ux;
        if (Math.abs(across) > halfWidth || Math.abs(along) > 1.4) continue;
        const k = j * SNOW_W + i;
        if (!this.onPiste[k]) continue; // powder is not a piste and never will be
        const before = this.cond[k];
        const wasCarved = this.carve[k];
        if (before >= COND_GROOMED && wasCarved === 0) continue;
        // Score only what was genuinely worn, so driving circles on fresh snow
        // earns nothing.
        restored += ((255 - before) / 255 * 0.75 + wasCarved / 255 * 0.25) * SNOW_CELL * SNOW_CELL;
        this.cond[k] = COND_GROOMED;
        this.carve[k] = 0;
      }
    }
    this.markDirty(i0, j0, i1, j1);
    this.groomedArea += restored;
    return restored;
  }

  /**
   * Grip and drag under a ski, derived from the cell's condition.
   * Groomed:  fast and holds an edge.
   * Skied:    a bit slower, still fine.
   * Icy:      fastest of all and barely holds — the trap at the end of a session.
   * Powder:   slow and soft, but very hard to lose.
   */
  surfaceAt(x, z) {
    const s = this.sample(x, z);
    if (!s.onPiste) {
      const depth = 0.34 + (1 - s.cond) * 0.2;
      return {
        kind: 'powder',
        grip: 0.86,
        drag: 0.062 + depth * 0.11,
        sink: depth,
        cond: s.cond,
        carve: s.carve,
        spray: 1.0,
      };
    }
    const c = s.cond;
    // grip peaks on well-groomed snow, collapses on ice
    const grip = 0.34 + 0.72 * Math.pow(c, 0.75);
    // drag is lowest on ice (that is exactly why ice is dangerous)
    const drag = 0.0125 + 0.030 * Math.pow(c, 1.35);
    return {
      kind: c > 0.82 ? 'corduroy' : c > 0.45 ? 'skied' : c > 0.16 ? 'scraped' : 'ice',
      grip,
      drag,
      sink: 0.02 + 0.05 * c,
      cond: c,
      carve: s.carve,
      spray: 0.25 + 0.75 * c,
    };
  }

  // ------------------------------------------------------------ networking

  /**
   * Run-length encode both channels. A fresh mountain is almost entirely two
   * values, so a full snapshot of 5.2 M cells packs down to a few kilobytes and
   * only grows as the day gets skied out.
   */
  snapshot() {
    const parts = [encodeRLE(this.cond), encodeRLE(this.carve)];
    const total = 12 + parts[0].byteLength + parts[1].byteLength;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x534e4f57); // "SNOW"
    view.setUint32(4, parts[0].byteLength);
    view.setUint32(8, parts[1].byteLength);
    out.set(parts[0], 12);
    out.set(parts[1], 12 + parts[0].byteLength);
    return out;
  }

  applySnapshot(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0) !== 0x534e4f57) throw new Error('not a snow snapshot');
    const lenA = view.getUint32(4), lenB = view.getUint32(8);
    decodeRLE(bytes.subarray(12, 12 + lenA), this.cond);
    decodeRLE(bytes.subarray(12 + lenA, 12 + lenA + lenB), this.carve);
    this.markAll();
  }

  /** Only the rectangle that changed since the last call, as a flat patch. */
  takePatch() {
    const d = this.takeDirty();
    if (!d) return null;
    const w = d.i1 - d.i0 + 1, h = d.j1 - d.j0 + 1;
    if (w <= 0 || h <= 0) return null;
    const out = new Uint8Array(10 + w * h * 2);
    const view = new DataView(out.buffer);
    view.setUint16(0, d.i0);
    view.setUint16(2, d.j0);
    view.setUint16(4, w);
    view.setUint16(6, h);
    view.setUint16(8, 0);
    let p = 10;
    for (let j = 0; j < h; j++) {
      const row = (d.j0 + j) * SNOW_W + d.i0;
      out.set(this.cond.subarray(row, row + w), p);
      p += w;
    }
    for (let j = 0; j < h; j++) {
      const row = (d.j0 + j) * SNOW_W + d.i0;
      out.set(this.carve.subarray(row, row + w), p);
      p += w;
    }
    return out;
  }

  applyPatch(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const i0 = view.getUint16(0), j0 = view.getUint16(2);
    const w = view.getUint16(4), h = view.getUint16(6);
    let p = 10;
    for (let j = 0; j < h; j++) {
      const row = (j0 + j) * SNOW_W + i0;
      this.cond.set(bytes.subarray(p, p + w), row);
      p += w;
    }
    for (let j = 0; j < h; j++) {
      const row = (j0 + j) * SNOW_W + i0;
      this.carve.set(bytes.subarray(p, p + w), row);
      p += w;
    }
    this.markDirty(i0, j0, i0 + w - 1, j0 + h - 1);
  }
}

// ---------------------------------------------------------------- RLE

function encodeRLE(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const v = src[i];
    let run = 1;
    while (i + run < src.length && src[i + run] === v && run < 0xffffff) run++;
    // value, then a 3-byte run length
    out.push(v, (run >>> 16) & 255, (run >>> 8) & 255, run & 255);
    i += run;
  }
  return Uint8Array.from(out);
}

function decodeRLE(src, dst) {
  let p = 0, q = 0;
  while (p + 3 < src.length && q < dst.length) {
    const v = src[p];
    const run = (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3];
    dst.fill(v, q, Math.min(q + run, dst.length));
    q += run;
    p += 4;
  }
  return q;
}

export const snowCodec = { encodeRLE, decodeRLE };
