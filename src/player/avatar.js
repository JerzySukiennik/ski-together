import * as THREE from 'three';
import { MODE } from './skier.js';

// The person on the skis.
//
// Assembled from the Blender parts, each with its origin on its own joint, so the
// whole body is driven from code: poses while riding, a stride while walking, and
// a Verlet ragdoll when it all goes wrong. No animation clips, nothing baked —
// which is why the ragdoll can take over mid-turn without a handover.

const HIP_Y = 0.92;
// From the ankle joint down to the base of the boot, plus the thickness of a ski.
const SOLE_DROP = 0.145;
const SHOULDER_Y = 0.36;
const SHOULDER_X = 0.20;
const HIP_X = 0.105;

export const DEFAULT_COLOURS = {
  jacket: '#d3352c',
  trousers: '#1b2430',
  helmet: '#16202b',
  gear: '#f2f5f8',
  trim: '#2e6fd9',
  scarf: '#ffb23f',
};

/** A colour a shade or two down from the given one, for contrast panels. */
function darken(hex, amount = 0.55) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(amount);
  return `#${c.getHexString()}`;
}

function recolourMap(colours) {
  return {
    Jacket: colours.jacket,
    // The jacket's contrast panels are the jacket, darker — so repainting at the
    // booth keeps the outfit looking like one garment rather than two.
    JacketDark: darken(colours.jacket, 0.42),
    Trousers: colours.trousers,
    Helmet: colours.helmet,
    GearPaint: colours.gear,
    GearTrim: colours.trim,
    Scarf: colours.scarf,
  };
}

export class Avatar {
  constructor(assets, { colours = DEFAULT_COLOURS, build = 1.0, kind = 'ski' } = {}) {
    this.assets = assets;
    this.colours = { ...DEFAULT_COLOURS, ...colours };
    this.kind = kind;
    this.build = build;

    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.rebuild();
    this.phase = 0;
    this.ragdoll = null;
    this.wave = 0;
    // Absorption: legs soaking up a landing or a bump, decaying back to standing.
    this.squash = 0;
    // Pole plant: which side, and how far through it we are.
    this.plant = { side: 0, t: 0 };
    this.lastEdge = 0;
  }

  /**
   * Everything a pose writes to.
   *
   * The poses themselves set rotations outright, which is easy to read and makes
   * every transition a snap — the skier changed shape between one frame and the
   * next. Rather than rewrite nine poses to emit blendable data, the update loop
   * remembers where every joint WAS, lets the pose write where it should be, and
   * then moves each joint part of the way there. One list, and every pose in the
   * game gained a transition.
   */
  joints() {
    if (this._joints) return this._joints;
    const out = [this.torso, this.head];
    for (const a of this.arms) out.push(a.upper, a.fore, a.pole);
    for (const l of this.legs) out.push(l.thigh, l.shin, l.boot);
    this._joints = out;
    return out;
  }

  part(name) {
    return this.assets.instance(name, { recolour: recolourMap(this.colours) });
  }

  rebuild() {
    this.body.clear();
    const b = this.build;

    this.hips = new THREE.Group();
    this.hips.position.y = HIP_Y * b;
    this.body.add(this.hips);

    this.torso = this.part('ch_torso');
    this.hips.add(this.torso);

    this.head = this.part('ch_head');
    this.head.position.y = 0.44 * b;
    this.torso.add(this.head);

    this.arms = [];
    for (const side of [-1, 1]) {
      const upper = this.part('ch_upperarm');
      upper.position.set(side * SHOULDER_X * b, SHOULDER_Y * b, 0);
      this.torso.add(upper);
      const fore = this.part('ch_forearm');
      fore.position.y = -0.27 * b;
      upper.add(fore);
      // The pole model's origin is its basket, so hanging it straight off the
      // hand would leave the grip a metre in the air. A mount at the hand, with
      // the shaft dropped by its own length, puts the grip where the hand is and
      // lets every pose rotate the pole about the grip like a real one.
      const poleMount = new THREE.Group();
      poleMount.position.set(0, -0.30 * b, 0.02);
      fore.add(poleMount);
      const pole = this.part('gear_pole');
      pole.position.y = -1.26 * b;
      poleMount.add(pole);
      poleMount.visible = this.kind === 'ski';
      this.arms.push({ side, upper, fore, pole: poleMount });
    }

    this.legs = [];
    const bootModel = this.kind === 'ski' ? 'ch_bootski' : 'ch_bootboard';
    for (const side of [-1, 1]) {
      const thigh = this.part('ch_thigh');
      thigh.position.set(side * HIP_X * b, -0.02 * b, 0);
      this.hips.add(thigh);
      const shin = this.part('ch_shin');
      shin.position.y = -0.42 * b;
      thigh.add(shin);
      const boot = this.part(bootModel);
      boot.position.y = -0.40 * b;
      shin.add(boot);
      this.legs.push({ side, thigh, shin, boot });
    }

    this.gear = new THREE.Group();
    this.body.add(this.gear);
    this._joints = null;
    this.buildGear();
    this.setPose('stand', 0);
  }

  buildGear() {
    this.gear.clear();
    this.skis = [];
    if (this.kind === 'ski') {
      for (const side of [-1, 1]) {
        const ski = this.part('gear_ski');
        ski.position.set(side * 0.155, 0.012, 0.02);
        this.gear.add(ski);
        this.skis.push(ski);
      }
    } else {
      const board = this.part('gear_board');
      board.position.set(0, 0.012, 0.02);
      board.rotation.y = Math.PI * 0.5;
      this.gear.add(board);
      this.skis.push(board);
    }
  }

  setKind(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.rebuild();
  }

  setColours(colours) {
    this.colours = { ...this.colours, ...colours };
    this.rebuild();
  }

  /** Detach the gear so it can be thrown across the mountain. */
  releaseGear() {
    const out = [];
    for (const g of this.skis) {
      g.updateMatrixWorld(true);
      this.gear.remove(g);
      out.push(g);
    }
    this.skis = [];
    // the helmet goes too
    if (this.head) {
      const helmetTaken = this.head;
      void helmetTaken;
    }
    return out;
  }

  restoreGear() {
    if (this.skis.length) return;
    this.buildGear();
  }

  // ------------------------------------------------------------------ poses

  setPose(name, t, opts = {}) {
    const b = this.build;
    const lean = opts.lean || 0;
    const crouch = opts.crouch || 0;
    const set = (o, x, y, z) => o.rotation.set(x, y || 0, z || 0);

    if (name === 'ride') {
      const deep = 0.42 + crouch * 0.55;
      this.hips.position.y = (HIP_Y - deep * 0.22) * b;
      // Counter-rotation and angulation: the legs turn, the upper body stays
      // pointed down the hill, and the hips push into the turn while the shoulders
      // stay level. That separation is what a skier looks like from behind, and
      // without it the whole body swings round like a shop dummy on a turntable.
      set(this.torso, 0.30 + crouch * 0.42, -lean * 0.46, lean * 0.22);
      set(this.head, -0.22 - crouch * 0.22, lean * 0.52, -lean * 0.10);
      for (const { side, thigh, shin, boot } of this.legs) {
        // the outside leg carries the turn, so it straightens
        const load = 1 + side * lean * 0.55;
        set(thigh, -deep * 0.9 * load, 0, side * (0.06 + lean * side * 0.05));
        set(shin, deep * 1.35 * load, 0, 0);
        set(boot, -deep * 0.35, 0, 0);
      }
      for (const { side, upper, fore, pole } of this.arms) {
        set(upper, -0.55 - crouch * 0.5, 0, side * (0.55 - crouch * 0.28));
        set(fore, -0.85 - crouch * 0.35, 0, 0);
        pole.rotation.x = -0.42 - crouch * 0.55;
      }
      // Edging tilts the skis about their own centre line, which buries the lower
      // edge in the snow. Lifting the pair by the height that tilt raises the
      // contact edge keeps the edge ON the surface, which is the whole point of
      // an edge.
      const tilt = -lean * 0.62;
      this.gear.rotation.set(0, 0, tilt);
      this.gear.position.y = Math.abs(Math.sin(tilt)) * (this.kind === 'ski' ? 0.10 : 0.17);
    } else if (name === 'tuck') {
      this.hips.position.y = (HIP_Y - 0.30) * b;
      set(this.torso, 1.05, 0, 0);
      set(this.head, -0.75, 0, 0);
      for (const { thigh, shin, boot } of this.legs) {
        set(thigh, -1.15, 0, 0);
        set(shin, 1.75, 0, 0);
        set(boot, -0.55, 0, 0);
      }
      for (const { side, upper, fore, pole } of this.arms) {
        set(upper, -1.75, 0, side * 0.18);
        set(fore, -0.35, 0, 0);
        pole.rotation.x = -1.24;
      }
      this.gear.rotation.set(0, 0, 0);
    } else if (name === 'air') {
      const grab = opts.grab || 0;
      this.hips.position.y = (HIP_Y - 0.16) * b;
      set(this.torso, 0.18 + grab * 0.85, 0, 0);
      set(this.head, -0.1, 0, 0);
      for (const { side, thigh, shin, boot } of this.legs) {
        set(thigh, -0.75 - grab * 0.45, 0, side * 0.14);
        set(shin, 1.25 + grab * 0.3, 0, 0);
        set(boot, -0.3, 0, 0);
      }
      for (const { side, upper, fore, pole } of this.arms) {
        set(upper, -0.35 + grab * 1.4, 0, side * (1.05 - grab * 0.75));
        set(fore, -0.55 - grab * 0.9, 0, 0);
        pole.rotation.x = -0.20;
      }
      this.gear.rotation.set(0, 0, 0);
    } else if (name === 'push') {
      // The V-step: tips splayed outwards, inside edges biting, weight rocking
      // from one ski to the other. This is how you cross the flat on skis.
      const swing = Math.sin(t);
      const splay = this.kind === 'ski' ? 0.44 : 0.0;
      // Herringbone is a series of shoves, not a stroll: the body drops into each
      // push and rises out of it, and the shoulders counter-rotate against the
      // legs. Without that it reads as walking with skis on, which is what it did.
      const drive = Math.abs(swing);
      this.hips.position.y = (HIP_Y - 0.21 + drive * 0.12) * b;
      set(this.torso, 0.54 - drive * 0.17, -swing * 0.28, swing * 0.08);
      set(this.head, -0.26, swing * 0.12, 0);
      this.legs.forEach(({ side, thigh, shin, boot }, i) => {
        const s2 = i === 0 ? swing : -swing;
        set(thigh, -0.34 - Math.max(0, s2) * 0.34, side * splay, side * 0.10);
        set(shin, 0.52 + Math.max(0, s2) * 0.42, 0, 0);
        set(boot, -0.16, 0, 0);
      });
      this.arms.forEach(({ side, upper, fore, pole }, i) => {
        const s2 = i === 0 ? -swing : swing;
        set(upper, -0.30 + s2 * 0.62, 0, side * 0.34);
        set(fore, -0.62 - Math.max(0, s2) * 0.30, 0, 0);
        // the pole plants behind you on the push
        pole.rotation.x = -0.55 - Math.max(0, s2) * 0.55;
      });
      this.gear.rotation.set(0, 0, 0);
      this.gear.position.y = 0;
      // Splay the skis themselves into the V.
      if (this.kind === 'ski') {
        // Tips APART. skis[0] is the left ski, and a positive rotation about Y
        // swings its tip to the right — inwards. This was building an A, not a V.
        this.skis.forEach((ski, i) => {
          const side = i === 0 ? -1 : 1;          // left, right
          ski.rotation.y = side * splay;
          ski.rotation.z = side * 0.26;           // rolled onto the inside edge
          // The pushing ski slides forward and lifts; the weighted one stays put.
          const kick = i === 0 ? swing : -swing;
          ski.position.z = 0.02 + Math.max(0, kick) * 0.40;
          ski.position.y = 0.012 + Math.max(0, kick) * 0.05;
        });
      }
    } else if (name === 'walk') {
      const speed = opts.speed || 0;
      const gait = Math.min(1, speed / 1.8);
      const swing = Math.sin(t) * gait;
      // Two bounces per stride, because you rise over each planted foot.
      const bob = Math.abs(Math.cos(t)) * gait;
      this.hips.position.y = (HIP_Y - 0.05 + bob * 0.045) * b;
      // Boots on snow: you lean forward and roll your shoulders against the stride.
      set(this.torso, 0.14 + gait * 0.16, -swing * 0.13, 0);
      set(this.head, -0.10 - gait * 0.06, swing * 0.10, 0);
      this.legs.forEach(({ side, thigh, shin, boot }, i) => {
        const s = i === 0 ? swing : -swing;
        set(thigh, -s * 0.62, 0, side * 0.06);
        // The trailing leg straightens and the leading one folds under.
        set(shin, Math.max(0, s) * 0.95 + 0.14, 0, 0);
        set(boot, -0.08 - Math.max(0, -s) * 0.28, 0, 0);
      });
      this.arms.forEach(({ side, upper, fore, pole }, i) => {
        const s = i === 0 ? -swing : swing;
        set(upper, s * 0.62, 0, side * (0.20 + gait * 0.06));
        set(fore, -0.32 - Math.max(0, s) * 0.34, 0, 0);
        pole.rotation.x = -0.30;
      });
      this.gear.rotation.set(0, 0, 0);
      // walking means the gear is off your feet and over your shoulder
      this.gear.visible = false;
    } else if (name === 'sit') {
      this.hips.position.y = HIP_Y * b;
      set(this.torso, 0.06, 0, 0);
      set(this.head, -0.02, 0, 0);
      for (const { side, thigh, shin, boot } of this.legs) {
        set(thigh, -1.45, 0, side * 0.06);
        set(shin, 1.35, 0, 0);
        set(boot, 0.1, 0, 0);
      }
      for (const { side, upper, fore, pole } of this.arms) {
        set(upper, -0.15, 0, side * 0.14);
        set(fore, -0.25, 0, 0);
        pole.rotation.x = -0.15;
      }
      this.gear.rotation.set(0, 0, 0);
    } else { // stand
      this.hips.position.y = HIP_Y * b;
      set(this.torso, 0.05, 0, 0);
      set(this.head, 0, 0, 0);
      for (const { side, thigh, shin, boot } of this.legs) {
        set(thigh, -0.06, 0, side * 0.045);
        set(shin, 0.12, 0, 0);
        set(boot, -0.05, 0, 0);
      }
      for (const { side, upper, fore, pole } of this.arms) {
        set(upper, -0.06, 0, side * 0.20);
        set(fore, -0.22, 0, 0);
        pole.rotation.x = -0.28;
      }
      this.gear.rotation.set(0, 0, 0);
    }
    if (name !== 'push' && this.kind === 'ski') {
      for (const ski of this.skis) {
        if (ski.rotation.y !== 0 || ski.rotation.z !== 0) ski.rotation.set(0, 0, 0);
      }
    }
    if (name !== 'walk') this.gear.visible = true;
  }

  update(dt, skier) {
    if (this.wave > 0) this.wave -= dt;
    this.root.position.copy(skier.pos);
    this.root.rotation.set(0, skier.heading, 0);
    const t = skier.telemetry;

    if (skier.mode === MODE.CRASH) {
      if (!this.ragdoll) this.ragdoll = new Ragdoll(this, skier);
      this.ragdoll.update(dt);
      return;
    }
    if (this.ragdoll) {
      this.ragdoll.dispose();
      this.ragdoll = null;
      this.body.position.set(0, 0, 0);
      this.body.rotation.set(0, 0, 0);
    }

    this.body.rotation.set(skier.pitch * 0.5, 0, -skier.roll);
    this._plantFeet = true;

    // --- remember where every joint is, so the pose about to be written can be
    //     blended towards rather than snapped to.
    const joints = this.joints();
    const before = joints.map((j) => [j.rotation.x, j.rotation.y, j.rotation.z]);
    const hipsBefore = this.hips.position.y;
    const gearBefore = [this.gear.rotation.z, this.gear.position.y];

    // --- absorption. A landing folds the legs and they come back up; so does
    //     clipping something. Without it the skier lands like a dropped chair.
    this.squash = Math.max(this.squash * Math.pow(0.02, dt * 2.6), 0);
    if (t.thud > 0.02) this.squash = Math.max(this.squash, Math.min(1, t.thud * 1.3));

    // --- pole plant. A skier reaching into a new turn touches the inside pole
    //     down as the edges change over. Watch for the edge crossing zero.
    if (skier.mode === MODE.RIDE && t.speed > 6) {
      const e = skier.edge;
      if (e * this.lastEdge < 0 && Math.abs(e - this.lastEdge) > 0.05) {
        this.plant.side = e > 0 ? 1 : -1;
        this.plant.t = 1;
      }
      this.lastEdge = e;
    } else {
      this.lastEdge = 0;
    }
    this.plant.t = Math.max(0, this.plant.t - dt * 3.2);

    if (skier.mode === MODE.LIFT) {
      // Chair: sitting. Drag lift: standing on your skis being towed.
      this.setPose(skier.liftKind === 'drag' ? 'stand' : 'sit', 0);
      this.body.rotation.set(0, 0, 0);
    } else if (skier.mode === MODE.AIR) {
      this.setPose('air', 0, { grab: Math.min(1, skier.air.grab * 3) });
      this.body.rotation.set(skier.pitch, 0, -skier.roll);
    } else if (skier.mode === MODE.WALK) {
      this.phase += dt * (4.4 + t.speed * 2.6);
      this.setPose('walk', this.phase, { speed: t.speed });
    } else if (skier.mode === MODE.RIDE) {
      if (t.pushing) {
        this.setPose('push', skier.pushPhase || 0);
      } else {
        const crouch = skier._tuck ? 1 : THREE.MathUtils.clamp(t.speed / 26, 0, 0.5);
        this.setPose(skier._tuck ? 'tuck' : 'ride', 0, { lean: skier.edge, crouch });
      }
    } else {
      this.setPose('stand', 0);
    }

    // --- blend towards whatever the pose just asked for.
    //
    // Air and crashes want to be quick; standing around wants to be lazy. A single
    // rate makes one of the two look wrong, so it comes from the pose.
    const rate = skier.mode === MODE.AIR ? 15
      : skier.mode === MODE.RIDE ? 12
        : 9;
    const k = 1 - Math.exp(-rate * dt);
    joints.forEach((j, i) => {
      const p = before[i];
      j.rotation.set(
        p[0] + (j.rotation.x - p[0]) * k,
        p[1] + (j.rotation.y - p[1]) * k,
        p[2] + (j.rotation.z - p[2]) * k,
      );
    });
    this.hips.position.y = hipsBefore + (this.hips.position.y - hipsBefore) * k;
    this.gear.rotation.z = gearBefore[0] + (this.gear.rotation.z - gearBefore[0]) * k;
    this.gear.position.y = gearBefore[1] + (this.gear.position.y - gearBefore[1]) * k;

    // --- absorption, applied on top of the blended pose so it reads on every one
    if (this.squash > 0.001) {
      const s = this.squash;
      this.hips.position.y -= s * 0.24 * this.build;
      for (const leg of this.legs) {
        leg.thigh.rotation.x -= s * 0.55;
        leg.shin.rotation.x += s * 0.95;
        leg.boot.rotation.x -= s * 0.30;
      }
      this.torso.rotation.x += s * 0.30;
    }

    // --- the pole reaching down into the new turn
    if (this.plant.t > 0.001 && this.kind === 'ski') {
      const arm = this.arms[this.plant.side > 0 ? 1 : 0];
      const reach = Math.sin(this.plant.t * Math.PI);
      arm.upper.rotation.x += reach * 0.55;
      arm.upper.rotation.z += this.plant.side * reach * 0.30;
      arm.fore.rotation.x += reach * 0.42;
      arm.pole.rotation.x -= reach * 0.85;
    }

    // Bending the knees shortens the leg, which lifts the boots off the snow and
    // leaves the skis hanging in space below them. Rather than hand-tuning every
    // pose, drop the whole body until the lower boot is standing on the ski.
    if (this._plantFeet) {
      this.body.position.y = 0;
      this.body.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const leg of this.legs) {
        leg.boot.getWorldPosition(_wp);
        if (_wp.y < lowest) lowest = _wp.y;
      }
      if (Number.isFinite(lowest)) {
        this.body.position.y = (this.root.position.y + SOLE_DROP) - lowest;
      }
      this._plantFeet = false;
    }

    // A wave is one arm overriding whatever pose is underneath it, which is the
    // cheapest possible gesture system and the only one this game needs.
    if (this.wave > 0) {
      const a = this.arms[1];
      const t = (1.2 - this.wave) * 9;
      a.upper.rotation.set(-2.5, 0, 0.5 + Math.sin(t) * 0.35);
      a.fore.rotation.set(-0.5, 0, 0);
      a.pole.visible = false;
    } else if (this.arms.length) {
      this.arms[1].pole.visible = this.kind === 'ski';
    }
  }
}

// ---------------------------------------------------------------- ragdoll

const BONE_LINKS = [
  ['head', 'chest', 0.30],
  ['chest', 'hips', 0.42],
  ['chest', 'handL', 0.56], ['chest', 'handR', 0.56],
  ['hips', 'footL', 0.86], ['hips', 'footR', 0.86],
  ['head', 'hips', 0.70],
  ['footL', 'footR', 0.34],
  ['handL', 'handR', 0.62],
  ['chest', 'footL', 0.95], ['chest', 'footR', 0.95],
];

/**
 * A dozen points on springs. Not a physics engine: eleven distance constraints
 * relaxed a few times a step, plus the snow surface as a floor. Over the network
 * it costs one position and one angle, because everyone's solver agrees.
 */
export class Ragdoll {
  constructor(avatar, skier) {
    this.avatar = avatar;
    this.skier = skier;
    const p = skier.pos;
    const v = skier.vel;
    const h = skier.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const b = avatar.build;

    const spawn = (dx, dy, dz) => ({
      pos: new THREE.Vector3(p.x + dx, p.y + dy * b, p.z + dz),
      prev: new THREE.Vector3(p.x + dx, p.y + dy * b, p.z + dz),
      pinned: false,
    });
    this.points = {
      head: spawn(fx * 0.10, 1.68, fz * 0.10),
      chest: spawn(fx * 0.05, 1.28, fz * 0.05),
      hips: spawn(0, 0.92, 0),
      handL: spawn(-0.34, 1.05, 0.10),
      handR: spawn(0.34, 1.05, 0.10),
      footL: spawn(-0.16, 0.06, 0),
      footR: spawn(0.16, 0.06, 0),
    };
    // Carry the momentum in: a crash at 60 km/h should not stop at the impact.
    const dt = 1 / 60;
    for (const k in this.points) {
      const pt = this.points[k];
      pt.prev.copy(pt.pos).addScaledVector(v, -dt);
      // a bit of tumble
      pt.prev.x += (Math.random() - 0.5) * 0.05;
      pt.prev.z += (Math.random() - 0.5) * 0.05;
    }
    this.time = 0;
    this.settled = false;
    this._v = new THREE.Vector3();
  }

  update(dt) {
    const step = Math.min(dt, 1 / 45);
    this.time += step;
    const G = 9.81;
    const damp = 0.992;

    for (const k in this.points) {
      const pt = this.points[k];
      this._v.copy(pt.pos).sub(pt.prev).multiplyScalar(damp);
      pt.prev.copy(pt.pos);
      pt.pos.add(this._v);
      pt.pos.y -= G * step * step;
    }

    for (let iter = 0; iter < 5; iter++) {
      for (const [a, b, rest] of BONE_LINKS) {
        const pa = this.points[a], pb = this.points[b];
        this._v.copy(pb.pos).sub(pa.pos);
        const d = this._v.length();
        if (d < 1e-5) continue;
        const diff = (d - rest) / d * 0.5;
        pa.pos.addScaledVector(this._v, diff);
        pb.pos.addScaledVector(this._v, -diff);
      }
      // the snow is the floor, and it drags
      for (const k in this.points) {
        const pt = this.points[k];
        const g = this.skier.groundAt(pt.pos.x, pt.pos.z);
        if (pt.pos.y < g) {
          pt.pos.y = g;
          const slide = 0.86;
          pt.prev.x = pt.pos.x - (pt.pos.x - pt.prev.x) * slide;
          pt.prev.z = pt.pos.z - (pt.pos.z - pt.prev.z) * slide;
          pt.prev.y = pt.pos.y;
        }
      }
    }

    // the skier's own position follows the hips, so the camera stays with them
    this.skier.pos.copy(this.points.hips.pos);
    this.skier.pos.y = this.skier.groundAt(this.skier.pos.x, this.skier.pos.z);

    // has it stopped?
    let motion = 0;
    for (const k in this.points) motion += this.points[k].pos.distanceTo(this.points[k].prev);
    this.settled = this.time > 0.7 && motion < 0.02;

    this.apply();
  }

  apply() {
    const av = this.avatar;
    const P = this.points;
    const root = av.root;
    root.position.copy(P.hips.pos);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const local = (v) => v.clone().applyMatrix4(inv);

    const hips = local(P.hips.pos);
    const chest = local(P.chest.pos);
    const head = local(P.head.pos);

    av.body.position.set(0, 0, 0);
    av.body.rotation.set(0, 0, 0);
    av.hips.position.copy(hips);
    aimAt(av.torso, chest.clone().sub(hips));
    aimAt(av.head, head.clone().sub(chest), 0.44 * av.build);

    const sides = [['handL', 'footL'], ['handR', 'footR']];
    sides.forEach(([hand, foot], i) => {
      const arm = av.arms[i];
      const leg = av.legs[i];
      const shoulderWorld = new THREE.Vector3();
      arm.upper.getWorldPosition(shoulderWorld);
      aimAt(arm.upper, local(P[hand].pos).sub(local(shoulderWorld)));
      arm.fore.rotation.set(0, 0, 0);
      const hipWorld = new THREE.Vector3();
      leg.thigh.getWorldPosition(hipWorld);
      aimAt(leg.thigh, local(P[foot].pos).sub(local(hipWorld)));
      leg.shin.rotation.set(0, 0, 0);
    });
  }

  dispose() {
    this.avatar.hips.position.set(0, HIP_Y * this.avatar.build, 0);
  }
}

const _wp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
function aimAt(object, dir, scale = 1) {
  if (dir.lengthSq() < 1e-6) return;
  // Parts hang downwards from their joint, so -Y is the direction they point.
  _q.setFromUnitVectors(_up.clone().negate(), dir.clone().normalize());
  object.quaternion.copy(_q);
  void scale;
}

// ---------------------------------------------------------------- lost gear

/**
 * The ski that came off. It slides, it stops within reach, and it glows just
 * enough to be findable in a white world — the whole point of the punishment is
 * ten seconds of walking, not a search party.
 */
export class LostGear {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'lost-gear';
    scene.add(this.group);
  }

  drop(objects, from, velocity, heading) {
    for (let i = 0; i < objects.length; i++) {
      const ob = objects[i];
      ob.position.copy(from);
      ob.position.y += 0.4;
      ob.rotation.set(0, heading, 0);
      this.group.add(ob);
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 6,
      );
      const kick = new THREE.Vector3(
        velocity.x * 0.55 + (Math.random() - 0.5) * 4.5,
        Math.abs(velocity.length()) * 0.16 + 2.4 + Math.random() * 1.6,
        velocity.z * 0.55 + (Math.random() - 0.5) * 4.5,
      );
      const halo = new THREE.PointLight(0xffd88a, 1.4, 7, 2);
      ob.add(halo);
      this.items.push({ object: ob, vel: kick, spin, rest: false, age: 0, halo });
    }
  }

  update(dt) {
    const G = 9.81;
    for (const it of this.items) {
      it.age += dt;
      it.halo.intensity = 1.1 + Math.sin(it.age * 3.2) * 0.35;
      if (it.rest) continue;
      it.vel.y -= G * dt;
      it.object.position.addScaledVector(it.vel, dt);
      it.object.rotation.x += it.spin.x * dt;
      it.object.rotation.y += it.spin.y * dt;
      it.object.rotation.z += it.spin.z * dt;
      const g = this.world.sampler.sampleHeight(it.object.position.x, it.object.position.z);
      if (it.object.position.y <= g + 0.05) {
        it.object.position.y = g + 0.05;
        it.vel.y = Math.abs(it.vel.y) * 0.22;
        // Snow does not bounce things far, and it stops them quickly. A ski that
        // slides to the valley is a two minute walk nobody enjoys twice.
        it.vel.x *= 0.58;
        it.vel.z *= 0.58;
        it.spin.multiplyScalar(0.42);
        if (it.vel.lengthSq() < 0.6) {
          it.rest = true;
          it.vel.set(0, 0, 0);
          it.object.rotation.set(0, it.object.rotation.y, 0);
          it.object.position.y = g + 0.03;
        }
      }
    }
  }

  /** Anything within arm's reach of a position, for picking up. */
  nearby(pos, radius = 2.0) {
    return this.items.filter((it) => it.object.position.distanceTo(pos) < radius);
  }

  collect(items) {
    for (const it of items) {
      this.group.remove(it.object);
      const idx = this.items.indexOf(it);
      if (idx >= 0) this.items.splice(idx, 1);
    }
  }

  clear() {
    for (const it of this.items) this.group.remove(it.object);
    this.items.length = 0;
  }
}
