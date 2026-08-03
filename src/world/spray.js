import * as THREE from 'three';

// Snow thrown off the edge.
//
// One buffer of 900 particles recycled forever, so hard carving costs nothing but
// the fill rate. Colour and lifetime come from what the ski is doing: a clean
// carve throws a thin ribbon, a skid throws a wall, powder throws a cloud.

const COUNT = 900;

const VERT = /* glsl */`
attribute float aSize;
attribute float aLife;
attribute float aSeed;
uniform float uPixel;
varying float vLife;
varying float vSeed;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixel / max(-mv.z, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uColour;
varying float vLife;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  // soft edged puff, fading as it ages
  float a = (1.0 - r * 4.0) * vLife;
  a *= 0.55 + 0.45 * fract(vSeed * 13.37);
  gl_FragColor = vec4(uColour, a * 0.75);
}
`;

export class SnowSpray {
  constructor(scene) {
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    this.sizes = new Float32Array(COUNT);
    this.lives = new Float32Array(COUNT);
    this.maxLives = new Float32Array(COUNT);
    this.seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.positions[i * 3 + 1] = -9999;
      this.seeds[i] = Math.random();
    }
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColour: { value: new THREE.Color(0.96, 0.975, 1.0) },
        uPixel: { value: 340 },
      },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
    this.accumulator = 0;
  }

  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % COUNT;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx;
    this.velocities[i * 3 + 1] = vy;
    this.velocities[i * 3 + 2] = vz;
    this.sizes[i] = size;
    this.lives[i] = 1;
    this.maxLives[i] = life;
  }

  update(dt, skier) {
    const t = skier.telemetry;
    const spray = t.spray || 0;

    if (spray > 0.02 && t.speed > 1.5 && !t.airborne) {
      // Rate follows how hard the edge is working, so a straight glide is silent
      // and a hockey stop throws a wall of snow.
      this.accumulator += spray * t.speed * dt * 26;
      const n = Math.min(28, Math.floor(this.accumulator));
      this.accumulator -= n;
      const h = skier.heading;
      const fx = Math.sin(h), fz = Math.cos(h);
      const rx = fz, rz = -fx; // to the skier's right
      const side = -Math.sign(skier.edge || 0.001);
      for (let k = 0; k < n; k++) {
        const jitter = (Math.random() - 0.5);
        const back = 0.2 + Math.random() * 0.7;
        const up = 1.2 + Math.random() * 2.6 * spray;
        const out = (0.8 + Math.random() * 2.4) * spray;
        this.emit(
          skier.pos.x - fx * back + rx * jitter * 0.5,
          skier.pos.y + 0.06 + Math.random() * 0.12,
          skier.pos.z - fz * back + rz * jitter * 0.5,
          -fx * t.speed * 0.16 + rx * side * out + (Math.random() - 0.5) * 1.2,
          up,
          -fz * t.speed * 0.16 + rz * side * out + (Math.random() - 0.5) * 1.2,
          t.surface === 'powder' ? 130 : 78,
          0.45 + Math.random() * (t.surface === 'powder' ? 0.9 : 0.35),
        );
      }
    }

    const G = 9.4;
    for (let i = 0; i < COUNT; i++) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt / this.maxLives[i];
      if (this.lives[i] <= 0) {
        this.lives[i] = 0;
        this.positions[i * 3 + 1] = -9999;
        continue;
      }
      this.velocities[i * 3 + 1] -= G * dt;
      this.velocities[i * 3] *= 0.965;
      this.velocities[i * 3 + 2] *= 0.965;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
