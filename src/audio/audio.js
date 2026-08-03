// Sound.
//
// Two kinds, and the split is deliberate. Anything that has to REACT — the hiss
// of an edge, wind, the groomer's engine — is synthesised, because a sample
// cannot follow your speed. Anything that has to be RECOGNISED — the chairlift,
// the radio in the cafe — is a real recording: Jurek's own file first, then the
// open web, then nothing rather than a bad imitation.

const REMOTE = {
  // Wikimedia Commons serves with CORS and needs no key. If any of these move or
  // fail, the game simply carries on without that one sound.
  radio: 'https://upload.wikimedia.org/wikipedia/commons/8/8c/Bach_-_Cello_Suite_no._1_in_G_major_BWV_1007_-_I._Pr%C3%A9lude.ogg',
  crowd: 'https://upload.wikimedia.org/wikipedia/commons/4/40/Restaurant_ambience.ogg',
};

const LOCAL = {
  chairlift: 'assets/audio/chairlift.mp3',
};

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.muted = false;
    this.ctx = null;
    this.buffers = new Map();
    this.loops = new Map();
    this.ready = false;

    // A browser will not start audio until the player does something, so the
    // whole graph waits for the first click rather than failing quietly.
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      this.init();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    this.noise = this.makeNoiseBuffer();

    // --- edge on snow: filtered noise whose colour follows the surface
    this.edge = this.makeNoiseSource();
    this.edgeFilter = this.ctx.createBiquadFilter();
    this.edgeFilter.type = 'bandpass';
    this.edgeFilter.frequency.value = 900;
    this.edgeFilter.Q.value = 0.7;
    this.edgeGain = this.ctx.createGain();
    this.edgeGain.gain.value = 0;
    this.edge.connect(this.edgeFilter).connect(this.edgeGain).connect(this.master);

    // --- wind, which is really the sound of going fast
    this.wind = this.makeNoiseSource();
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // --- the groomer's diesel
    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 42;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 260;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engine.start();

    this.ready = true;
    this.loadFiles();
  }

  makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2 + white * 0.25;
    }
    return buf;
  }

  makeNoiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  async loadFiles() {
    const tryLoad = async (key, url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(String(res.status));
        const bytes = await res.arrayBuffer();
        this.buffers.set(key, await this.ctx.decodeAudioData(bytes));
      } catch (err) {
        // A missing sound must never be a broken game.
        console.info(`[audio] ${key} unavailable (${err.message}) — carrying on without it`);
      }
    };
    // Jurek's own recordings come first and win any name clash.
    await Promise.all(Object.entries(LOCAL).map(([k, u]) => tryLoad(k, u)));
    await Promise.all(Object.entries(REMOTE)
      .filter(([k]) => !this.buffers.has(k))
      .map(([k, u]) => tryLoad(k, u)));
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }

  /** One-shots, all synthesised so they never wait on the network. */
  play(name, { volume = 1 } = {}) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.master);

    if (name === 'crash') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1800, t);
      f.frequency.exponentialRampToValueAtTime(140, t + 0.5);
      src.connect(f).connect(g);
      g.gain.setValueAtTime(0.55 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      src.start(t);
      src.stop(t + 0.65);
    } else if (name === 'gate' || name === 'click') {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(name === 'gate' ? 620 : 420, t);
      o.frequency.exponentialRampToValueAtTime(name === 'gate' ? 300 : 260, t + 0.09);
      o.connect(g);
      g.gain.setValueAtTime(0.16 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.start(t);
      o.stop(t + 0.16);
    } else if (name === 'trick') {
      for (let i = 0; i < 3; i++) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(520 * Math.pow(1.26, i), t + i * 0.055);
        const gg = this.ctx.createGain();
        gg.gain.setValueAtTime(0.12 * volume, t + i * 0.055);
        gg.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + 0.22);
        o.connect(gg).connect(this.master);
        o.start(t + i * 0.055);
        o.stop(t + i * 0.055 + 0.24);
      }
    } else if (name === 'engine') {
      this.engineGain.gain.setTargetAtTime(0.12, t, 0.3);
    }
  }

  /** A recorded loop, if we have it. */
  loop(name, { volume = 0.5 } = {}) {
    if (!this.ready || this.loops.has(name)) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.6);
    src.connect(g).connect(this.master);
    src.start();
    this.loops.set(name, { src, gain: g });
  }

  stopLoop(name) {
    const l = this.loops.get(name);
    if (!l) return;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => { try { l.src.stop(); } catch { /* already gone */ } }, 900);
    this.loops.delete(name);
  }

  update(dt) {
    if (!this.ready) return;
    const g = this.game;
    const t = g.skier.telemetry;
    const now = this.ctx.currentTime;

    // Edge noise: quiet on a clean glide, loud and dark on a skid, soft and wide
    // in powder. This one parameter set is the whole difference between snows.
    const grounded = !t.airborne && g.equipped && t.speed > 0.4;
    const skid = t.skid || 0;
    const level = grounded ? Math.min(0.5, (0.02 + skid * 0.34) * Math.min(1, t.speed / 8)) : 0;
    this.edgeGain.gain.setTargetAtTime(level, now, 0.06);
    const cold = t.surface === 'ice' ? 2400 : t.surface === 'powder' ? 420 : 1100;
    this.edgeFilter.frequency.setTargetAtTime(cold + t.speed * 22, now, 0.1);
    this.edgeFilter.Q.setTargetAtTime(t.surface === 'powder' ? 0.4 : 1.4, now, 0.2);

    // Wind rises with speed and is the main reason a tuck feels fast.
    const wind = Math.min(0.35, Math.pow(t.speed / 26, 2) * 0.35);
    this.windGain.gain.setTargetAtTime(wind, now, 0.15);
    this.windFilter.frequency.setTargetAtTime(320 + t.speed * 34, now, 0.2);

    // Engine, only while somebody is actually driving.
    const driving = g.groomer.driver === g.skier;
    this.engineGain.gain.setTargetAtTime(driving ? 0.11 : 0, now, 0.25);
    if (driving) {
      this.engine.frequency.setTargetAtTime(38 + Math.abs(g.groomer.speed) * 7.5, now, 0.15);
      this.engineFilter.frequency.setTargetAtTime(240 + Math.abs(g.groomer.speed) * 60, now, 0.2);
    }

    // Recorded loops belong to places, not to the player.
    const zone = g.resort.zoneAt(g.skier.pos);
    if (g.ride.active && g.ride.lift?.kind === 'chair') this.loop('chairlift', { volume: 0.45 });
    else this.stopLoop('chairlift');
    if (zone && zone.kind === 'cafe') {
      this.loop('radio', { volume: 0.22 });
      this.loop('crowd', { volume: 0.16 });
    } else {
      this.stopLoop('radio');
      this.stopLoop('crowd');
    }
  }
}
