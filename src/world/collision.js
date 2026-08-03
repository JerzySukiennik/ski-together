// What you cannot ski through.
//
// The mountain itself is a heightfield and the physics already lives on it, so
// nothing here touches the ground: this is only the things STANDING on it. Every
// obstacle is either an upright cylinder (a tree, a pylon, a bin) or an upright
// box that can be turned (a building, a fence panel, a safety net) — which covers
// the whole resort without a mesh collider anywhere, and costs a handful of
// distance checks per frame instead of a raycast into a scene graph.
//
// Two deliberate omissions. Slalom and marker poles are NOT solid: the real ones
// are hinged and you knock them flat, and a game that stops you dead on a piste
// marker is a game nobody forgives. Rails and boxes in the park are not here
// either — they are ridden, not avoided, and the scoring code already owns them.

const CELL = 16; // metres per lookup cell

export class Colliders {
  constructor(half = 768) {
    this.half = half;
    this.shapes = [];
    this.grid = new Map();
    this.built = false;
  }

  /**
   * @param top world height of the top of the obstacle — anything passing above it
   *            misses, which is what lets you jump a bench instead of hitting it.
   */
  addCircle(x, z, radius, { kind = 'prop', top = Infinity, hard = false } = {}) {
    this.shapes.push({ box: false, x, z, r: radius, kind, top, hard });
  }

  addBox(x, z, hx, hz, rotY, { kind = 'prop', top = Infinity, hard = false } = {}) {
    this.shapes.push({
      box: true, x, z, hx, hz, kind, top, hard,
      cos: Math.cos(rotY), sin: Math.sin(rotY),
      r: Math.hypot(hx, hz), // bounding radius, for the broad phase
    });
  }

  build() {
    this.grid.clear();
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      const i0 = Math.floor((s.x - s.r) / CELL), i1 = Math.floor((s.x + s.r) / CELL);
      const j0 = Math.floor((s.z - s.r) / CELL), j1 = Math.floor((s.z + s.r) / CELL);
      for (let j = j0; j <= j1; j++) {
        for (let ii = i0; ii <= i1; ii++) {
          const key = ii * 100003 + j;
          let bucket = this.grid.get(key);
          if (!bucket) this.grid.set(key, bucket = []);
          bucket.push(i);
        }
      }
    }
    this.built = true;
    return this;
  }

  /**
   * Push a standing circle out of everything it overlaps, in place.
   *
   * Returns the deepest contact, or null. The caller decides what that means: the
   * skier slides along a wall and crashes into a tree, the groomer just stops.
   */
  resolve(pos, radius, y = pos.y) {
    if (!this.built) return null;
    let best = null;
    // Two passes, because pushing out of one thing can push you into the next —
    // which is exactly what happens in the corner between two buildings.
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      const bucket = this.grid.get(Math.floor(pos.x / CELL) * 100003 + Math.floor(pos.z / CELL));
      if (!bucket) break;
      for (const idx of bucket) {
        const s = this.shapes[idx];
        if (y > s.top - 0.15) continue;

        let nx, nz, depth;
        if (s.box) {
          // Into the box's own frame, find the nearest point on it, come back out.
          const dx = pos.x - s.x, dz = pos.z - s.z;
          const lx = dx * s.cos - dz * s.sin;
          const lz = dx * s.sin + dz * s.cos;
          const cx = Math.max(-s.hx, Math.min(s.hx, lx));
          const cz = Math.max(-s.hz, Math.min(s.hz, lz));
          let ox = lx - cx, oz = lz - cz;
          let d = Math.hypot(ox, oz);
          if (d > radius) continue;
          if (d < 1e-5) {
            // Dead centre: leave by the nearest face rather than by nothing.
            const toX = s.hx - Math.abs(lx), toZ = s.hz - Math.abs(lz);
            if (toX < toZ) { ox = Math.sign(lx) || 1; oz = 0; d = 0; depth = radius + toX; }
            else { ox = 0; oz = Math.sign(lz) || 1; d = 0; depth = radius + toZ; }
          } else {
            ox /= d; oz /= d;
            depth = radius - d;
          }
          nx = ox * s.cos + oz * s.sin;
          nz = -ox * s.sin + oz * s.cos;
        } else {
          const dx = pos.x - s.x, dz = pos.z - s.z;
          const d2 = dx * dx + dz * dz;
          const reach = radius + s.r;
          if (d2 > reach * reach) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-5) { nx = 1; nz = 0; depth = reach; }
          else { nx = dx / d; nz = dz / d; depth = reach - d; }
        }

        pos.x += nx * depth;
        pos.z += nz * depth;
        moved = true;
        if (!best || depth > best.depth) best = { nx, nz, depth, kind: s.kind, hard: s.hard };
      }
      if (!moved) break;
    }
    return best;
  }
}

/**
 * Everything in the resort that is solid, in one place.
 *
 * Deliberately built from the same lists the renderer used, not from the scene
 * graph: a collider derived from what was DRAWN can silently disagree with what
 * was placed, and the disagreement is invisible until somebody walks through a
 * wall.
 */
export function buildColliders(assets, resort, trees, rocks, furniture) {
  const c = new Colliders();

  for (const b of resort.buildings) {
    const size = assets.size(b.model);
    // Pull the footprint in a little: the eaves overhang the walls, and colliding
    // with the roofline stops you a metre short of a door you can see.
    c.addBox(b.x, b.z, size.x * 0.44, size.z * 0.44, b.rotY,
      { kind: 'building', hard: true, top: b.y + size.y });
  }

  for (const t of trees) {
    // The trunk, not the branches. You brush through a spruce's skirt; you do not
    // brush through its trunk.
    c.addCircle(t.x, t.z, 0.32 * t.scale, { kind: 'tree', hard: true, top: t.y + 14 * t.scale });
  }

  for (const r of rocks) {
    c.addCircle(r.x, r.z, 0.72 * r.scale, { kind: 'rock', hard: true, top: r.y + 1.5 * r.scale });
  }

  for (const lift of resort.lifts) {
    for (let i = 1; i < lift.supports.length - 1; i++) {
      const p = lift.at(lift.supports[i]);
      c.addCircle(p.x, p.z, 0.62, { kind: 'pylon', hard: true, top: p.cable });
    }
    // The terminal housing, but only its middle: the boarding deck around it has
    // to stay walkable or nobody can get on the lift at all.
    for (const st of lift.stationPos || []) {
      c.addCircle(st.x, st.z, 2.4, { kind: 'station', hard: false, top: st.y + 6 });
    }
  }

  for (const p of [...resort.solidProps, ...(furniture?.solids || [])]) {
    if (p.hx !== undefined) c.addBox(p.x, p.z, p.hx, p.hz, p.rotY || 0, p);
    else c.addCircle(p.x, p.z, p.r, p);
  }

  return c.build();
}
