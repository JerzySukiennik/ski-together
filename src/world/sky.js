import * as THREE from 'three';

// Sky, sun, moon and the day cycle.
//
// Everything the world is lit by comes out of this one object: the terrain, the
// props and the characters all read their sun and ambient from here, so the
// mountain can never disagree with the sky above it.

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to the far plane
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;

uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunTint;
uniform float uSunIntensity;
uniform float uMoonIntensity;
uniform float uStars;
uniform float uHaze;
uniform float uTime;
uniform float uCloud;   // 0 = clear, 1 = overcast
uniform float uDetail;  // quality: 0 drops the second octave of cloud detail

varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += vnoise(p) * amp;
    p = p * 2.03 + vec2(37.1, 11.7);
    amp *= 0.5;
  }
  return sum;
}

/**
 * Clouds on a flat deck, seen in perspective.
 *
 * dir.xz / dir.y is where the view ray meets a horizontal plane, so a plain 2D
 * noise field on that coordinate is a cloud layer at a fixed altitude, with the
 * foreshortening towards the horizon for free. Two decks: high thin cirrus that
 * barely moves, and cumulus below it with more structure and more wind.
 *
 * The lighting is the cheap version of the real thing and it is the part that
 * matters: a second noise sample stepped TOWARDS THE SUN says how much cloud is
 * between this point and the light, so tops are bright, undersides are grey and
 * the sunward edge glows. Flat white blobs read as paper; this reads as cloud.
 */
vec4 cloudDeck(vec3 dir, float scale, float cover, float wind, float detail) {
  if (dir.y < 0.040) return vec4(0.0);
  // dir.xz / dir.y is where the ray meets a flat deck, which gives the
  // perspective for free — but it goes to infinity at the horizon. Clamping the
  // denominator freezes the pattern there instead, which drew a row of vertical
  // stripes along the whole horizon. The floor is loose, and the cloud is faded
  // out well before the stretch becomes visible: a deck seen edge-on really does
  // dissolve into haze, so the honest fix and the pretty one are the same.
  vec2 uv = dir.xz / max(dir.y, 0.030) * scale + vec2(uTime * wind, uTime * wind * 0.31);

  float n = fbm(uv);
  if (detail > 0.5) n = n * 0.72 + fbm(uv * 2.9 + 7.3) * 0.28;
  // A narrow band, so a cloud has an EDGE. Widen this and the sky turns into
  // even haze from horizon to zenith, which is what the first attempt did.
  float density = smoothstep(cover, cover + 0.13, n);
  if (density <= 0.002) return vec4(0.0);

  // How much cloud lies between here and the sun, one step along the sun's own
  // direction projected into the deck. Tops bright, undersides grey.
  vec2 towardsSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.55;
  float shade = smoothstep(cover, cover + 0.13, fbm(uv + towardsSun));
  float lit = 1.0 - 0.66 * shade;

  vec3 top = mix(vec3(0.93, 0.95, 0.99), uSunTint, 0.30) * (0.45 + 0.75 * uSunIntensity);
  vec3 base = mix(vec3(0.44, 0.48, 0.56), uZenith * 1.5, 0.40) * (0.40 + 0.55 * uSunIntensity);
  vec3 col = mix(base, top, lit);

  // Silver lining: the thin rim nearest the sun scatters forward, hard.
  float cosSun = max(dot(dir, uSunDir), 0.0);
  col += uSunTint * pow(cosSun, 16.0) * (1.0 - density) * 2.6 * uSunIntensity;

  // Clouds thin into the haze at the horizon rather than stopping at a line.
  float horizon = smoothstep(0.045, 0.23, dir.y);
  return vec4(col, density * horizon);
}

/**
 * Ridges beyond the edge of the world.
 *
 * The playable mountain is 1.5 km across and its flanks simply stop, which reads
 * as a diorama on a table. Three bands of noise along the horizon, each one
 * paler and lower than the last, put a range behind it for the price of a few
 * instructions — and because they are drawn in the sky they cost nothing to
 * move through.
 */
vec3 farRidges(vec3 dir, vec3 sky) {
  if (abs(dir.y) > 0.30) return sky;
  float az = atan(dir.z, dir.x);
  vec3 col = sky;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 2.4 + fi * 2.1;
    float height = 0.115 - fi * 0.028;
    float ridge = (fbm(vec2(az * scale + fi * 17.0, fi * 3.3)) - 0.5) * height + 0.028 - fi * 0.012;
    float mask = smoothstep(ridge + 0.004, ridge - 0.004, dir.y);
    // Further ranges are paler: that IS aerial perspective, and it is the only
    // depth cue available for something with no parallax.
    vec3 tint = mix(uHorizon * 1.06, uZenith * 0.72, 0.16 + fi * 0.22);
    col = mix(col, tint, mask * (0.86 - fi * 0.2));
  }
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = dir.y;

  // Sky body: zenith to horizon with a thicker, hazier band near the ground,
  // which is what actually sells altitude in a mountain scene.
  float t = pow(max(up, 0.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);

  // A range of hills beyond the world's edge, before anything in front of it.
  col = farRidges(dir, col);

  // Below the horizon the valley haze takes over.
  float below = smoothstep(0.0, -0.09, up);
  col = mix(col, uGround, below);

  // Mie halo around the sun, tight core plus a wide bloom.
  float cosSun = dot(dir, uSunDir);
  float halo = pow(max(cosSun, 0.0), 8.0) * 0.35 + pow(max(cosSun, 0.0), 900.0) * 6.0;
  col += uSunTint * halo * uSunIntensity * (0.35 + uHaze);

  // The disc itself.
  float disc = smoothstep(0.99965, 0.99985, cosSun);
  col += uSunTint * disc * 24.0 * uSunIntensity;

  // Moon: a small hard disc with a faint glow, and it never competes with the sun.
  float cosMoon = dot(dir, uMoonDir);
  float moonDisc = smoothstep(0.99955, 0.99975, cosMoon);
  col += vec3(0.85, 0.88, 1.0) * moonDisc * 5.0 * uMoonIntensity;
  col += vec3(0.35, 0.42, 0.6) * pow(max(cosMoon, 0.0), 260.0) * 0.5 * uMoonIntensity;

  // Stars, fading in only once the sky is genuinely dark.
  if (uStars > 0.01 && up > -0.02) {
    vec3 cell = floor(dir * 640.0);
    float s = hash13(cell);
    float star = smoothstep(0.9975, 0.99995, s);
    float twinkle = 0.75 + 0.25 * sin(s * 90.0);
    col += vec3(0.95, 0.96, 1.0) * star * twinkle * uStars * smoothstep(-0.02, 0.12, up);
  }

  // Cloud last, over everything including the sun: a cloud in front of the sun
  // is the whole reason the light on the mountain changes.
  if (uCloud > 0.01) {
    // Scales are in units of "noise cells across the sky": dir.xz/dir.y runs
    // from about 0.5 straight up to 10 at the horizon, so a scale near 1 gives
    // a handful of cloud masses overhead and a crowded band low down, which is
    // exactly how a cloud deck looks from underneath.
    // Two decks: thin cirrus high up that barely moves, cumulus below it with
    // structure and wind. Cover runs the threshold, so uCloud 0 really is a
    // cloudless day rather than a faint one.
    vec4 high = cloudDeck(dir, 0.42, 0.72 - uCloud * 0.26, 0.0018, 0.0);
    vec4 mid = cloudDeck(dir, 1.05, 0.68 - uCloud * 0.30, 0.0048, uDetail);
    col = mix(col, high.rgb, high.a * 0.42);
    col = mix(col, mid.rgb, mid.a * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// THREE.Color has no addScaledVector — it is not a Vector3, however much it looks
// like one. Mixing colours by hand costs three lines and never lies about it.
const addScaled = (out, other, k) => out.setRGB(
  out.r + other.r * k,
  out.g + other.g * k,
  out.b + other.b * k,
);

const lerpColour = (out, a, b, t) => out.setRGB(
  a.r + (b.r - a.r) * t,
  a.g + (b.g - a.g) * t,
  a.b + (b.b - a.b) * t,
);

// Key frames of the alpine day. Between them everything is interpolated, so the
// light never jumps — the whole point of a live cycle.
const KEYS = [
  { h: 0.0, zenith: 0x05070f, horizon: 0x0b1020, ground: 0x080a12, sun: 0x14203a, sunI: 0.02, fog: 0x0d1322, fogD: 0.00095, exposure: 1.45 },
  { h: 6.2, zenith: 0x18243f, horizon: 0x4a4058, ground: 0x1c2130, sun: 0x6b5a6e, sunI: 0.10, fog: 0x39364a, fogD: 0.00105, exposure: 1.30 },
  { h: 7.4, zenith: 0x2f5486, horizon: 0xd08a5c, ground: 0x4a4550, sun: 0xffb371, sunI: 0.85, fog: 0xb08a7e, fogD: 0.00105, exposure: 1.08 },
  { h: 9.0, zenith: 0x2b6ac0, horizon: 0xa8c6e4, ground: 0x74839a, sun: 0xfff0d8, sunI: 1.55, fog: 0xa9c2dd, fogD: 0.00080, exposure: 1.0 },
  { h: 12.5, zenith: 0x1f5fc4, horizon: 0xbcd6ee, ground: 0x8fa0b6, sun: 0xfffaf0, sunI: 1.95, fog: 0xbcd2e8, fogD: 0.00068, exposure: 0.95 },
  { h: 15.5, zenith: 0x2a68bd, horizon: 0xc0cfe2, ground: 0x8898ae, sun: 0xfff2dc, sunI: 1.62, fog: 0xb8cadf, fogD: 0.00076, exposure: 1.0 },
  { h: 17.0, zenith: 0x2c5c9e, horizon: 0xe0a06a, ground: 0x6d6a74, sun: 0xffc07a, sunI: 1.05, fog: 0xc99e84, fogD: 0.00092, exposure: 1.06 },
  { h: 18.1, zenith: 0x24345e, horizon: 0xd8724a, ground: 0x40414f, sun: 0xff8c50, sunI: 0.45, fog: 0x9c6a63, fogD: 0.00105, exposure: 1.18 },
  { h: 19.2, zenith: 0x111c36, horizon: 0x39335a, ground: 0x191c29, sun: 0x50466a, sunI: 0.08, fog: 0x2c2c42, fogD: 0.00110, exposure: 1.38 },
  { h: 24.0, zenith: 0x05070f, horizon: 0x0b1020, ground: 0x080a12, sun: 0x14203a, sunI: 0.02, fog: 0x0d1322, fogD: 0.00095, exposure: 1.45 },
];

const _nightTint = new THREE.Color(0.05, 0.07, 0.13);

export class Sky {
  constructor(scene, { hour = 10.5, speed = 1 / 90 } = {}) {
    this.hour = hour;
    // A full day in 24 real minutes: long enough that nobody watches it move,
    // short enough that an evening session actually sees the floodlights come on.
    this.speed = speed;
    this.paused = false;

    this.sunDir = new THREE.Vector3(0.4, 0.6, 0.5).normalize();
    this.moonDir = new THREE.Vector3().copy(this.sunDir).negate();
    this.sunColour = new THREE.Color(1, 1, 1);
    this.skyColour = new THREE.Color(0.3, 0.4, 0.6);
    this.groundColour = new THREE.Color(0.2, 0.22, 0.26);
    this.fogColour = new THREE.Color(0.7, 0.78, 0.88);
    this.fogDensity = 0.0008;
    this.exposure = 1;
    this.nightAmount = 0;
    // Not a bluebird day every day. This much cover is the alpine average and it
    // is what gives the light on the snow something to do.
    this.cloudCover = 0.42;

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uMoonDir: { value: this.moonDir },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunTint: { value: new THREE.Color() },
        uSunIntensity: { value: 1 },
        uMoonIntensity: { value: 0 },
        uStars: { value: 0 },
        uHaze: { value: 0.2 },
        uTime: { value: 0 },
        uCloud: { value: 0.85 },
        uDetail: { value: 1 },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -110;
    this.sun.shadow.camera.right = 110;
    this.sun.shadow.camera.top = 110;
    this.sun.shadow.camera.bottom = -110;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd2e8, 0x8fa0b6, 1.0);
    scene.add(this.hemi);

    this.apply();
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    this.apply();
  }

  /** Where the sun sits for a given hour. Alpine winter: low arc, southerly. */
  sunDirectionFor(hour) {
    const dayT = (hour - 6) / 12; // 0 at sunrise, 1 at sunset
    const elevation = Math.sin(dayT * Math.PI) * 0.62 - 0.06;
    const azimuth = -Math.PI * 0.5 + dayT * Math.PI * 1.06;
    const cosE = Math.cos(Math.asin(THREE.MathUtils.clamp(elevation, -1, 1)));
    return new THREE.Vector3(Math.sin(azimuth) * cosE, elevation, Math.cos(azimuth) * cosE).normalize();
  }

  apply() {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = THREE.MathUtils.clamp((h - a.h) / Math.max(b.h - a.h, 1e-3), 0, 1);
    const ease = t * t * (3 - 2 * t);

    const ca = new THREE.Color(), cb = new THREE.Color();
    const u = this.material.uniforms;
    lerpColour(u.uZenith.value, ca.setHex(a.zenith, THREE.SRGBColorSpace), cb.setHex(b.zenith, THREE.SRGBColorSpace), ease);
    lerpColour(u.uHorizon.value, ca.setHex(a.horizon, THREE.SRGBColorSpace), cb.setHex(b.horizon, THREE.SRGBColorSpace), ease);
    lerpColour(u.uGround.value, ca.setHex(a.ground, THREE.SRGBColorSpace), cb.setHex(b.ground, THREE.SRGBColorSpace), ease);
    lerpColour(u.uSunTint.value, ca.setHex(a.sun, THREE.SRGBColorSpace), cb.setHex(b.sun, THREE.SRGBColorSpace), ease);
    let sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, ease);
    u.uSunIntensity.value = sunI;

    // Cloud has to do something to the light or it is wallpaper. Cover takes the
    // edge off the sun and gives it back as ambient — the flat, shadowless light
    // of an overcast day, which is also the light in which a piste is hardest to
    // read. The sky's own disc keeps its full brightness: you can still see where
    // the sun is through thin cloud, and that is what it looks like.
    const overcast = this.cloudCover * 0.55;
    sunI *= 1 - overcast * 0.62;

    this.sunDir.copy(this.sunDirectionFor(h));
    this.moonDir.copy(this.sunDirectionFor((h + 12) % 24));
    this.nightAmount = THREE.MathUtils.clamp(1 - sunI / 0.55, 0, 1);
    u.uStars.value = Math.pow(this.nightAmount, 2.2);
    u.uMoonIntensity.value = this.nightAmount;
    u.uHaze.value = 0.15 + 0.35 * (1 - this.nightAmount);

    this.sunColour.copy(u.uSunTint.value).multiplyScalar(sunI);
    lerpColour(this.fogColour, ca.setHex(a.fog, THREE.SRGBColorSpace), cb.setHex(b.fog, THREE.SRGBColorSpace), ease);
    this.fogDensity = THREE.MathUtils.lerp(a.fogD, b.fogD, ease);
    this.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, ease);

    // Ambient: the sky above plus a strong bounce off the snow below. Getting the
    // bounce wrong is the classic reason CG snow looks like plaster.
    // At dusk the horizon is orange but the light on the snow is not: the sky
    // dome above it has gone blue. Weighting the ambient towards the zenith as
    // the sun drops keeps evening looking cold instead of pink.
    const lowSun = 1 - THREE.MathUtils.clamp(sunI / 1.2, 0, 1);
    const zenithWeight = 0.55 + lowSun * 0.34;
    addScaled(
      this.skyColour.copy(u.uZenith.value).multiplyScalar(zenithWeight),
      u.uHorizon.value, 1 - zenithWeight,
    );
    addScaled(this.groundColour.copy(u.uHorizon.value).multiplyScalar(0.30 - lowSun * 0.12), this.sunColour, 0.16);
    if (this.nightAmount > 0) {
      addScaled(this.skyColour, _nightTint, this.nightAmount);
    }

    this.sun.color.copy(u.uSunTint.value);
    this.sun.intensity = sunI;
    this.sun.visible = sunI > 0.03;
    this.hemi.color.copy(this.skyColour);
    this.hemi.groundColor.copy(this.groundColour);
    this.hemi.intensity = (0.85 + 0.5 * (1 - this.nightAmount)) * (1 + overcast * 0.45);
  }

  /** Quality hook: at the lowest setting the second octave of cloud goes. */
  setQuality(q) {
    this.material.uniforms.uDetail.value = q.sky >= 2 ? 1 : 0;
    this.material.uniforms.uCloud.value = q.sky >= 1 ? this.cloudCover : 0;
  }

  /** 0 is a bluebird day, 1 is overcast. */
  setCloudCover(v) {
    this.cloudCover = THREE.MathUtils.clamp(v, 0, 1);
    this.material.uniforms.uCloud.value = this.cloudCover;
    this.apply(); // cover changes the light, not only the picture
  }

  update(dt, elapsed, cameraPos) {
    this.material.uniforms.uTime.value = elapsed;
    if (!this.paused) {
      this.hour = (this.hour + dt * this.speed * (24 / 60)) % 24;
      this.apply();
    }
    if (cameraPos) {
      this.mesh.position.copy(cameraPos);
      this.mesh.scale.setScalar(1);
      // Keep the shadow frustum tight around the player rather than the mountain.
      this.sun.target.position.copy(cameraPos);
      this.sun.position.copy(cameraPos).addScaledVector(this.sunDir, 220);
      this.sun.target.updateMatrixWorld();
    }
  }
}
