import * as THREE from 'three';
import { HRES, CELL, HALF, WORLD, BASE_ELEV } from '../shared/terrain.js';
import { SNOW_W, SNOW_H, SNOW_CELL, SNOW_X0, SNOW_Z0, CARVE_MAX } from '../shared/snowfield.js';

// The mountain on screen.
//
// Geometry is a camera-centred clipmap: seven concentric rings, each with cells
// twice the size of the one inside it, from 0.5 m under your skis out to 32 m at
// the horizon. ~100k triangles cover 3 km of mountain.
//
// Height comes from a texture, so the same field the physics reads is the field
// the vertices sit on. The snow's rut depth is subtracted in the vertex shader:
// the groove you see is the groove you feel.

const BASE_QUADS = 96; // quads per side of the finest block
const BASE_CELL = 0.5; // metres — the same size as one snow cell
const LEVELS = 7;

const DOWN = new THREE.Vector3(0, -1, 0);

const H_MIN = BASE_ELEV - 60;
const H_RANGE = 560;

function buildClipmapGeometry() {
  const positions = [];
  const cellAttr = [];
  const morphAttr = [];
  const indices = [];

  const pushGrid = (cell, quadsPerSide, holeQuads, level) => {
    const half = (quadsPerSide * cell) / 2;
    const cols = quadsPerSide + 1;
    const start = positions.length / 3;
    const outerBand = quadsPerSide * 0.5 - 1.5; // morph over the outermost cells
    for (let j = 0; j <= quadsPerSide; j++) {
      for (let i = 0; i <= quadsPerSide; i++) {
        const x = -half + i * cell;
        const z = -half + j * cell;
        positions.push(x, 0, z);
        cellAttr.push(cell);
        // Distance from the centre in cells, using the Chebyshev metric so the
        // band follows the square ring rather than a circle.
        const d = Math.max(Math.abs(i - quadsPerSide / 2), Math.abs(j - quadsPerSide / 2));
        const m = level === LEVELS - 1 ? 0 : THREE.MathUtils.clamp((d - outerBand) / 1.5, 0, 1);
        morphAttr.push(m);
      }
    }
    const hole = holeQuads / 2;
    const mid = quadsPerSide / 2;
    for (let j = 0; j < quadsPerSide; j++) {
      for (let i = 0; i < quadsPerSide; i++) {
        if (holeQuads > 0) {
          const inX = i >= mid - hole && i < mid + hole;
          const inZ = j >= mid - hole && j < mid + hole;
          if (inX && inZ) continue;
        }
        const a = start + j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  };

  for (let level = 0; level < LEVELS; level++) {
    const cell = BASE_CELL * Math.pow(2, level);
    pushGrid(cell, BASE_QUADS, level === 0 ? 0 : BASE_QUADS / 2, level);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aCell', new THREE.Float32BufferAttribute(cellAttr, 1));
  geo.setAttribute('aMorph', new THREE.Float32BufferAttribute(morphAttr, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BASE_CELL * Math.pow(2, LEVELS - 1) * BASE_QUADS);
  return geo;
}

// --------------------------------------------------------------- textures

// RGB carries 24-bit height; the spare alpha byte carries the piste mask, which
// the shader needs anyway and which would otherwise cost a whole extra texture.
function packHeightTexture(height, piste) {
  const data = new Uint8Array(HRES * HRES * 4);
  for (let i = 0; i < height.length; i++) {
    const t = THREE.MathUtils.clamp((height[i] - H_MIN) / H_RANGE, 0, 0.99999);
    const v = Math.floor(t * 16777215);
    data[i * 4] = (v >> 16) & 255;
    data[i * 4 + 1] = (v >> 8) & 255;
    data[i * 4 + 2] = v & 255;
    data[i * 4 + 3] = piste[i] ? 255 : 0;
  }
  const tex = new THREE.DataTexture(data, HRES, HRES, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function buildNormalTexture(height) {
  const data = new Uint8Array(HRES * HRES * 4);
  for (let j = 0; j < HRES; j++) {
    for (let i = 0; i < HRES; i++) {
      const l = height[j * HRES + Math.max(0, i - 1)];
      const r = height[j * HRES + Math.min(HRES - 1, i + 1)];
      const d = height[Math.max(0, j - 1) * HRES + i];
      const u = height[Math.min(HRES - 1, j + 1) * HRES + i];
      let nx = l - r, ny = 2 * CELL, nz = d - u;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const k = (j * HRES + i) * 4;
      data[k] = Math.round((nx * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, HRES, HRES, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeSnowChannelTexture(array) {
  const tex = new THREE.DataTexture(array, SNOW_W, SNOW_H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.internalFormat = 'R8';
  tex.needsUpdate = true;
  return tex;
}

/**
 * Uploads only the rectangle of snow that changed. A full 5.2 M cell texture is
 * 5 MB per channel; pushing that every frame would cost more than the rest of
 * the game put together.
 */
export class SnowTextureBridge {
  constructor(renderer, snow) {
    this.renderer = renderer;
    this.snow = snow;
    this.condTex = makeSnowChannelTexture(snow.cond);
    this.carveTex = makeSnowChannelTexture(snow.carve);
    renderer.initTexture(this.condTex);
    renderer.initTexture(this.carveTex);
    this.ready = true;
  }

  flush() {
    const rect = this.snow.takeDirty();
    if (!rect) return 0;
    const { i0, j0, i1, j1 } = rect;
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    if (w <= 0 || h <= 0) return 0;
    const gl = this.renderer.getContext();
    const upload = (tex, array) => {
      const props = this.renderer.properties.get(tex);
      if (!props.__webglTexture) {
        this.renderer.initTexture(tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, SNOW_W);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, i0, j0, w, h, gl.RED, gl.UNSIGNED_BYTE, array, j0 * SNOW_W + i0);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    };
    upload(this.condTex, this.snow.cond);
    upload(this.carveTex, this.snow.carve);
    this.renderer.resetState();
    return w * h;
  }
}

// --------------------------------------------------------------- shaders

const VERT = /* glsl */`
precision highp float;

attribute float aCell;
attribute float aMorph;

uniform sampler2D uHeight;
uniform sampler2D uCarve;
uniform vec2 uCentre;
uniform float uWorld;
uniform float uHalf;
uniform float uHRes;
uniform float uHMin;
uniform float uHRange;
uniform vec2 uSnowOrigin;
uniform vec2 uSnowSize;
uniform float uCarveMax;

varying vec3 vWorld;
varying vec2 vSnowUv;
varying float vSnowMask;
varying float vDist;

float decodeHeight(vec4 c) {
  return uHMin + (c.r * 65536.0 + c.g * 256.0 + c.b) * (255.0 / 16777215.0) * uHRange;
}

float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1, 0)), u.x), mix(fhash(i + vec2(0, 1)), fhash(i + vec2(1, 1)), u.x), u.y);
}

// The map stops at 768 m but the eye does not. Beyond the edge the ground turns
// into ridged peaks so the valley reads as a valley instead of a white table.
float farField(vec2 world, float edgeHeight) {
  float d = max(abs(world.x), abs(world.y));
  float t = smoothstep(620.0, 1050.0, d);
  if (t <= 0.0) return 0.0;
  float r = 0.0, amp = 1.0;
  vec2 q = world / 620.0;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(fnoise(q) * 2.0 - 1.0);
    r += n * n * amp;
    amp *= 0.46;
    q *= 2.07;
  }
  return t * (r * 300.0 - 90.0) * smoothstep(0.0, 1.0, t);
}

// Bilinear by hand: the height texture is 24-bit packed, so hardware filtering
// would blend the bytes instead of the numbers and produce garbage cliffs.
float sampleHeight(vec2 world) {
  vec2 f = (world + uHalf) / uWorld * uHRes - 0.5;
  vec2 base = floor(f);
  vec2 frac = f - base;
  vec2 texel = 1.0 / vec2(uHRes);
  vec2 uv = (base + 0.5) * texel;
  float h00 = decodeHeight(texture2D(uHeight, uv));
  float h10 = decodeHeight(texture2D(uHeight, uv + vec2(texel.x, 0.0)));
  float h01 = decodeHeight(texture2D(uHeight, uv + vec2(0.0, texel.y)));
  float h11 = decodeHeight(texture2D(uHeight, uv + texel));
  return mix(mix(h00, h10, frac.x), mix(h01, h11, frac.x), frac.y);
}

void main() {
  vec2 world = position.xz + uCentre;

  // Clipmap stitch: vertices on the outer edge of a ring snap onto the coarser
  // ring's grid, so the two levels share the exact same edge and never crack.
  vec2 coarse = floor(world / (aCell * 2.0) + 0.5) * (aCell * 2.0);
  world = mix(world, coarse, aMorph);

  float h = sampleHeight(world);
  h += farField(world, h);

  vec2 snowUv = (world - uSnowOrigin) / uSnowSize;
  float inside = step(0.0, snowUv.x) * step(snowUv.x, 1.0) * step(0.0, snowUv.y) * step(snowUv.y, 1.0);
  float carve = texture2D(uCarve, clamp(snowUv, 0.0, 1.0)).r * inside;
  h -= carve * uCarveMax;

  vSnowUv = snowUv;
  vSnowMask = inside;
  vWorld = vec3(world.x, h, world.y);
  vec4 mv = modelViewMatrix * vec4(vWorld, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uHeight;
uniform sampler2D uNormal;
uniform sampler2D uCond;
uniform sampler2D uCarve;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform vec3 uSkyColour;
uniform vec3 uGroundColour;
uniform vec3 uFogColour;
uniform float uFogDensity;
uniform float uWorld;
uniform float uHalf;
uniform vec2 uSnowSize;
uniform float uCarveMax;
uniform float uDetail;
uniform float uTime;

// A custom shader gets no scene lights for free, so the lamps that matter at
// night — the piste floodlights, the bonfire, the groomer's headlights — are
// passed in by hand. Without this the evening is a mountain full of lamps that
// light nothing.
#define MAX_LAMPS 8
uniform int uLampCount;
uniform vec3 uLampPos[MAX_LAMPS];
uniform vec3 uLampColour[MAX_LAMPS];
uniform vec3 uLampDir[MAX_LAMPS];
uniform vec3 uLampParams[MAX_LAMPS]; // range, cos(outer), cos(inner)

varying vec3 vWorld;
varying vec2 vSnowUv;
varying float vSnowMask;
varying float vDist;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 ggx(vec3 N, vec3 V, vec3 L, float rough, vec3 F0) {
  vec3 H = normalize(V + L);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float NdH = max(dot(N, H), 0.0);
  float NdV = max(dot(N, V), 1e-4);
  float NdL = max(dot(N, L), 0.0);
  float VdH = max(dot(V, H), 0.0);
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * d * d);
  float k = a * 0.5;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  return D * G * F / (4.0 * NdV * max(NdL, 1e-4)) * NdL;
}

void main() {
  vec2 tuv = (vWorld.xz + uHalf) / uWorld;
  vec3 baseN = normalize(texture2D(uNormal, tuv).rgb * 2.0 - 1.0);

  // Is this cell a piste? Four taps of the height texture's alpha, so the edge of
  // the run softens instead of stepping.
  float texel = 1.5 / uWorld;
  float pisteMask = (
      texture2D(uHeight, tuv + vec2( texel,  texel)).a
    + texture2D(uHeight, tuv + vec2(-texel,  texel)).a
    + texture2D(uHeight, tuv + vec2( texel, -texel)).a
    + texture2D(uHeight, tuv + vec2(-texel, -texel)).a) * 0.25;

  float cond = mix(0.78, texture2D(uCond, clamp(vSnowUv, 0.0, 1.0)).r, vSnowMask);
  float carve = texture2D(uCarve, clamp(vSnowUv, 0.0, 1.0)).r * vSnowMask;

  // The rut's own shape, from the gradient of the carve field. This is what makes
  // a track read as a groove rather than a stain.
  vec2 px = 1.0 / uSnowSize;
  float cl = texture2D(uCarve, clamp(vSnowUv - vec2(px.x, 0.0), 0.0, 1.0)).r;
  float cr = texture2D(uCarve, clamp(vSnowUv + vec2(px.x, 0.0), 0.0, 1.0)).r;
  float cd = texture2D(uCarve, clamp(vSnowUv - vec2(0.0, px.y), 0.0, 1.0)).r;
  float cu = texture2D(uCarve, clamp(vSnowUv + vec2(0.0, px.y), 0.0, 1.0)).r;
  // Two snow cells apart is 1 m of ground, so the height difference across the
  // tap IS the slope — no extra scaling needed.
  vec3 carveN = normalize(vec3((cl - cr) * uCarveMax, 1.0, (cd - cu) * uCarveMax));

  vec3 N = normalize(baseN + vec3(carveN.x, 0.0, carveN.z) * 2.2 * vSnowMask);

  // Corduroy. A groomer drives up and down the fall line and its tiller leaves
  // ridges across it, so the grooves are lines of constant altitude. Taking the
  // direction from the per-pixel normal produces swirling moire; taking it from a
  // gradient averaged over 20 m produces the straight bands you actually see.
  vec3 wideN = normalize(
      texture2D(uNormal, tuv + vec2( 10.0 / uWorld, 0.0)).rgb
    + texture2D(uNormal, tuv + vec2(-10.0 / uWorld, 0.0)).rgb
    + texture2D(uNormal, tuv + vec2(0.0,  10.0 / uWorld)).rgb
    + texture2D(uNormal, tuv + vec2(0.0, -10.0 / uWorld)).rgb - 4.0 * 0.5);
  vec2 fall = vec2(wideN.x, wideN.z);
  float fallLen = length(fall);
  fall = fallLen > 0.02 ? fall / fallLen : vec2(0.0, 1.0);
  float groom = sin(dot(vWorld.xz, fall) * 7.4);
  float crisp = smoothstep(0.72, 0.995, cond) * (1.0 - smoothstep(0.0, 0.3, carve)) * pisteMask;
  N = normalize(N + vec3(fall.x, 0.0, fall.y) * groom * 0.10 * crisp * uDetail);

  // Wind-blown micro relief everywhere, finer close up.
  if (uDetail > 0.5) {
    float m1 = vnoise(vWorld.xz * 2.6) - 0.5;
    float m2 = vnoise(vWorld.xz * 11.0) - 0.5;
    float near = 1.0 - smoothstep(20.0, 140.0, vDist);
    N = normalize(N + vec3(m1 * 0.10 + m2 * 0.06 * near, 0.0, m2 * 0.09 * near - m1 * 0.05));
  }

  // ---- material by condition
  vec3 snowAlbedo = vec3(0.90, 0.925, 0.965);
  vec3 iceAlbedo = vec3(0.60, 0.70, 0.80);
  vec3 rockAlbedo = vec3(0.20, 0.19, 0.18);

  float ice = (1.0 - smoothstep(0.06, 0.42, cond)) * pisteMask;
  float bare = (1.0 - smoothstep(0.0, 0.13, cond)) * pisteMask;
  float powder = 1.0 - pisteMask;

  vec3 albedo = mix(snowAlbedo, iceAlbedo, ice * 0.75);
  float rockPatch = smoothstep(0.45, 0.72, vnoise(vWorld.xz * 0.55));
  albedo = mix(albedo, rockAlbedo, bare * rockPatch);

  float rough = mix(0.62, 0.13, ice);
  rough = mix(rough, 0.88, powder);
  rough = mix(rough, rough * 0.6, smoothstep(0.15, 0.6, carve)); // polished rut walls

  // ---- lighting
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);

  // Snow is translucent: light enters, scatters and leaves. Without wrapping the
  // diffuse term, snow renders as white plastic — this single line is most of the
  // difference between "snow" and "a white surface".
  float wrap = 0.42;
  float ndl = (dot(N, L) + wrap) / (1.0 + wrap);
  ndl = max(ndl, 0.0);

  float ao = 1.0 - carve * 0.35;
  float sky = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = mix(uGroundColour, uSkyColour, sky) * ao;
  // Snow bounces most of what hits it, so the ambient term carries real weight.
  ambient *= 1.32;

  vec3 diffuse = albedo * (uSunColour * ndl + ambient);

  vec3 F0 = mix(vec3(0.028), vec3(0.045), ice);
  vec3 spec = ggx(N, V, L, rough, F0) * uSunColour;

  // Forward scattering: looking towards the sun across snow it glows.
  float fwd = pow(max(dot(-V, L), 0.0), 6.0);
  vec3 scatter = albedo * uSunColour * fwd * 0.30 * (1.0 - ice);

  // Sparkle: individual crystals catching the sun. Only near, only on fresh snow.
  float sparkle = 0.0;
  if (uDetail > 0.5) {
    float sp = vnoise(vWorld.xz * 340.0 + floor(uTime * 3.0) * 0.0);
    sp = pow(max(sp, 0.0), 34.0);
    float align = pow(max(dot(reflect(-L, N), V), 0.0), 40.0);
    sparkle = sp * align * 26.0 * smoothstep(0.5, 0.95, cond) * (1.0 - smoothstep(6.0, 55.0, vDist));
  }

  vec3 lampSum = vec3(0.0);
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 toLamp = uLampPos[i] - vWorld;
    float dist = length(toLamp);
    float range = uLampParams[i].x;
    if (dist > range) continue;
    vec3 L2 = toLamp / max(dist, 1e-4);
    float atten = 1.0 - dist / range;
    atten *= atten;
    float cone = 1.0;
    if (uLampParams[i].y > -0.999) {
      float cd = dot(-L2, uLampDir[i]);
      cone = smoothstep(uLampParams[i].y, uLampParams[i].z, cd);
    }
    // Snow scatters, so a lamp lights it even where the surface faces away.
    float ndl2 = max(dot(N, L2) * 0.72 + 0.28, 0.0);
    lampSum += uLampColour[i] * ndl2 * atten * cone;
  }

  vec3 colour = diffuse + spec + scatter + uSunColour * sparkle + albedo * lampSum;

  // Aerial perspective: distance loses contrast into the valley haze.
  float fog = 1.0 - exp(-pow(vDist * uFogDensity, 1.7));
  colour = mix(colour, uFogColour, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(colour, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// --------------------------------------------------------------- mesh

export class TerrainMesh {
  constructor(renderer, terrain, snow) {
    this.terrain = terrain;
    this.snow = snow;
    this.bridge = new SnowTextureBridge(renderer, snow);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uHeight: { value: packHeightTexture(terrain.height, terrain.piste) },
        uNormal: { value: buildNormalTexture(terrain.height) },
        uCond: { value: this.bridge.condTex },
        uCarve: { value: this.bridge.carveTex },
        uCentre: { value: new THREE.Vector2() },
        uWorld: { value: WORLD },
        uHalf: { value: HALF },
        uHRes: { value: HRES },
        uHMin: { value: H_MIN },
        uHRange: { value: H_RANGE },
        uSnowOrigin: { value: new THREE.Vector2(SNOW_X0, SNOW_Z0) },
        uSnowSize: { value: new THREE.Vector2(SNOW_W * SNOW_CELL, SNOW_H * SNOW_CELL) },
        uCarveMax: { value: CARVE_MAX },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.5) },
        uSunColour: { value: new THREE.Color(1.0, 0.96, 0.88) },
        uSkyColour: { value: new THREE.Color(0.32, 0.44, 0.62) },
        uGroundColour: { value: new THREE.Color(0.20, 0.24, 0.30) },
        uFogColour: { value: new THREE.Color(0.66, 0.74, 0.84) },
        uFogDensity: { value: 0.00075 },
        uDetail: { value: 1 },
        uTime: { value: 0 },
        uLampCount: { value: 0 },
        uLampPos: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
        uLampColour: { value: Array.from({ length: 8 }, () => new THREE.Color(0, 0, 0)) },
        uLampDir: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -1, 0)) },
        uLampParams: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, -1, -1)) },
      },
    });

    this.mesh = new THREE.Mesh(buildClipmapGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 0;
    this.mesh.name = 'mountain';
  }

  setQuality(q) {
    this.material.uniforms.uDetail.value = q.snowDetail;
  }

  /**
   * Hand the shader the eight lamps nearest the camera. Eight is plenty: past
   * that they overlap into a wash nobody can pick apart anyway.
   */
  setLamps(lamps, cameraPos) {
    const u = this.material.uniforms;
    const sorted = lamps
      .filter((l) => l.intensity > 0.01)
      .map((l) => ({ l, d: l.position.distanceToSquared(cameraPos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    for (let i = 0; i < sorted.length; i++) {
      const l = sorted[i].l;
      u.uLampPos.value[i].copy(l.position);
      u.uLampColour.value[i].copy(l.colour).multiplyScalar(l.intensity);
      u.uLampDir.value[i].copy(l.direction || DOWN);
      u.uLampParams.value[i].set(l.range, l.cosOuter ?? -1, l.cosInner ?? -1);
    }
    u.uLampCount.value = sorted.length;
  }

  setSun(dir, colour, sky, ground, fogColour, fogDensity) {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(dir);
    u.uSunColour.value.copy(colour);
    u.uSkyColour.value.copy(sky);
    u.uGroundColour.value.copy(ground);
    u.uFogColour.value.copy(fogColour);
    u.uFogDensity.value = fogDensity;
  }

  update(dt, elapsed, cameraPos) {
    // Snap to the finest cell so the grid never swims under the skis.
    const u = this.material.uniforms;
    u.uCentre.value.set(
      Math.round(cameraPos.x / BASE_CELL) * BASE_CELL,
      Math.round(cameraPos.z / BASE_CELL) * BASE_CELL,
    );
    u.uTime.value = elapsed;
    this.bridge.flush();
  }
}

export const clipmapInfo = { BASE_QUADS, BASE_CELL, LEVELS, reach: BASE_CELL * Math.pow(2, LEVELS - 1) * BASE_QUADS / 2 };
