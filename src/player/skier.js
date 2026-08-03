import * as THREE from 'three';
import { ridingStats } from '../gear/catalog.js';

// The skier.
//
// Own physics on the heightfield, not a rigid body. Every force here is one we
// chose: gravity down the fall line, edge grip capped by the snow underfoot,
// drag that depends on what the base is running over, and air resistance that a
// tuck cuts by a third. Speed is what is left when you stop turning.

const G = 9.81;
const MAX_LEAN = THREE.MathUtils.degToRad(58);
const AIR_K = 0.0060; // upright
const AIR_K_TUCK = 0.0039; // tucked
const STEP = 1 / 120; // physics substep

const up = new THREE.Vector3(0, 1, 0);

export const MODE = {
  RIDE: 'ride',
  WALK: 'walk',
  AIR: 'air',
  CRASH: 'crash',
  LIFT: 'lift',
  GROOMER: 'groomer',
};

export class Skier {
  constructor(world, { set, name = 'Skier', colours } = {}) {
    this.world = world; // { sampler, snow, terrain }
    this.name = name;
    this.colours = colours || { jacket: '#d3352c', trousers: '#16202b', hat: '#ffb23f' };

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = Math.PI; // facing down the mountain (towards +z)
    this.edge = 0; // -1 .. 1, smoothed
    this.lean = 0;
    this.pitch = 0;
    this.roll = 0;
    this.mode = MODE.WALK;
    this.switchRiding = false;

    this.set = set || { board: 'ski-piste74', boot: 'boot-ski', helmet: 'helmet-rental', jacket: 'jacket-shell' };
    this.stats = ridingStats(this.set);

    this.warmth = 1;
    this.stamina = 1;
    this.points = 0;
    this.groomedArea = 0;

    // air / trick bookkeeping
    this.air = { time: 0, spin: 0, flip: 0, grab: 0, height: 0, launchY: 0, launchHeading: 0 };
    this.lastTrick = null;
    this.combo = 0;
    this.comboTimer = 0;

    // things the renderer, the audio and the particles read
    this.telemetry = {
      speed: 0, skid: 0, edgeLoad: 0, surface: 'corduroy', cond: 1,
      airborne: false, sink: 0, slope: 0, onPiste: true, grounded: true,
      spray: 0, thud: 0, windchill: 0,
    };

    this.crashTimer = 0;
    this.events = [];
    this.gearLost = null;
    this.lift = null;
  }

  setGear(set) {
    this.set = { ...this.set, ...set };
    this.stats = ridingStats(this.set);
  }

  get isRiding() {
    return this.mode === MODE.RIDE || this.mode === MODE.AIR;
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Terrain height minus whatever has been carved out of the snow above it. */
  groundAt(x, z) {
    const base = this.world.sampler.sampleHeight(x, z);
    const s = this.world.snow.sample(x, z);
    return base - s.depth;
  }

  normalAt(x, z) {
    const n = this.world.sampler.sampleNormal(x, z, 1.2);
    return new THREE.Vector3(n[0], n[1], n[2]);
  }

  placeOnGround(x, z, heading = this.heading) {
    this.pos.set(x, this.groundAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.mode = MODE.WALK;
    this.edge = 0;
  }

  forwardVector(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  update(dt, input, ctx = {}) {
    if (this.mode === MODE.LIFT || this.mode === MODE.GROOMER) {
      this.updateComfort(dt, ctx);
      return;
    }
    if (this.mode === MODE.CRASH) {
      this.crashTimer -= dt;
      this.telemetry.speed = 0;
      this.telemetry.airborne = false;
      this.updateComfort(dt, ctx);
      return;
    }

    let remaining = Math.min(dt, 0.05);
    while (remaining > 0) {
      const h = Math.min(STEP, remaining);
      this.step(h, input, ctx);
      remaining -= h;
    }

    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    this.updateComfort(dt, ctx);
  }

  // ------------------------------------------------------------------ step

  step(dt, input, ctx) {
    const gear = this.stats;
    const boots = !gear || ctx.onFoot;
    const ground = this.groundAt(this.pos.x, this.pos.z);
    const N = this.normalAt(this.pos.x, this.pos.z);
    const grounded = this.pos.y <= ground + 0.03 && this.vel.y <= 0.6;

    if (boots) {
      this.stepWalk(dt, input, ground, N);
      return;
    }

    if (!grounded) this.stepAir(dt, input, ground, N);
    else this.stepRide(dt, input, ground, N);
  }

  // ------------------------------------------------------------------ riding

  stepRide(dt, input, ground, N) {
    if (this.mode === MODE.AIR) this.land(N);
    this.mode = MODE.RIDE;
    this.pos.y = ground;

    const gear = this.stats;
    const surf = this.world.snow.surfaceAt(this.pos.x, this.pos.z);

    // --- frame on the slope
    const fwd = this.forwardVector(_f).projectOnPlane(N);
    if (fwd.lengthSq() < 1e-6) fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    fwd.normalize();
    const right = _r.copy(fwd).cross(N).normalize();

    const vForward = this.vel.dot(fwd);
    const vLat = this.vel.dot(right);
    const speed = this.vel.length();

    // --- edge input
    const steer = input.steer || 0;
    const target = THREE.MathUtils.clamp(steer, -1, 1);
    // The edge takes a moment to set — that delay is the whole feel of a turn.
    const edgeRate = 4.4;
    this.edge += (target - this.edge) * Math.min(1, edgeRate * dt);
    const braking = input.brake || 0;
    const tucking = input.tuck && braking === 0 ? 1 : 0;

    // --- forces, per unit mass
    const acc = _a.set(0, 0, 0);

    // gravity split into the slope plane and the surface normal
    const gVec = _g.set(0, -G, 0);
    const gPerp = gVec.dot(N); // negative
    const slopeAcc = _sa.copy(gVec).addScaledVector(N, -gPerp);
    acc.add(slopeAcc);

    // normal load: weight plus whatever the turn is throwing at the snow
    const leanAngle = this.edge * MAX_LEAN * (1 - 0.45 * braking);
    const curvature = Math.sin(leanAngle) / Math.max(gear.turnRadius, 3);
    const centripetal = curvature * vForward * vForward;
    const load = Math.max(-gPerp + Math.abs(centripetal) * 0.35, 1.0);

    // --- edge grip
    const gripCoef = surf.grip * gear.edgeGrip * (0.62 + 0.38 * Math.abs(Math.cos(leanAngle)))
      * (0.75 + 0.25 * this.warmth);
    const maxLat = gripCoef * load;
    // What the turn is asking for: hold the arc AND kill any sideways drift.
    const wanted = -centripetal - vLat / Math.max(dt, 1e-4) * 0.35;
    const applied = THREE.MathUtils.clamp(wanted, -maxLat, maxLat);
    acc.addScaledVector(right, applied);
    // A skid is sideways travel, so measure sideways travel. Measuring the
    // shortfall of the corrective force instead saturates at 100% for everyone
    // and hides the whole difference between a rental ski and a race ski.
    const skid = THREE.MathUtils.clamp(
      Math.abs(vLat) / (Math.abs(vForward) * 0.30 + 0.9), 0, 1,
    );

    // --- turning. A carve that grips turns the ski; a skid mostly just scrubs.
    const turnAuthority = 1 - 0.72 * skid;
    // Heading grows anticlockwise (three.js rotation.y) while positive steer means
    // right, so the turn rate carries a minus sign.
    this.heading += -curvature * vForward * turnAuthority * dt;

    // Standing still you can still shuffle the tips around.
    if (speed < 2.2) {
      this.heading += -steer * (2.2 - speed) * 0.9 * dt;
    }

    // --- drag
    const airK = tucking ? AIR_K_TUCK : AIR_K;
    const dragAcc = airK * speed * speed;
    // Faster bases glide better. This, plus the ceiling below, is why the gear
    // you pick changes how fast the same slope runs.
    const glide = Math.pow(24 / gear.topSpeed, 1.6);
    const snowDrag = surf.drag * G * (1 + 0.045 * speed) * glide;
    // Skidding sideways scrubs far more than running flat — that is what a
    // hockey stop is.
    const skidDrag = skid * Math.abs(vLat) * 1.35;
    const brakeDrag = braking * (5.4 + 0.42 * speed) * surf.grip;
    // Powder swallows the tips. On a groomed piste there is nothing to sink into,
    // so this term has to stay at exactly zero there or it caps the whole game.
    const sinkDrag = Math.max(0, surf.sink - 0.08) * speed * 1.35;
    const total = dragAcc + snowDrag + skidDrag + brakeDrag + sinkDrag;
    if (speed > 0.02) acc.addScaledVector(_d.copy(this.vel).normalize(), -total);

    // Gear's own ceiling, ramped rather than clamped so it never feels like a wall.
    if (speed > gear.topSpeed * 0.74) {
      const over = (speed - gear.topSpeed * 0.74) / (gear.topSpeed * 0.26);
      acc.addScaledVector(_d.copy(this.vel).normalize(), -over * over * 9);
    }

    // --- herringbone / skating on the flat and uphill
    const uphill = -slopeAcc.dot(fwd); // positive when the slope pushes you back
    if (input.throttle && speed < 3.6 && this.stamina > 0.02) {
      const push = gear.kind === 'ski' ? 2.35 : 1.75;
      acc.addScaledVector(fwd, push);
      this.stamina = Math.max(0, this.stamina - dt * (0.045 + 0.10 * Math.max(0, uphill / G)));
      this.telemetry.pushing = true;
    } else {
      this.telemetry.pushing = false;
    }

    this.vel.addScaledVector(acc, dt);
    // A ski on snow travels along the surface, so the velocity is projected fully
    // into the slope plane. That is also what makes a kicker work: on the way up
    // the ramp the velocity tilts upwards, and when the lip drops away the skier
    // keeps going up. No jump code required — the ramp does it.
    this.vel.addScaledVector(N, -this.vel.dot(N));

    // --- jump
    if (input.jump && speed > 0.5) {
      const pop = THREE.MathUtils.clamp(3.2 + speed * 0.10, 3.2, 5.6);
      this.vel.addScaledVector(N, pop);
      this.beginAir();
    }

    this.integrate(dt);

    // Did the ground fall away faster than we could follow? Then we are flying.
    const nextGround = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y > nextGround + 0.045) {
      this.beginAir();
    } else {
      this.pos.y = nextGround;
    }

    this.cutSnow(dt, surf, skid, speed, braking, fwd, right);

    // --- crash: hitting a wall of snow sideways at speed
    if (speed > 11 && skid > 0.92 && Math.abs(vLat) > 7.5) {
      this.crash('caught an edge');
    }

    this.telemetry.speed = this.vel.length();
    this.telemetry.skid = skid;
    this.telemetry.edgeLoad = Math.abs(this.edge);
    this.telemetry.surface = surf.kind;
    this.telemetry.cond = surf.cond;
    this.telemetry.onPiste = surf.kind !== 'powder';
    this.telemetry.airborne = false;
    this.telemetry.grounded = true;
    this.telemetry.sink = surf.sink;
    this.telemetry.slope = Math.acos(THREE.MathUtils.clamp(N.y, -1, 1));
    this.telemetry.spray = (skid * 0.8 + braking * 0.6) * Math.min(1, speed / 9) * surf.spray;

    this.lean = leanAngle;
    this.roll = leanAngle * 0.85;
    this.pitch = -Math.atan2(slopeAcc.dot(fwd), G) * 0.6;
  }

  // ------------------------------------------------------------------ air

  beginAir() {
    if (this.mode === MODE.AIR) return;
    this.mode = MODE.AIR;
    this.air.time = 0;
    this.air.spin = 0;
    this.air.flip = 0;
    this.air.grab = 0;
    this.air.launchY = this.pos.y;
    this.air.height = 0;
    this.air.launchHeading = this.heading;
    this.air.launchVel = this.vel.length();
  }

  stepAir(dt, input, ground, N) {
    if (this.mode !== MODE.AIR) this.beginAir();
    const speed = this.vel.length();

    this.vel.y -= G * dt;
    const airK = input.tuck ? AIR_K_TUCK : AIR_K;
    if (speed > 0.02) this.vel.addScaledVector(_d.copy(this.vel).normalize(), -airK * speed * speed * dt);

    // In the air the edge keys spin you and the throttle/brake keys flip you.
    const spinRate = 3.4 * (input.grab ? 0.55 : 1);
    this.heading += -(input.steer || 0) * spinRate * dt;
    this.air.spin += Math.abs((input.steer || 0) * spinRate * dt);
    const flipInput = (input.brake || 0) - (input.throttle || 0);
    this.pitch += flipInput * 3.0 * dt;
    this.air.flip += Math.abs(flipInput * 3.0 * dt);
    if (input.grab) this.air.grab += dt;

    this.air.time += dt;
    this.integrate(dt);
    this.air.height = Math.max(this.air.height, this.pos.y - this.groundAt(this.pos.x, this.pos.z));

    this.telemetry.speed = this.vel.length();
    this.telemetry.airborne = true;
    this.telemetry.grounded = false;
    this.telemetry.spray = 0;
    this.telemetry.skid = 0;

    this.roll = Math.sin(this.air.spin * 2) * 0.12;
  }

  land(N) {
    const air = this.air;
    const speed = this.vel.length();
    const fwd = this.forwardVector(_f).projectOnPlane(N).normalize();
    const travel = _d.copy(this.vel).setY(0);
    const impactSpeed = Math.max(0, -this.vel.dot(N));

    let sideways = 0;
    if (travel.lengthSq() > 0.5) {
      travel.normalize();
      sideways = Math.acos(THREE.MathUtils.clamp(travel.dot(fwd), -1, 1));
    }

    // Rotation only counts if it comes back round to something you can ride away.
    const spinDeg = (air.spin * 180) / Math.PI;
    const flipDeg = (air.flip * 180) / Math.PI;
    const clean = sideways < THREE.MathUtils.degToRad(52) && Math.abs(this.pitch) < 0.9;
    const heavy = impactSpeed > 12.5;

    this.telemetry.thud = Math.min(1, impactSpeed / 12);
    this.pitch = 0;

    if (air.time > 0.28 && (!clean || heavy)) {
      this.crash(heavy ? 'landed too hard' : 'landed sideways');
      return;
    }

    // Landing eats some speed; landing straight eats very little.
    const loss = 0.06 + 0.5 * (sideways / Math.PI) + Math.min(0.35, impactSpeed / 40);
    this.vel.multiplyScalar(1 - loss);

    if (air.time > 0.35) {
      const base = 18 + air.time * 30 + air.height * 12;
      const rotation = Math.floor(spinDeg / 180) * 45 + Math.floor(flipDeg / 180) * 90;
      const grabBonus = Math.min(air.grab, air.time) * 55;
      const score = Math.round((base + rotation + grabBonus) * (1 + this.combo * 0.15));
      this.combo++;
      this.comboTimer = 5;
      this.lastTrick = {
        name: describeTrick(spinDeg, flipDeg, air.grab),
        score,
        air: air.time,
        height: air.height,
        combo: this.combo,
      };
      this.points += score;
      this.emit('trick', this.lastTrick);
    }
    this.mode = MODE.RIDE;
  }

  // ------------------------------------------------------------------ walking

  stepWalk(dt, input, ground, N) {
    this.mode = MODE.WALK;
    const surf = this.world.snow.surfaceAt(this.pos.x, this.pos.z);
    const gear = this.stats;
    const bootSpeed = gear ? gear.walkSpeed : 1;

    // Sinking is the whole point: the groomed piste is a pavement, the powder is
    // a bog, and ice is a skating rink you did not ask for.
    let speedCap = 2.2 * bootSpeed;
    let slip = 0;
    if (surf.kind === 'powder') speedCap *= 0.34 - Math.min(0.16, surf.sink * 0.2) + 0.16;
    else if (surf.kind === 'ice') { speedCap *= 0.86; slip = 0.9; }
    else if (surf.kind === 'scraped') { speedCap *= 0.95; slip = 0.35; }

    const slopeAcc = _sa.set(0, -G, 0).addScaledVector(N, G * N.y);
    const steepness = Math.acos(THREE.MathUtils.clamp(N.y, -1, 1));
    const uphillPenalty = 1 - THREE.MathUtils.clamp((steepness - 0.12) / 0.62, 0, 0.75);
    speedCap *= uphillPenalty * (0.55 + 0.45 * this.stamina);

    this.heading += -(input.steer || 0) * 2.6 * dt;
    const fwd = this.forwardVector(_f);
    const wish = _a.copy(fwd).multiplyScalar((input.throttle || 0) - (input.brake || 0) * 0.55);

    const target = _d.copy(wish).multiplyScalar(speedCap);
    const accel = slip > 0 ? 5 * (1 - slip * 0.75) : 16;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);

    // On ice you keep sliding downhill whatever your feet are doing.
    if (slip > 0) {
      this.vel.x += slopeAcc.x * slip * 0.5 * dt;
      this.vel.z += slopeAcc.z * slip * 0.5 * dt;
    }

    if (wish.lengthSq() > 0.01) {
      this.stamina = Math.max(0, this.stamina - dt * (0.028 + 0.14 * Math.max(0, steepness - 0.1)));
    } else {
      this.stamina = Math.min(1, this.stamina + dt * 0.09);
    }

    this.vel.y = 0;
    this.integrate(dt);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);

    // Boot prints, deeper the softer the snow.
    const moved = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (moved > 0.001) {
      const dose = moved / (2 * 0.28);
      this.world.snow.pass(this.pos.x, this.pos.z, 0.28, 5 * dose, (surf.kind === 'powder' ? 55 : 16) * dose);
    }

    this.telemetry.speed = Math.hypot(this.vel.x, this.vel.z);
    this.telemetry.airborne = false;
    this.telemetry.grounded = true;
    this.telemetry.surface = surf.kind;
    this.telemetry.cond = surf.cond;
    this.telemetry.sink = surf.kind === 'powder' ? 0.45 : 0.06;
    this.telemetry.skid = slip * (this.telemetry.speed > 1.2 ? 1 : 0);
    this.telemetry.spray = 0;
    this.lean = 0;
    this.roll = 0;
    this.pitch = 0;
  }

  // ------------------------------------------------------------------ shared

  integrate(dt) {
    this.pos.addScaledVector(this.vel, dt);
    // The world ends at the ridge line; nobody skis off the edge of the map.
    const limit = 740;
    if (Math.abs(this.pos.x) > limit) {
      this.pos.x = Math.sign(this.pos.x) * limit;
      this.vel.x *= -0.15;
    }
    if (Math.abs(this.pos.z) > limit) {
      this.pos.z = Math.sign(this.pos.z) * limit;
      this.vel.z *= -0.15;
    }
  }

  cutSnow(dt, surf, skid, speed, braking, fwd, right) {
    const moved = speed * dt;
    if (moved < 0.0005) return;
    const radius = this.stats.kind === 'ski' ? 0.30 : 0.42;
    const dose = moved / (2 * radius);
    // A clean carve polishes; a skid tears the surface off.
    const wear = (2.6 + skid * 26 + braking * 20) * dose;
    const cut = (3.4 + skid * 30 + braking * 22) * dose * (surf.kind === 'powder' ? 2.4 : 1);
    if (this.stats.kind === 'ski') {
      const off = 0.17;
      this.world.snow.pass(this.pos.x - right.x * off, this.pos.z - right.z * off, radius, wear, cut);
      this.world.snow.pass(this.pos.x + right.x * off, this.pos.z + right.z * off, radius, wear, cut);
    } else {
      this.world.snow.pass(this.pos.x, this.pos.z, radius, wear, cut);
    }
  }

  updateComfort(dt, ctx) {
    const warmthGear = this.stats?.warmth ?? 1;
    const night = ctx.night ?? 0;
    const sheltered = ctx.sheltered ?? 0;
    const windchill = Math.min(1, this.telemetry.speed / 22);
    this.telemetry.windchill = windchill;

    if (ctx.warming) {
      this.warmth = Math.min(1, this.warmth + dt * ctx.warming);
    } else if (!sheltered) {
      // Eight minutes from warm to shivering on a still afternoon; less at night,
      // less again if you are hurtling down the black in a rental shell.
      const base = 1 / (9.5 * 60);
      const rate = base * (1 + night * 0.55 + windchill * 0.5) / Math.max(warmthGear, 0.4);
      this.warmth = Math.max(0, this.warmth - dt * rate);
    }
    this.stamina = Math.min(1, this.stamina + dt * (this.mode === MODE.RIDE ? 0.055 : 0.02));
  }

  /** Cold never ends the run — it only makes the edge less willing. */
  get coldPenalty() {
    return THREE.MathUtils.clamp(1 - this.warmth * 1.25, 0, 1);
  }

  crash(reason) {
    if (this.mode === MODE.CRASH) return;
    const speed = this.vel.length();
    this.mode = MODE.CRASH;
    this.crashTimer = 1.0;
    this.combo = 0;
    this.lastTrick = null;
    this.emit('crash', { reason, speed, pos: this.pos.clone(), vel: this.vel.clone(), heading: this.heading });
  }

  recover(pos, heading) {
    this.mode = MODE.WALK;
    this.crashTimer = 0;
    if (pos) this.pos.copy(pos);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
    this.vel.set(0, 0, 0);
    if (heading !== undefined) this.heading = heading;
    this.edge = 0;
    this.pitch = 0;
    this.roll = 0;
  }

  // ------------------------------------------------------------------ network

  netState() {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
      h: this.heading, r: this.roll, p: this.pitch,
      m: this.mode, sk: this.telemetry.skid, sp: this.telemetry.speed,
    };
  }
}

function describeTrick(spinDeg, flipDeg, grab) {
  const spin = Math.floor(spinDeg / 180) * 180;
  const flips = Math.floor(flipDeg / 360);
  const parts = [];
  if (flips >= 1) parts.push(flips === 1 ? 'Flip' : `${flips}× flip`);
  if (spin >= 180) parts.push(`${spin}`);
  if (grab > 0.35) parts.push('grab');
  if (!parts.length) return 'Air';
  return parts.join(' + ');
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _g = new THREE.Vector3();
const _sa = new THREE.Vector3();
