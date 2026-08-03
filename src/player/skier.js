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
      this.stepWalk(dt, input, ground, N, ctx);
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
    // It used to take half a second, which reads as the skis not answering.
    const edgeRate = this.edge * target < 0 ? 9.5 : 6.6; // rolling off an edge is quicker than onto one
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

    // --- turning, which is two separate things a skier does at once.
    //
    // Carving is the arc the edged ski describes on its own: it needs grip and it
    // needs speed, and it is what the whole gear model is about. Pivoting is
    // twisting the skis across the direction of travel — it works standing still,
    // it works on ice, and it is what a hockey stop is made of. Modelling only the
    // first is why the skis felt like they were on rails one moment and dead the
    // next: as soon as the edge let go there was nothing left to steer with.
    const turnAuthority = 1 - 0.45 * skid;
    // Heading grows anticlockwise (three.js rotation.y) while positive steer means
    // right, so both turn rates carry a minus sign.
    const carveRate = -curvature * vForward * turnAuthority;
    // Pivot authority falls away with speed — at 80 km/h you steer with the edge,
    // not by twisting — and braking hands it straight back, which is exactly the
    // bargain a real skier makes when they throw the skis sideways to scrub speed.
    const pivotAuthority = 0.22 + 0.78 / (1 + speed * 0.34);
    // The pivot is what STARTS a turn, not something applied all the way through
    // one. Driving it from the steering the edge has not taken up yet means it
    // fires hard the moment you ask for a turn and fades to nothing once the ski
    // is carving — so initiation is sharp and the steady arc is still the arc the
    // gear promises. Applied continuously it quietly halved every printed turn
    // radius in the shop, which the acceptance test caught.
    const residual = target - this.edge;
    // Standing about, there is no edge to take anything up, so steer directly.
    const slow = 1 - THREE.MathUtils.clamp(speed / 3.5, 0, 1);
    const pivotInput = residual * (1 - slow) + target * slow;
    const pivotRate = -(pivotInput * 2.6 + target * braking * 3.6) * pivotAuthority;
    this.heading += (carveRate + pivotRate) * dt;
    this.telemetry.turnRate = carveRate + pivotRate;

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
    //
    // This is a person kicking off one ski and then the other, so the force
    // arrives in pulses rather than as a motor holding a constant thrust — and it
    // fades out as you reach the speed a kick can no longer add to, instead of
    // stopping dead at a threshold.
    const uphill = -slopeAcc.dot(fwd); // positive when the slope pushes you back
    if (input.throttle && this.stamina > 0.02) {
      const fade = 1 - THREE.MathUtils.clamp((speed - 3.4) / 2.6, 0, 1);
      if (fade > 0.001) {
        this.pushPhase = (this.pushPhase || 0) + dt * (4.7 + speed * 0.95);
        const kick = 0.42 + 0.58 * Math.max(0, Math.sin(this.pushPhase));
        // The skis win on the flat because two edges biting outwards beat one
        // board being kicked along.
        const push = (gear.kind === 'ski' ? 3.9 : 3.4) * fade * kick;
        acc.addScaledVector(fwd, push);
        this.stamina = Math.max(0, this.stamina - dt * (0.030 + 0.09 * Math.max(0, uphill / G)));
        this.telemetry.pushing = true;
        this.telemetry.pushKick = kick;
      } else {
        this.telemetry.pushing = false;
      }
    } else {
      this.telemetry.pushing = false;
    }

    // Shuffling backwards. At walking pace the brake key has nothing to brake, and
    // stepping back a metre is the difference between reaching the lift gate and
    // having to loop round the whole plaza to try again.
    if (braking > 0 && speed < 1.8) {
      acc.addScaledVector(fwd, -2.4 * (1 - speed / 1.8));
      this.telemetry.shuffling = true;
    } else {
      this.telemetry.shuffling = false;
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

    // --- crash: hitting a wall of snow sideways at speed.
    // A deliberate hockey stop throws the skis right across the hill and must not
    // be punished, so this only fires well past what a controlled skid reaches.
    if (speed > 13 && skid > 0.94 && Math.abs(vLat) > 9.5) {
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

  stepWalk(dt, input, ground, N, ctx = {}) {
    this.mode = MODE.WALK;
    const surf = this.world.snow.surfaceAt(this.pos.x, this.pos.z);
    const gear = this.stats;
    const bootSpeed = gear ? gear.walkSpeed : 1;

    // Sinking is the whole point: the groomed piste is a pavement, the powder is
    // a bog, and ice is a skating rink you did not ask for.
    let speedCap = 3.4 * bootSpeed;
    let slip = 0;
    if (surf.kind === 'powder') speedCap *= 0.34 - Math.min(0.16, surf.sink * 0.2) + 0.16;
    else if (surf.kind === 'ice') { speedCap *= 0.86; slip = 0.9; }
    else if (surf.kind === 'scraped') { speedCap *= 0.95; slip = 0.35; }

    const slopeAcc = _sa.set(0, -G, 0).addScaledVector(N, G * N.y);
    const steepness = Math.acos(THREE.MathUtils.clamp(N.y, -1, 1));
    // Uphill is harder, but not so much harder that crossing the resort on foot
    // becomes the longest part of the game.
    const uphillPenalty = 1 - THREE.MathUtils.clamp((steepness - 0.16) / 0.75, 0, 0.5);
    speedCap *= uphillPenalty * (0.78 + 0.22 * this.stamina);

    // On foot the keys move you where the camera is looking and the body turns to
    // follow, rather than steering you like a tank. Skiing keeps A and D as the
    // edge, because on skis that IS the control — but nobody walks that way, and
    // walking is most of what happens between the buildings.
    const camYaw = ctx.camYaw;
    const fx = (input.throttle || 0) - (input.brake || 0);
    const sx = input.steer || 0;
    const wish = _a.set(0, 0, 0);
    if (camYaw !== undefined) {
      const cf = _d.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      // right = forward x up. With forward = (sin y, 0, cos y) that is
      // (-cos y, 0, sin y). This had its exact negative, so D walked you left.
      const cr = _g.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
      wish.addScaledVector(cf, fx).addScaledVector(cr, sx);
      if (wish.lengthSq() > 1) wish.normalize();
      if (wish.lengthSq() > 0.01) {
        // Turn towards where you are going, fast enough to feel immediate and slow
        // enough that it reads as a person pivoting rather than a sprite flipping.
        const want = Math.atan2(wish.x, wish.z);
        let delta = want - this.heading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.heading += delta * Math.min(1, 11 * dt);
      }
    } else {
      this.heading += -sx * 2.6 * dt;
      wish.copy(this.forwardVector(_f)).multiplyScalar(fx);
    }

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
      this.stamina = Math.max(0, this.stamina - dt * (0.016 + 0.10 * Math.max(0, steepness - 0.14)));
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
      this.world.snow.pass(this.pos.x, this.pos.z, 0.28, 11 * dose,
        (surf.kind === 'powder' ? 110 : 38) * dose);
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
    this.hitObstacle(dt);
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

  /**
   * Everything standing on the mountain. Walking into a wall slides you along it;
   * skiing into a tree at speed does what skiing into a tree at speed does.
   */
  hitObstacle(dt) {
    // Sliding along a wall contacts it on every substep, so without a cooldown a
    // graze would fire a hundred and twenty impacts a second.
    this.bumpCooldown = Math.max(0, (this.bumpCooldown || 0) - dt);
    const colliders = this.world.colliders;
    if (!colliders || this.mode === MODE.CRASH) return;
    const hit = colliders.resolve(this.pos, 0.42, this.pos.y + 0.9);
    if (!hit) return;

    // Kill only the part of the velocity going into the surface, so a shoulder
    // against a wall turns into sliding down it rather than stopping dead.
    const into = this.vel.x * hit.nx + this.vel.z * hit.nz;
    if (into < 0) {
      this.vel.x -= hit.nx * into;
      this.vel.z -= hit.nz * into;
      const closing = -into;
      if (this.isRiding && closing > 5.5 && hit.hard) {
        this.telemetry.thud = Math.min(1, closing / 12);
        this.crash(hit.kind === 'tree' ? 'hit a tree' : `hit a ${hit.kind}`);
        return;
      }
      // Below that it is a scrape: it costs you speed and you carry on.
      if (closing > 1.5) {
        this.vel.multiplyScalar(Math.max(0.35, 1 - closing * 0.05));
        if (this.bumpCooldown === 0) {
          this.bumpCooldown = 0.35;
          this.emit('bump', { kind: hit.kind, force: Math.min(1, closing / 8) });
        }
      }
    }
  }

  cutSnow(dt, surf, skid, speed, braking, fwd, right) {
    const moved = speed * dt;
    if (moved < 0.0005) return;
    const radius = this.stats.kind === 'ski' ? 0.30 : 0.42;
    const dose = moved / (2 * radius);
    // A clean carve polishes; a skid tears the surface off.
    //
    // These numbers used to be about four times smaller, which meant one pass
    // moved the snow by roughly one percent — the mountain wore out over a day
    // exactly as designed, but a player who skied down and looked behind them saw
    // nothing at all. A ski leaves a mark the FIRST time, and the day-long wear
    // has to be built out of marks you can see, not underneath them.
    // A ski does not shave a few percent off the corduroy — it destroys the
    // tiller marks along its own width outright. Measured before this change, one
    // clean pass took a groomed cell from 100% to 94% condition, which no amount
    // of shading could show. A pass now leaves it about "skied", which is what
    // snow looks like after one person has been down it.
    const wear = (34 + skid * 70 + braking * 55) * dose;
    const cut = (10 + skid * 46 + braking * 34) * dose * (surf.kind === 'powder' ? 2.4 : 1);
    if (this.stats.kind === 'ski') {
      const off = 0.17;
      this.world.snow.pass(this.pos.x - right.x * off, this.pos.z - right.z * off, radius, wear, cut);
      this.world.snow.pass(this.pos.x + right.x * off, this.pos.z + right.z * off, radius, wear, cut);
    } else {
      this.world.snow.pass(this.pos.x, this.pos.z, radius, wear, cut);
    }
    // The rut itself is sixty centimetres wide, and measured from thirty metres up
    // the hill that is one or two pixels — which is exactly why the track kept
    // reading as "barely there" however dark the rut was made. What makes a real
    // track visible from the chair is not the groove, it is the wider band of
    // snow the skis scuff on either side of it: the tiller marks are gone there
    // too, so the eye picks up a metre-wide stripe instead of a hairline. This
    // pass wears that halo without cutting any depth into it.
    this.world.snow.pass(this.pos.x, this.pos.z, radius * 3.4, wear * 0.42, 0);
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
