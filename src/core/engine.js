import * as THREE from 'three';

// Renderer, frame loop and the quality governor.
// The governor exists because the target machines run from a GTX 1650 Ti upward
// but the host may be anything: measure the frame, then spend or refund detail.

export const QUALITY_LEVELS = [
  { name: 'Minimum', pixelRatio: 0.7, shadow: 0, shadowSize: 1024, viewDistance: 700, trees: 0.35, snowDetail: 0, sky: 0 },
  { name: 'Low', pixelRatio: 0.85, shadow: 1, shadowSize: 1024, viewDistance: 900, trees: 0.55, snowDetail: 1, sky: 1 },
  { name: 'Medium', pixelRatio: 1.0, shadow: 1, shadowSize: 2048, viewDistance: 1200, trees: 0.75, snowDetail: 1, sky: 1 },
  { name: 'High', pixelRatio: 1.0, shadow: 2, shadowSize: 3072, viewDistance: 1600, trees: 1.0, snowDetail: 2, sky: 2 },
  { name: 'Ultra', pixelRatio: 1.25, shadow: 2, shadowSize: 4096, viewDistance: 2200, trees: 1.25, snowDetail: 2, sky: 2 },
];

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.15, 6000);

    this.clock = new THREE.Clock();
    this.updaters = [];
    this.running = false;

    this.qualityIndex = 3;
    this.autoQuality = true;
    this.frameSamples = [];
    this.lastGovern = 0;
    this.stats = { fps: 0, frameMs: 0, drawCalls: 0, tris: 0 };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  get quality() {
    return QUALITY_LEVELS[this.qualityIndex];
  }

  setQuality(index, { manual = false } = {}) {
    const next = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, index));
    if (next === this.qualityIndex) return;
    this.qualityIndex = next;
    if (manual) this.autoQuality = false;
    this.resize();
    this.onQualityChange?.(this.quality, next);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.far = this.quality.viewDistance * 2.6;
    this.camera.updateProjectionMatrix();
  }

  add(updater) {
    this.updaters.push(updater);
    return updater;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(tick);
      this.frame();
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  frame() {
    const t0 = performance.now();
    // A tab that was in the background hands back an enormous delta; clamp it or
    // every physics step in the game explodes on the first frame after refocus.
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    for (const u of this.updaters) u.update?.(dt, elapsed);

    this.renderer.render(this.scene, this.camera);

    const ms = performance.now() - t0;
    this.stats.frameMs = ms;
    this.frameSamples.push(ms);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    this.stats.fps = 1 / Math.max(dt, 1e-4);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;

    if (this.autoQuality && elapsed - this.lastGovern > 3 && this.frameSamples.length >= 60) {
      this.lastGovern = elapsed;
      const sorted = [...this.frameSamples].sort((a, b) => a - b);
      const p80 = sorted[Math.floor(sorted.length * 0.8)];
      // 16.7 ms is 60 fps; leave headroom for the physics and the network.
      if (p80 > 19 && this.qualityIndex > 0) this.setQuality(this.qualityIndex - 1);
      else if (p80 < 9.5 && this.qualityIndex < QUALITY_LEVELS.length - 1) this.setQuality(this.qualityIndex + 1);
      this.frameSamples.length = 0;
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
