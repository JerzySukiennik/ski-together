import * as THREE from 'three';
import { MODE } from '../player/skier.js';

// The piste basher.
//
// It exists for one reason: the snow never comes back on its own, so somebody has
// to put it back. Driving it is slow, deliberate and completely different from
// skiing — and it pays, per square metre actually restored, which means driving
// circles on fresh corduroy earns nothing.

const MAX_SPEED = 4.2; // m/s — about 15 km/h, which is what these things do
const REVERSE_SPEED = 2.0;
const ACCEL = 2.6;
const TURN_RATE = 0.85; // rad/s at full lock, tracks pivot hard
const TILLER_HALF_WIDTH = 2.4;

export class Groomer {
  constructor(assets, world, resort) {
    this.world = world;
    this.resort = resort;
    this.group = new THREE.Group();
    this.group.name = 'groomer';

    this.body = assets.instance('groomer');
    this.group.add(this.body);

    this.driver = null;
    this.heading = Math.PI * 0.5;
    this.speed = 0;
    this.pos = new THREE.Vector3();
    this.tillerDown = true;
    this.areaThisSession = 0;
    this.lastGroomPos = new THREE.Vector3();

    const garage = resort.buildings.find((b) => b.name === 'garage');
    const px = garage ? garage.x - 14 : 90;
    const pz = garage ? garage.z + 12 : 600;
    this.park(px, pz, Math.PI * 0.6);

    // headlights, which matter once the day cycle gets to evening
    this.lights = [];
    for (const sx of [-1, 1]) {
      const l = new THREE.SpotLight(0xfff0d0, 0, 60, 0.6, 0.45, 1.4);
      l.position.set(sx * 1.1, 2.6, 2.2);
      l.target.position.set(sx * 1.6, 0, 24);
      this.group.add(l);
      this.group.add(l.target);
      this.lights.push(l);
    }
    const beacon = new THREE.PointLight(0xffb23f, 0, 18, 2);
    beacon.position.set(0, 3.7, 1.5);
    this.group.add(beacon);
    this.beacon = beacon;
  }

  park(x, z, heading) {
    this.pos.set(x, this.world.sampler.sampleHeight(x, z), z);
    this.heading = heading;
    this.speed = 0;
    this.place();
  }

  place() {
    const s = this.world.sampler;
    const y = s.sampleHeight(this.pos.x, this.pos.z);
    this.pos.y = y;
    this.group.position.copy(this.pos);

    // Sit the machine on the slope: a groomer that ignores the terrain it grooms
    // looks wrong from every angle.
    const n = s.sampleNormal(this.pos.x, this.pos.z, 2.2);
    const up = new THREE.Vector3(n[0], n[1], n[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.group.quaternion.copy(q);
    this.group.rotateY(this.heading);
  }

  mount(skier) {
    if (this.driver) return false;
    this.driver = skier;
    skier.mode = MODE.GROOMER;
    skier.vel.set(0, 0, 0);
    return true;
  }

  dismount(skier) {
    if (this.driver !== skier) return;
    this.driver = null;
    this.speed = 0;
    const side = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    skier.pos.copy(this.pos).addScaledVector(side, 3.2);
    skier.pos.y = skier.groundAt(skier.pos.x, skier.pos.z);
    skier.vel.set(0, 0, 0);
    skier.mode = MODE.WALK;
  }

  seatPosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z);
  }

  control(dt, input) {
    const throttle = (input.throttle || 0) - (input.brake || 0);
    const target = throttle > 0 ? MAX_SPEED * throttle : REVERSE_SPEED * throttle;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -ACCEL * dt * 2.2, ACCEL * dt);
    if (Math.abs(throttle) < 0.01) this.speed *= Math.pow(0.02, dt);

    // Tracks turn on the spot, and turn harder the slower you go.
    const steer = -(input.steer || 0);
    const authority = 1 - Math.min(0.55, Math.abs(this.speed) / MAX_SPEED * 0.55);
    this.heading += steer * TURN_RATE * authority * dt * (this.speed >= 0 ? 1 : -1);

    if (input.jump) this.tillerDown = !this.tillerDown;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const before = this.lastGroomPos.clone();
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;

    // The world edge stops it, not a wall you can see.
    const limit = 700;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -limit, limit);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -limit, limit);

    this.place();

    if (this.tillerDown && Math.abs(this.speed) > 0.15) {
      this.groomAlong(before);
    }
    this.lastGroomPos.copy(this.pos);
  }

  /**
   * Lay corduroy between where the tiller was and where it is now, in steps small
   * enough that a fast pass leaves an unbroken strip rather than a dotted line.
   */
  groomAlong(from) {
    const tillerBack = 3.2;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const to = new THREE.Vector3(this.pos.x - fx * tillerBack, 0, this.pos.z - fz * tillerBack);
    const start = from.lengthSq() > 0
      ? new THREE.Vector3(from.x - fx * tillerBack, 0, from.z - fz * tillerBack)
      : to.clone();
    const dist = Math.hypot(to.x - start.x, to.z - start.z);
    const steps = Math.max(1, Math.ceil(dist / 0.35));
    let area = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (to.x - start.x) * t;
      const z = start.z + (to.z - start.z) * t;
      area += this.world.snow.groom(x, z, TILLER_HALF_WIDTH, Math.atan2(fz, fx));
    }
    if (area > 0) {
      this.areaThisSession += area;
      this.onGroomed?.(area);
    }
  }

  lamps() {
    if (!this.driver) return [];
    const out = [];
    for (const l of this.lights) {
      const pos = new THREE.Vector3();
      l.getWorldPosition(pos);
      const target = new THREE.Vector3();
      l.target.getWorldPosition(target);
      out.push({
        position: pos, direction: target.sub(pos).normalize(),
        colour: l.color, intensity: l.intensity / 10, range: 60,
        cosOuter: Math.cos(l.angle), cosInner: Math.cos(l.angle * 0.6),
      });
    }
    return out;
  }

  update(dt) {
    const night = this.resort ? 0 : 0;
    void night;
    if (this.driver) {
      this.beacon.intensity = 3.2;
      for (const l of this.lights) l.intensity = 9;
    } else {
      this.beacon.intensity = 0;
      for (const l of this.lights) l.intensity = 0;
    }
  }
}
