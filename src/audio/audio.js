// Sound.
//
// Every sound in the game is a recording. Nothing here is synthesised — the
// oscillators and filtered noise that used to stand in for an edge, an engine and
// a footstep are gone, and so is the reason they were there.
//
// The argument for synthesis was that a sample cannot follow your speed. That is
// only true if you play a sample the way a jukebox does. A recorded hiss played
// as a loop, with its playback rate and its filter driven by the telemetry, does
// follow your speed — and it sounds like snow, which no amount of band-passed
// noise ever did.
//
// Three sources, all CORS-open and key-free:
//   * assets/audio/    Jurek's own recordings. Listed in SOURCES like any other
//                      entry, so dropping a file in and naming it here replaces
//                      the downloaded one outright.
//   * jsDelivr         Kenney's CC0 packs, pinned to a commit so a URL cannot
//                      move under us
//   * Wikimedia Commons for the ambiences nobody has a game-pack version of
//
// The previous version pointed at two Commons files that had both been moved,
// which is why the cafe was silent: a 404 was logged and swallowed. Every URL in
// here was checked before it was written down, and anything missing now says so
// out loud in the console rather than quietly leaving a hole.

const KENNEY = 'https://cdn.jsdelivr.net/gh/Cy4nWare/sfx-api@ab0ae1c1de5a872e9989a87323a42e2100533032/sounds';
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';

/**
 * name -> one url, or several for a sound that must not repeat identically.
 * Anything with a `local` is looked for in assets/audio first.
 */
const SOURCES = {
  // --- footfalls, one per surface
  step_snow: [
    `${KENNEY}/impact-sounds/footstep-snow-000.ogg`,
    `${KENNEY}/impact-sounds/footstep-snow-001.ogg`,
    `${KENNEY}/impact-sounds/footstep-snow-002.ogg`,
    `${KENNEY}/impact-sounds/footstep-snow-003.ogg`,
  ],
  step_hard: [`${KENNEY}/impact-sounds/footstep-wood-000.ogg`],

  // --- impacts
  crash: [`${KENNEY}/impact-sounds/impactpunch-heavy-000.ogg`],
  land: [`${KENNEY}/impact-sounds/impactsoft-medium-002.ogg`],
  land_hard: [`${KENNEY}/impact-sounds/impactsoft-heavy-001.ogg`],
  bump: [`${KENNEY}/impact-sounds/impactwood-medium-000.ogg`],
  clang: [`${KENNEY}/impact-sounds/impactmetal-light-000.ogg`],

  // --- interface and events
  click: [`${KENNEY}/interface-sounds/click-001.ogg`],
  gate: [`${KENNEY}/interface-sounds/confirmation-001.ogg`],
  blocked: [`${KENNEY}/interface-sounds/error-002.ogg`],
  board: [`${KENNEY}/interface-sounds/drop-002.ogg`],
  trick: [`${KENNEY}/music-jingles/hit-jingles-jingles-hit03.ogg`],
  trick_big: [`${KENNEY}/music-jingles/hit-jingles-jingles-hit06.ogg`],

  // --- the continuous world
  // One wind recording drives two things: the wind past your ears, and — pitched
  // up and band-passed — the edge running on snow. Both are the same physics and
  // it is the same broadband hiss, which is why one recording covers them.
  wind: [`${COMMONS}/f/f3/Wind_in_Swedish_pine_forest_at_25_mps.ogg`],
  fire: [`${COMMONS}/b/b1/Campfire_sound_ambience.ogg`],
  crowd: [`${COMMONS}/d/d1/Carbon_Market_at_Night_in_Cebu_City.ogg`],
  diesel: [`${COMMONS}/3/3c/Detroit62.ogg`],
  chairlift: [{ local: 'assets/audio/chairlift.mp3' }],
  // Jurek's track. The spec puts music in two places and nowhere else: the menu,
  // and inside the cafe. A mountain with a soundtrack over it stops being a
  // mountain.
  music: [{ local: 'assets/audio/music.mp3' }],
};

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.muted = false;
    this.ctx = null;
    this.buffers = new Map(); // name -> AudioBuffer[]
    this.loops = new Map();
    this.ready = false;
    this.missing = [];

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
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.stepTimer = 0;
    this.ready = true;
    this.load();
  }

  // ------------------------------------------------------------------ loading

  async load() {
    const fetchOne = async (url) => {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return this.ctx.decodeAudioData(await res.arrayBuffer());
    };

    await Promise.all(Object.entries(SOURCES).map(async ([name, list]) => {
      const out = [];
      for (const entry of list) {
        const url = typeof entry === 'string' ? entry : entry.local;
        try {
          out.push(await fetchOne(url));
        } catch (err) {
          this.missing.push(`${name} (${err.message})`);
        }
      }
      if (out.length) this.buffers.set(name, out);
    }));

    if (this.missing.length) {
      // Loud, because the last time a sound went missing it did so in silence and
      // stayed missing through a whole playtest.
      console.warn(`[audio] ${this.missing.length} sound(s) unavailable:`, this.missing.join(', '));
    }
    this.startBeds();
    this.game.hud?.flash?.(this.missing.length
      ? `Sound ready (${this.missing.length} unavailable).`
      : 'Sound ready.');
  }

  /** The loops that are always running and only change level. */
  startBeds() {
    const ctx = this.ctx;

    // Wind past the ears.
    this.windNode = this.makeLoop('wind', { rate: 1.0 });
    if (this.windNode) {
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 420;
      this.windNode.gain.disconnect();
      this.windNode.gain.connect(this.windFilter).connect(this.master);
      this.windNode.gain.gain.value = 0;
    }

    // The same recording again, faster and narrower: this is the ski on the snow.
    this.edgeNode = this.makeLoop('wind', { rate: 1.9 });
    if (this.edgeNode) {
      this.edgeFilter = ctx.createBiquadFilter();
      this.edgeFilter.type = 'bandpass';
      this.edgeFilter.frequency.value = 1100;
      this.edgeFilter.Q.value = 0.9;
      this.edgeNode.gain.disconnect();
      this.edgeNode.gain.connect(this.edgeFilter).connect(this.master);
      this.edgeNode.gain.gain.value = 0;
    }

    // The mountain itself: the same wind, very slow and very quiet, so silence
    // never reads as "the sound is broken".
    this.bedNode = this.makeLoop('wind', { rate: 0.55 });
    if (this.bedNode) {
      this.bedFilter = ctx.createBiquadFilter();
      this.bedFilter.type = 'lowpass';
      this.bedFilter.frequency.value = 240;
      this.bedNode.gain.disconnect();
      this.bedNode.gain.connect(this.bedFilter).connect(this.master);
      this.bedNode.gain.gain.value = 0.03;
    }

    this.fireNode = this.makeLoop('fire');
    if (this.fireNode) this.fireNode.gain.gain.value = 0;
    this.engineNode = this.makeLoop('diesel', { rate: 1 });
    if (this.engineNode) this.engineNode.gain.gain.value = 0;
  }

  makeLoop(name, { rate = 1 } = {}) {
    const list = this.buffers.get(name);
    if (!list || !list.length) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = list[0];
    src.loop = true;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.master);
    src.start();
    return { src, gain };
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.85;
  }

  // ------------------------------------------------------------------ playing

  /** A one-shot, from whatever recordings we have under that name. */
  play(name, { volume = 1, rate = 1 } = {}) {
    if (!this.ready || this.muted) return;
    const list = this.buffers.get(name);
    if (!list || !list.length) return;
    const src = this.ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    // A footstep that is bit-identical every time reads as a machine walking.
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, volume);
    src.connect(g).connect(this.master);
    src.start();
  }

  loop(name, { volume = 0.5 } = {}) {
    if (!this.ready || this.loops.has(name)) return;
    const node = this.makeLoop(name);
    if (!node) return;
    node.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.6);
    this.loops.set(name, node);
  }

  stopLoop(name) {
    const l = this.loops.get(name);
    if (!l) return;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => { try { l.src.stop(); } catch { /* already gone */ } }, 900);
    this.loops.delete(name);
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    if (!this.ready) return;
    const g = this.game;
    const t = g.skier.telemetry;
    const now = this.ctx.currentTime;
    const ramp = (param, value, time = 0.1) => param.setTargetAtTime(value, now, time);

    // --- the edge on the snow. Level from speed and skid, colour from the
    // surface, and the playback rate from speed as well, because a ski running
    // faster hisses higher and that is most of what tells you how fast you are.
    const running = !t.airborne && g.equipped && t.speed > 0.4;
    const skid = t.skid || 0;
    if (this.edgeNode) {
      const level = running
        ? Math.min(0.55, (0.09 + skid * 0.40) * Math.min(1, 0.22 + t.speed / 11))
        : 0;
      ramp(this.edgeNode.gain.gain, level, 0.06);
      ramp(this.edgeNode.src.playbackRate, 1.35 + Math.min(t.speed, 26) * 0.045, 0.15);
      const colour = t.surface === 'ice' ? 2500 : t.surface === 'powder' ? 430 : 1150;
      ramp(this.edgeFilter.frequency, colour + t.speed * 22, 0.12);
      ramp(this.edgeFilter.Q, t.surface === 'powder' ? 0.4 : 1.5, 0.2);
    }

    // --- wind, which is really the sound of going fast
    if (this.windNode) {
      ramp(this.windNode.gain.gain, Math.min(0.40, Math.pow(t.speed / 22, 1.7) * 0.40), 0.15);
      ramp(this.windFilter.frequency, 300 + t.speed * 34, 0.2);
      ramp(this.windNode.src.playbackRate, 0.85 + Math.min(t.speed, 30) * 0.012, 0.3);
    }
    if (this.bedNode) ramp(this.bedNode.gain.gain, 0.022 + g.sky.nightAmount * 0.024, 1.2);

    // --- the groomer's diesel, only while somebody is driving it
    const driving = g.groomer.driver === g.skier;
    if (this.engineNode) {
      ramp(this.engineNode.gain.gain, driving ? 0.34 : 0, 0.25);
      if (driving) ramp(this.engineNode.src.playbackRate, 0.72 + Math.abs(g.groomer.speed) * 0.10, 0.2);
    }

    // --- the bonfire, which you hear before you are standing in it
    if (this.fireNode) {
      const fire = g.resort.zones.find((z) => z.kind === 'fire');
      let level = 0;
      if (fire) {
        const d = Math.hypot(g.skier.pos.x - fire.x, g.skier.pos.z - fire.z);
        level = Math.max(0, 1 - d / 22) * 0.34;
      }
      ramp(this.fireNode.gain.gain, level, 0.3);
    }

    // --- footsteps, one crunch per stride, on whatever is underfoot
    if (!g.equipped || g.state.lostGear) {
      if (t.speed > 0.4) {
        this.stepTimer -= dt * (1.05 + t.speed * 0.80);
        if (this.stepTimer <= 0) {
          this.stepTimer = 1;
          const deep = t.surface === 'powder';
          this.play('step_snow', {
            volume: deep ? 0.55 : 0.85,
            rate: deep ? 0.82 : 1.05,
          });
        }
      }
    } else if (t.pushing) {
      // Herringbone: one bite of the edge per kick, in time with the animation.
      const phase = g.skier.pushPhase || 0;
      if (this._lastKick === undefined) this._lastKick = phase;
      if (Math.floor(phase / Math.PI) !== Math.floor(this._lastKick / Math.PI)) {
        this.play('step_snow', { volume: 0.45, rate: 1.25 });
      }
      this._lastKick = phase;
    }

    // --- landing, once, on the frame the skier touches down
    if (t.thud > 0.02 && !this._thudPlayed) {
      this.play(t.thud > 0.55 ? 'land_hard' : 'land', { volume: Math.min(1, 0.4 + t.thud) });
      this._thudPlayed = true;
    } else if (t.thud <= 0.02) {
      this._thudPlayed = false;
    }

    // --- recorded loops that belong to places, not to the player
    const zone = g.resort.zoneAt(g.skier.pos);
    if (g.ride.active && g.ride.lift?.kind === 'chair') this.loop('chairlift', { volume: 0.45 });
    else this.stopLoop('chairlift');
    if (zone && zone.kind === 'cafe') {
      this.loop('crowd', { volume: 0.26 });
      this.loop('music', { volume: 0.22 });
    } else {
      this.stopLoop('crowd');
      this.stopLoop('music');
    }
  }
}
