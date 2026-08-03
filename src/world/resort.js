import * as THREE from 'three';
import { BASE_ELEV, NURSERY } from '../shared/terrain.js';
import { MODE } from '../player/skier.js';

// The resort: the buildings at the bottom and the two lifts that take you up.
//
// A lift is a cable, a set of pylons tall enough to hold it clear of the ground,
// and carriers spaced along it. Riding one is not a cutscene — you sit on a real
// chair moving along a real cable and can look wherever you like.

const CLEARANCE = 7.0; // metres of air under the cable
const TERMINAL_ZONE = 34; // metres over which a carrier slows into a station
const TERMINAL_SPEED = 1.6; // m/s at the loading point — walking pace, on purpose
const BULLWHEEL_OFFSET = 4.9; // model-space distance from station origin to its wheel

function sampleLine(sampler, from, to, step = 10) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const total = Math.hypot(dx, dz);
  const n = Math.max(2, Math.round(total / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = from.x + dx * t, z = from.z + dz * t;
    pts.push({ x, z, s: t * total, ground: sampler.sampleHeight(x, z) });
  }
  return { pts, length: total };
}

/**
 * Cable height along the line. The cable has to clear the ground everywhere, so
 * the profile is the upper envelope of the terrain plus clearance, smoothed until
 * it looks like something a cable would actually do.
 */
function cableProfile(pts) {
  const need = pts.map((p) => p.ground + CLEARANCE);
  // running maximum both ways gives a taut upper hull
  for (let i = 1; i < need.length; i++) need[i] = Math.max(need[i], need[i - 1] - 3.4);
  for (let i = need.length - 2; i >= 0; i--) need[i] = Math.max(need[i], need[i + 1] - 3.4);
  const out = need.slice();
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < out.length - 1; i++) {
      const avg = (out[i - 1] + out[i] * 2 + out[i + 1]) / 4;
      out[i] = Math.max(need[i], avg);
    }
  }
  return out;
}

export class Lift {
  constructor(assets, sampler, opts) {
    const {
      key, kind, from, to, speed, carrierSpacing, pylonSpacing,
      pylonModel, carrierModel, stationModel,
    } = opts;
    this.key = key;
    this.kind = kind; // 'chair' | 'drag'
    this.speed = speed;
    this.group = new THREE.Group();
    this.group.name = `lift_${key}`;
    this.sampler = sampler;

    const { pts, length } = sampleLine(sampler, from, to, 8);
    this.length = length;
    this.pts = pts;
    this.cableY = cableProfile(pts);
    this.from = from;
    this.to = to;
    this.dir = new THREE.Vector2(to.x - from.x, to.z - from.z).normalize();
    this.rideSeconds = length / speed;

    // --- pylons
    const pylonCount = Math.max(2, Math.round(length / pylonSpacing));
    for (let i = 1; i < pylonCount; i++) {
      const s = (i / pylonCount) * length;
      const p = this.at(s);
      const ob = assets.instance(pylonModel);
      ob.position.set(p.x, p.ground, p.z);
      ob.rotation.y = Math.atan2(this.dir.x, this.dir.y);
      const h = Math.max(3.5, p.cable - p.ground);
      ob.scale.set(1, h / (kind === 'chair' ? 11.0 : 5.6), 1);
      this.group.add(ob);
    }

    // --- stations. The model's bullwheel sits BULLWHEEL_OFFSET behind its origin,
    // so the terminal is placed such that its wheel lands exactly on the end of
    // the haul rope — which is the whole reason the rope can be drawn wrapping
    // around it instead of stopping in mid air.
    if (stationModel) {
      const head = Math.atan2(this.dir.x, this.dir.y);
      for (const [end, sign, flip] of [[from, +1, 0], [to, -1, Math.PI]]) {
        const sx = end.x + this.dir.x * BULLWHEEL_OFFSET * sign;
        const sz = end.z + this.dir.y * BULLWHEEL_OFFSET * sign;
        const st = assets.instance(stationModel);
        st.position.set(sx, sampler.sampleHeight(sx, sz), sz);
        st.rotation.y = head + flip;
        this.group.add(st);
      }
    }

    // --- cable, drawn as a thin tube through the profile
    const curvePts = [];
    for (let i = 0; i < pts.length; i++) curvePts.push(new THREE.Vector3(pts[i].x, this.cableY[i], pts[i].z));
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const cableGeo = new THREE.TubeGeometry(curve, Math.max(12, pts.length), 0.045, 5, false);
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.55, metalness: 0.9 });
    this.group.add(new THREE.Mesh(cableGeo, cableMat));
    if (kind === 'chair') {
      // return cable, offset to the side like the real thing
      const perpV = new THREE.Vector3(-this.dir.y, 0, this.dir.x);
      const back = curvePts.map((v) => v.clone().addScaledVector(perpV, 4.7));
      const backGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(back), Math.max(12, pts.length), 0.045, 5, false);
      this.group.add(new THREE.Mesh(backGeo, cableMat));
      this.returnOffset = 4.7;

      // The half-turn round each bullwheel. Without it the rope simply stops at
      // the terminal and the chairs teleport across to the return line.
      const R = 4.7 / 2;
      const fwd = new THREE.Vector3(this.dir.x, 0, this.dir.y);
      for (const [end, outward] of [[curvePts[0], -1], [curvePts[curvePts.length - 1], +1]]) {
        const centre = end.clone().addScaledVector(perpV, R);
        const arc = [];
        for (let i = 0; i <= 20; i++) {
          const a = (i / 20) * Math.PI;
          arc.push(centre.clone()
            .addScaledVector(perpV, -Math.cos(a) * R)
            .addScaledVector(fwd, Math.sin(a) * R * outward));
        }
        const arcGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 22, 0.045, 5, false);
        this.group.add(new THREE.Mesh(arcGeo, cableMat));
      }
    }

    // --- carriers
    this.carriers = [];
    const n = Math.max(2, Math.floor(length / carrierSpacing));
    for (let i = 0; i < n; i++) {
      const ob = assets.instance(carrierModel);
      this.group.add(ob);
      this.carriers.push({ object: ob, s: (i / n) * (length * 2), rider: null });
    }
    this.carrierModel = carrierModel;

    // Height from a carrier's origin up to the grip that rides the cable.
    this.hangerHeight = kind === 'chair' ? 3.58 : 3.5;
    this.seatHeight = kind === 'chair' ? 1.04 : 0;

    // Stand at the gate, not on top of the bullwheel.
    this.loadZone = {
      x: from.x + this.dir.x * 9, z: from.z + this.dir.y * 9, radius: 12,
    };
    this.unloadZone = { x: to.x, z: to.z, radius: 14 };
  }

  /** Position, ground height and cable height at distance `s` along the line. */
  at(s) {
    const t = THREE.MathUtils.clamp(s / this.length, 0, 1);
    const f = t * (this.pts.length - 1);
    const i = Math.min(this.pts.length - 2, Math.floor(f));
    const k = f - i;
    const a = this.pts[i], b = this.pts[i + 1];
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      ground: a.ground + (b.ground - a.ground) * k,
      cable: this.cableY[i] + (this.cableY[i + 1] - this.cableY[i]) * k,
    };
  }

  /**
   * How fast a carrier is moving at loop position s. Full line speed in the
   * middle, walking pace at the terminals — which is what makes getting on
   * possible rather than a stunt.
   */
  speedAt(s) {
    const loop = this.length * 2;
    const d = Math.min(s, Math.abs(this.length - s), loop - s);
    const t = THREE.MathUtils.clamp(d / TERMINAL_ZONE, 0, 1);
    const ease = t * t * (3 - 2 * t);
    return TERMINAL_SPEED + (this.speed - TERMINAL_SPEED) * ease;
  }

  update(dt) {
    const loop = this.length * 2;
    const perp = new THREE.Vector2(-this.dir.y, this.dir.x);
    for (const c of this.carriers) {
      c.s = (c.s + this.speedAt(c.s) * dt) % loop;
      const outbound = c.s <= this.length;
      const s = outbound ? c.s : loop - c.s;
      const p = this.at(s);
      const side = outbound ? 0 : (this.returnOffset || 0);
      // A carrier's origin is the foot of its hanger, and the grip is at the top,
      // so hanging it needs the whole hanger subtracted or the chair floats above
      // the cable it is supposed to be clipped to.
      c.object.position.set(p.x + perp.x * side, p.cable - this.hangerHeight, p.z + perp.y * side);
      c.ground = p.ground;
      c.object.rotation.y = Math.atan2(this.dir.x, this.dir.y) + (outbound ? 0 : Math.PI);
      // A chair swings a little; a T-bar swings a lot.
      const swing = this.kind === 'chair' ? 0.035 : 0.12;
      c.object.rotation.z = Math.sin(c.s * 0.09 + c.object.id) * swing;
      c.outbound = outbound;
      c.progress = outbound ? s / this.length : 1;
    }
  }

  /** The carrier a waiting skier could step onto right now, if any. */
  availableCarrier() {
    let best = null;
    for (const c of this.carriers) {
      if (c.rider || !c.outbound) continue;
      // Anything still inside the terminal, where it is crawling.
      if (c.s > TERMINAL_ZONE * 0.85) continue;
      if (!best || c.s > best.s) best = c;
    }
    return best;
  }

  nearLoad(pos) {
    return Math.hypot(pos.x - this.loadZone.x, pos.z - this.loadZone.z) < this.loadZone.radius;
  }
}

export class Resort {
  constructor(assets, terrain, sampler) {
    this.assets = assets;
    this.terrain = terrain;
    this.sampler = sampler;
    this.group = new THREE.Group();
    this.group.name = 'resort';
    this.buildings = [];
    this.zones = [];

    this.buildBase();
    this.buildLifts();
  }

  addBuilding(model, x, z, rotY, { name, zone }) {
    const ob = this.assets.instance(model);
    const y = this.sampler.sampleHeight(x, z);
    ob.position.set(x, y, z);
    ob.rotation.y = rotY;
    this.group.add(ob);
    const box = new THREE.Box3().setFromObject(ob);
    const entry = { name, model, object: ob, x, y, z, rotY, box };
    this.buildings.push(entry);
    if (zone) {
      // The doorway faces +Z in the model, so the zone sits just inside it.
      const dx = Math.sin(rotY), dz = Math.cos(rotY);
      this.zones.push({
        ...zone, name, x: x + dx * zone.depth, z: z + dz * zone.depth,
        y, radius: zone.radius, building: entry,
      });
    }
    return entry;
  }

  buildBase() {
    const base = this.terrain.stations.base;
    // Everything faces the mountain, which is towards -z from the base station.
    const face = Math.PI;
    this.addBuilding('bld_rental', base.x - 47, base.z + 22, face + 0.16,
      { name: 'rental', zone: { kind: 'rental', depth: -7.5, radius: 7.5 } });
    this.addBuilding('bld_cafe', base.x + 46, base.z + 26, face - 0.2,
      { name: 'cafe', zone: { kind: 'cafe', depth: -7.0, radius: 8.0 } });
    this.addBuilding('bld_booth', base.x - 12, base.z + 44, face + 0.05,
      { name: 'booth', zone: { kind: 'booth', depth: -3.4, radius: 4.4 } });
    this.addBuilding('bld_garage', base.x + 92, base.z - 4, face - 1.15,
      { name: 'garage', zone: { kind: 'garage', depth: -11, radius: 11 } });

    // A bonfire outside, because somebody has to stand around it after dark.
    const fire = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.28, 6, 18),
      new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.95 }),
    );
    ring.rotation.x = Math.PI / 2;
    fire.add(ring);
    const logs = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 1.5, 5),
        new THREE.MeshStandardMaterial({ color: 0x2e1d10, roughness: 0.9 }),
      );
      log.rotation.set(Math.PI / 2.6, (i / 6) * Math.PI * 2, 0);
      log.position.y = 0.35;
      logs.add(log);
    }
    fire.add(logs);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.5, 7),
      new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 }),
    );
    flame.position.y = 0.95;
    fire.add(flame);
    const light = new THREE.PointLight(0xff9a44, 6, 26, 2);
    light.position.y = 1.2;
    fire.add(light);
    const fx = base.x + 6, fz = base.z + 52;
    fire.position.set(fx, this.sampler.sampleHeight(fx, fz), fz);
    this.group.add(fire);
    this.fire = { group: fire, flame, light };
    this.zones.push({ kind: 'fire', name: 'bonfire', x: fx, z: fz, y: fire.position.y, radius: 5.5 });

    this.dressBase(base, face);

    // Floodlight masts along the lower runs, for the evening.
    this.floodlights = [];
    const run = this.terrain.runs.find((r) => r.key === 'red');
    for (let i = run.line.length - 12; i > run.line.length * 0.55; i -= 26) {
      const [x, z] = run.line[i];
      const [nx, nz] = run.line[i + 1];
      const dx = nx - x, dz = nz - z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len, pz = dx / len;
      const mx = x + px * (run.halfWidth + 3.5), mz = z + pz * (run.halfWidth + 3.5);
      this.addFloodlight(mx, mz, Math.atan2(-px, -pz));
    }
  }

  /**
   * The clutter that turns four buildings into a place: a piste map where people
   * stop to read it, benches, a ticket hut, fences along the walkways, flags,
   * crates outside the rental shop and snow cannons up the runs.
   */
  dressBase(base, face) {
    const place = (model, x, z, rotY = 0, scale = 1) => {
      const ob = this.assets.instance(model);
      ob.position.set(x, this.sampler.sampleHeight(x, z), z);
      ob.rotation.y = rotY;
      if (scale !== 1) ob.scale.setScalar(scale);
      this.group.add(ob);
      return ob;
    };

    // the board everyone reads before their first run
    place('prop_pistemap', base.x - 4, base.z + 40, face + 0.1);
    this.zones.push({ kind: 'map', name: 'piste map', x: base.x - 4, z: base.z + 42, y: 0, radius: 4 });

    place('prop_ticket', base.x + 16, base.z + 46, face - 0.3);
    place('prop_bench', base.x - 18, base.z + 42, face);
    place('prop_bench', base.x + 26, base.z + 40, face + 0.4);
    place('prop_bench', base.x + 2, base.z + 62, face + Math.PI);
    place('prop_bin', base.x - 9, base.z + 44, 0);
    place('prop_bin', base.x + 21, base.z + 44, 0);
    place('prop_crates', base.x - 58, base.z + 32, face + 0.9);
    place('prop_crates', base.x - 40, base.z + 30, face - 0.4, 0.85);

    // fences marking the walkway between the buildings and the lift
    for (let k = 0; k < 4; k++) {
      place('prop_fence', base.x - 30 + k * 8.1, base.z + 30, 0);
    }
    for (let k = 0; k < 3; k++) {
      place('prop_fence', base.x + 34, base.z + 20 + k * 8.1, Math.PI / 2);
    }

    // flags at the arrival plaza
    for (let k = 0; k < 4; k++) {
      place('prop_flag', base.x - 34 + k * 22, base.z + 66, 0.3 + k * 0.4);
    }

    // snow cannons along the lower half of the red and the blue
    for (const key of ['red', 'blue']) {
      const run = this.terrain.runs.find((r) => r.key === key);
      if (!run) continue;
      for (let i = run.line.length - 18; i > run.line.length * 0.42; i -= 34) {
        const [x, z] = run.line[i];
        const [nx, nz] = run.line[i + 1];
        const dx = nx - x, dz = nz - z;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len, pz = dx / len;
        const side = (i % 68 === 0) ? 1 : -1;
        const cx = x + px * (run.halfWidth + 2.6) * side;
        const cz = z + pz * (run.halfWidth + 2.6) * side;
        place('prop_cannon', cx, cz, Math.atan2(-px * side, -pz * side));
      }
    }
  }

  addFloodlight(x, z, rotY) {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.16, 8.5, 7),
      new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.6, metalness: 0.7 }),
    );
    mast.position.y = 4.25;
    mast.castShadow = true;
    g.add(mast);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.32, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.5 }),
    );
    head.position.set(0, 8.35, 0.35);
    g.add(head);
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.24, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x2b3038 }),
    );
    lens.position.set(0, 8.3, 0.62);
    g.add(lens);
    const light = new THREE.SpotLight(0xdfe9ff, 0, 90, 0.85, 0.5, 1.2);
    light.position.set(0, 8.3, 0.5);
    light.target.position.set(0, 0, 26);
    g.add(light);
    g.add(light.target);
    const y = this.sampler.sampleHeight(x, z);
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this.floodlights.push({ group: g, light, lens });
  }

  buildLifts() {
    const base = this.terrain.stations.base;
    const summit = this.terrain.stations.summit;

    // The chair runs the full mountain. At a realistic 5 m/s this line would take
    // four minutes, which is four minutes of nobody skiing, so it runs fast and
    // says so: 14 m/s puts the ride at about a minute and a half.
    this.chair = new Lift(this.assets, this.sampler, {
      key: 'chair',
      kind: 'chair',
      from: { x: base.x + 16, z: base.z - 14 },
      to: { x: summit.x + 4, z: summit.z + 26 },
      speed: 14,
      carrierSpacing: 46,
      pylonSpacing: 88,
      pylonModel: 'lift_pylon',
      carrierModel: 'chair_five',
      stationModel: 'lift_station',
    });
    this.group.add(this.chair.group);

    // The drag lift serves the bottom of the blue, one skier at a time.
    const blue = this.terrain.runs.find((r) => r.key === 'blue');
    const bottom = blue.line[blue.line.length - 12];
    const mid = blue.line[Math.floor(blue.line.length * 0.70)];
    this.drag = new Lift(this.assets, this.sampler, {
      key: 'drag',
      kind: 'drag',
      from: { x: bottom[0] - 22, z: bottom[1] - 6 },
      to: { x: mid[0] - 16, z: mid[1] },
      speed: 4.2,
      carrierSpacing: 22,
      pylonSpacing: 44,
      pylonModel: 'drag_pylon',
      carrierModel: 'tbar',
      stationModel: null,
    });
    this.group.add(this.drag.group);

    this.lifts = [this.chair, this.drag];
  }

  /**
   * The lamps the terrain shader needs, in world space. Three.js lights do not
   * reach a custom shader, so this is the bridge between them.
   */
  lamps() {
    const out = [];
    for (const fl of this.floodlights) {
      const l = fl.light;
      if (l.intensity <= 0.01) continue;
      const pos = new THREE.Vector3();
      l.getWorldPosition(pos);
      const target = new THREE.Vector3();
      l.target.getWorldPosition(target);
      out.push({
        position: pos,
        direction: target.sub(pos).normalize(),
        colour: l.color,
        intensity: l.intensity / 26,
        range: l.distance || 90,
        cosOuter: Math.cos(l.angle),
        cosInner: Math.cos(l.angle * (1 - l.penumbra * 0.85)),
      });
    }
    if (this.fire) {
      const pos = new THREE.Vector3();
      this.fire.light.getWorldPosition(pos);
      out.push({
        position: pos, colour: this.fire.light.color,
        intensity: this.fire.light.intensity / 7, range: 26,
      });
    }
    return out;
  }

  /** Where the forest must not grow: buildings, stations and under the cables. */
  keepOutZones() {
    const base = this.terrain.stations.base;
    const summit = this.terrain.stations.summit;
    const circles = [
      { x: base.x, z: base.z, r: 155 },
      { x: summit.x, z: summit.z, r: 62 },
      { x: NURSERY.cx, z: NURSERY.cz, r: Math.max(NURSERY.halfW, NURSERY.halfL) + 26 },
    ];
    for (const b of this.buildings) {
      const size = b.box.getSize(new THREE.Vector3());
      circles.push({ x: b.x, z: b.z, r: Math.max(size.x, size.z) * 0.62 + 9 });
    }
    const corridors = this.lifts.map((l) => ({
      x0: l.from.x, z0: l.from.z, x1: l.to.x, z1: l.to.z, r: 15,
    }));
    return { circles, corridors };
  }

  zoneAt(pos) {
    for (const z of this.zones) {
      if (Math.hypot(pos.x - z.x, pos.z - z.z) < z.radius) return z;
    }
    return null;
  }

  update(dt, elapsed, night) {
    for (const l of this.lifts) l.update(dt);
    if (this.fire) {
      const f = 0.85 + Math.sin(elapsed * 9.1) * 0.09 + Math.sin(elapsed * 21.7) * 0.05;
      this.fire.flame.scale.set(0.9 + f * 0.2, f, 0.9 + f * 0.2);
      this.fire.light.intensity = (5 + f * 3) * (0.4 + night * 0.6);
    }
    const on = night > 0.35;
    for (const fl of this.floodlights) {
      fl.light.intensity = on ? 22 * Math.min(1, (night - 0.35) / 0.3) : 0;
      fl.lens.material.color.setHex(on ? 0xfdfbf2 : 0x2b3038);
    }
  }
}

/**
 * Riding a lift. The skier stops being a skier and becomes a passenger: the
 * carrier owns the position, and the player owns only the camera.
 */
export class LiftRide {
  constructor(skier) {
    this.skier = skier;
    this.lift = null;
    this.carrier = null;
  }

  get active() {
    return this.lift !== null;
  }

  tryBoard(lift) {
    if (this.active) return false;
    const c = lift.availableCarrier();
    if (!c) return false;
    c.rider = this.skier;
    this.lift = lift;
    this.carrier = c;
    this.skier.mode = MODE.LIFT;
    this.skier.liftKind = lift.kind;
    this.skier.vel.set(0, 0, 0);
    return true;
  }

  update() {
    if (!this.active) return;
    const c = this.carrier;
    const lift = this.lift;
    if (lift.kind === 'chair') {
      // On the seat pan, which is forward of the chair's own origin — sitting at
      // the origin puts the rider inside the backrest.
      const fwd = 0.34;
      this.skier.pos.set(
        c.object.position.x + lift.dir.x * fwd,
        c.object.position.y + lift.seatHeight,
        c.object.position.z + lift.dir.y * fwd,
      );
    } else {
      // A drag lift does not carry you. You stay on your skis, on the snow, being
      // towed — which is why it is possible to fall off one.
      this.skier.pos.set(c.object.position.x, c.ground ?? this.skier.pos.y, c.object.position.z);
      this.skier.pos.y = this.skier.groundAt(this.skier.pos.x, this.skier.pos.z);
    }
    this.skier.heading = Math.atan2(lift.dir.x, lift.dir.y);
    if (c.progress >= 0.985) this.exit();
  }

  exit() {
    if (!this.active) return;
    const lift = this.lift;
    this.carrier.rider = null;
    this.carrier = null;
    this.lift = null;
    const s = this.skier;
    const drop = lift.at(lift.length * 0.995);
    s.pos.set(drop.x + 3, drop.ground, drop.z + 6);
    s.pos.y = s.groundAt(s.pos.x, s.pos.z);
    s.vel.set(0, 0, 0);
    s.mode = MODE.WALK;
    s.emit('lift-exit', { lift: lift.key });
  }
}
