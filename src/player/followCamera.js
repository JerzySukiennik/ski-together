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
    // On foot the camera has to be anchored to the WORLD, not to the body: the
    // body turns to face wherever you are walking, so a camera that rode on the
    // heading would rotate the controls that are rotating it, and the pair would
    // spiral. Riding keeps the relative yaw, because there the body IS the frame.
    this.walkYaw = 0;
    this.wasWalking = false;
    this.worldYaw = 0;
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
    this.trees = null;        // set by the game once the forest exists
    this.nearTrees = [];
    this.treeCheck = 0;
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

    // Hand the two frames over to each other on the way in and out, so putting the
    // skis on never snaps the view somewhere you did not point it.
    const walking = s.mode === MODE.WALK || s.mode === MODE.CRASH;
    if (walking && !this.wasWalking) this.walkYaw = s.heading + this.yaw;
    else if (!walking && this.wasWalking) this.yaw = this.walkYaw - s.heading;
    this.wasWalking = walking;

    if (input) {
      this.yaw -= input.lookX;
      this.walkYaw -= input.lookX;
      // Pushing the mouse away tips the view up, the way it does everywhere else.
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY, -0.55, 0.95);
      if (input.zoom) this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + input.zoom * 0.8, 2.4, 14);
    }
    // The camera stays exactly where you put it. It used to drift back behind the
    // skier on its own, which reads as the camera fighting you.

    const speed = s.telemetry.speed;
    const fast = THREE.MathUtils.clamp(speed / 24, 0, 1);
    const dist = this.targetDistance + fast * 2.6;
    this.distance = THREE.MathUtils.damp(this.distance, dist, 4, dt);

    const angle = walking ? this.walkYaw : s.heading + this.yaw;
    this.worldYaw = angle;
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

    // Nor inside a spruce. Trees are instanced, so there is nothing to raycast
    // against — but the scatter list is right here, and pulling the camera in
    // until it is clear costs a handful of distance checks.
    this.avoidTrees(_target, _desired);

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
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY, -0.5, 0.8);
  }
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

/**
 * Keep the camera out of the trees. Refresh the candidate list occasionally —
 * a spruce does not move — then, every frame, walk the camera back towards the
 * skier until nothing is inside it.
 */
FollowCamera.prototype.avoidTrees = function avoidTrees(target, desired) {
  if (!this.trees || !this.trees.length) return;
  this.treeCheck -= 1;
  if (this.treeCheck <= 0) {
    this.treeCheck = 30;
    this.nearTrees.length = 0;
    for (const t of this.trees) {
      const dx = t.x - target.x, dz = t.z - target.z;
      if (dx * dx + dz * dz < 40 * 40) this.nearTrees.push(t);
    }
  }
  if (!this.nearTrees.length) return;

  for (let pass = 0; pass < 6; pass++) {
    let worst = 0;
    for (const t of this.nearTrees) {
      // Only the trunk and the lower skirt matter; the camera sits low.
      const radius = 1.5 * t.scale;
      const dx = desired.x - t.x, dz = desired.z - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      const d = Math.sqrt(d2) || 0.001;
      worst = Math.max(worst, radius - d);
    }
    if (worst <= 0.001) break;
    // Pull straight back towards the skier — never sideways, which would swing
    // the shot around and read as the camera panicking.
    desired.lerp(target, Math.min(0.4, worst * 0.35 + 0.08));
  }
};
