import * as THREE from 'three';
import { MODE } from './skier.js';

// Third person, over the shoulder. It pulls back and drops low as you gain speed,
// so the mountain rushing past does the work of telling you how fast you are going,
// and it never fights the mouse: looking around is always yours.

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _look = new THREE.Vector3();

const _liftLook = new THREE.Vector3();

export class FollowCamera {
  constructor(camera, skier, world) {
    this.camera = camera;
    this.skier = skier;
    this.world = world;
    this.yaw = 0; // relative to the skier's heading
    this.pitch = 0.10;
    this.distance = 6.2;
    this.targetDistance = 6.2;
    this.height = 1.55;
    this.smoothed = new THREE.Vector3();
    this.smoothedLook = new THREE.Vector3();
    this.shake = 0;
    this.initialised = false;
    this.mode = 'follow'; // or 'free'
    this.fovBase = camera.fov;
  }

  reset() {
    this.initialised = false;
    this.yaw = 0;
    this.pitch = 0.10;
  }

  update(dt, input) {
    const s = this.skier;

    if (s.mode === MODE.LIFT) {
      this.updateLift(dt, input);
      return;
    }

    if (input) {
      this.yaw -= input.lookX;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, -0.55, 0.95);
      if (input.zoom) this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + input.zoom * 0.8, 2.4, 14);
    }
    // The camera drifts back behind the skier when you stop steering it, but only
    // slowly enough that you can keep watching a friend on the next line.
    this.yaw = THREE.MathUtils.damp(this.yaw, 0, 0.55, dt);

    const speed = s.telemetry.speed;
    const fast = THREE.MathUtils.clamp(speed / 24, 0, 1);
    const dist = this.targetDistance + fast * 2.6;
    this.distance = THREE.MathUtils.damp(this.distance, dist, 4, dt);

    const angle = s.heading + this.yaw;
    const pitch = this.pitch - fast * 0.06;

    _target.copy(s.pos);
    _target.y += 1.15;

    _offset.set(
      Math.sin(angle) * Math.cos(pitch),
      Math.sin(pitch) + 0.16,
      Math.cos(angle) * Math.cos(pitch),
    ).multiplyScalar(-this.distance);
    _desired.copy(_target).add(_offset);
    _desired.y += this.height * 0.35;

    // Never let the camera go under the snow.
    const ground = this.world.sampler.sampleHeight(_desired.x, _desired.z) + 0.9;
    if (_desired.y < ground) _desired.y = ground;

    if (!this.initialised) {
      this.smoothed.copy(_desired);
      this.smoothedLook.copy(_target);
      this.initialised = true;
    } else {
      // Position lags more than the look target, which reads as weight.
      const posLambda = s.mode === MODE.AIR ? 6 : 9;
      this.smoothed.x = THREE.MathUtils.damp(this.smoothed.x, _desired.x, posLambda, dt);
      this.smoothed.y = THREE.MathUtils.damp(this.smoothed.y, _desired.y, posLambda * 0.75, dt);
      this.smoothed.z = THREE.MathUtils.damp(this.smoothed.z, _desired.z, posLambda, dt);
      this.smoothedLook.lerp(_target, Math.min(1, 14 * dt));
    }

    this.camera.position.copy(this.smoothed);

    // Look slightly ahead of the skier, further ahead the faster they go.
    _look.copy(this.smoothedLook).addScaledVector(s.vel, 0.12 + fast * 0.16);
    this.camera.lookAt(_look);

    // Speed sells itself with field of view, not with blur.
    const targetFov = this.fovBase + fast * 13 + (s.telemetry.airborne ? 2 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.02) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 3.5, dt);
      this.camera.updateProjectionMatrix();
    }

    // A knock when you land or clip something.

    if (s.telemetry.thud > 0.01) {
      this.shake = Math.max(this.shake, s.telemetry.thud * 0.5);
      s.telemetry.thud = 0;
    }
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
      const k = this.shake * 0.28;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.position.z += (Math.random() - 0.5) * k;
    }
  }
}

// Riding up is the one time the camera is not chasing anybody: it hangs off the
// back of the chair so the whole slope is in front of you, which is the entire
// reason the ride is not a cutscene.
FollowCamera.prototype.updateLift = function updateLift(dt, input) {
  const s = this.skier;
  if (input) {
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, -0.5, 0.8);
  }
  this.yaw = THREE.MathUtils.damp(this.yaw, 0, 0.35, dt);
  const angle = s.heading + Math.PI + this.yaw;
  const dist = 5.6;
  // Sit off to one side: straight behind puts the haul rope down the middle of
  // the frame and turns the best view in the game into a picture of a cable.
  const side = 2.4;
  _desired.set(
    s.pos.x + Math.sin(angle) * dist + Math.cos(angle) * side,
    s.pos.y + 2.1 + this.pitch * 2.0,
    s.pos.z + Math.cos(angle) * dist - Math.sin(angle) * side,
  );
  if (!this.initialised) {
    this.smoothed.copy(_desired);
    this.initialised = true;
  } else {
    this.smoothed.x = THREE.MathUtils.damp(this.smoothed.x, _desired.x, 5, dt);
    this.smoothed.y = THREE.MathUtils.damp(this.smoothed.y, _desired.y, 5, dt);
    this.smoothed.z = THREE.MathUtils.damp(this.smoothed.z, _desired.z, 5, dt);
  }
  this.camera.position.copy(this.smoothed);
  _liftLook.set(s.pos.x, s.pos.y + 0.5, s.pos.z);
  this.camera.lookAt(_liftLook);
  if (Math.abs(this.camera.fov - this.fovBase) > 0.02) {
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.fovBase, 3, dt);
    this.camera.updateProjectionMatrix();
  }
};
