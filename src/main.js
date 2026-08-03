import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { generateTerrain, makeSampler, BASE_ELEV, SUMMIT_ELEV } from './shared/terrain.js';
import { SnowField } from './shared/snowfield.js';
import { TerrainMesh } from './world/terrainMesh.js';
import { Sky } from './world/sky.js';
import { Skier, MODE } from './player/skier.js';
import { FollowCamera } from './player/followCamera.js';
import { AssetLibrary } from './world/assets.js';
import { scatterTrees, scatterRocks, TreeField, PisteFurniture } from './world/props.js';
import { Resort, LiftRide } from './world/resort.js';
import { Avatar, LostGear, DEFAULT_COLOURS } from './player/avatar.js';
import { Groomer } from './world/groomer.js';
import { SnowSpray } from './world/spray.js';
import { validateSet, ridingStats, gearFor } from './gear/catalog.js';
import { HUD } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { GameAudio } from './audio/audio.js';
import { Session } from './net/session.js';

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.listeners = {};
    this.state = {
      points: 0,
      gatesTaken: 0,
      groomedArea: 0,
      tricks: 0,
      crashes: 0,
      descents: 0,
      owned: new Set(['ski-piste74', 'ski-slalom63', 'brd-freeride156', 'brd-park148',
        'boot-ski', 'boot-board', 'helmet-rental', 'jacket-shell']),
      consumables: { tea: 0, map: false, groomerKey: true },
      colours: { ...DEFAULT_COLOURS },
      name: 'You',
      set: null,
      lostGear: false,
    };
    this.prompt = null;
    this.railScore = 0;
  }

  on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
  fire(event, payload) { for (const fn of this.listeners[event] || []) fn(payload); }

  async build(onProgress = () => {}) {
    const step = async (label, fn) => {
      onProgress(label);
      // Deliberately not requestAnimationFrame: a background tab throttles rAF to
      // nothing and loading would appear to hang for anyone who switched away.
      await new Promise((r) => setTimeout(r, 0));
      return fn();
    };

    this.terrain = await step('Raising the mountain', () => generateTerrain());
    this.sampler = makeSampler(this.terrain);
    this.snow = await step('Laying the snow', () => new SnowField(this.terrain));
    this.world = { terrain: this.terrain, sampler: this.sampler, snow: this.snow };

    this.sky = await step('Hanging the sky', () => new Sky(this.engine.scene, { hour: 9.4 }));
    this.engine.scene.fog = new THREE.FogExp2(0xbcd2e8, 0.00075);

    this.terrainMesh = await step('Grooming the pistes', () => new TerrainMesh(this.engine.renderer, this.terrain, this.snow));
    this.engine.scene.add(this.terrainMesh.mesh);

    this.assets = new AssetLibrary();
    await this.assets.load(onProgress);

    // The resort goes up first so the forest knows where it may not grow.
    this.resort = await step('Opening the resort', () => new Resort(this.assets, this.terrain, this.sampler));
    this.engine.scene.add(this.resort.group);

    const keepOut = this.resort.keepOutZones();
    const trees = await step('Planting the forest', () => scatterTrees(this.terrain, this.sampler, 5200, 7717, keepOut));
    const rocks = scatterRocks(this.terrain, this.sampler, 420, 313, keepOut);
    this.forest = await step('Planting the forest', () => new TreeField(this.assets, trees, rocks));
    this.engine.scene.add(this.forest.group);

    this.furniture = await step('Setting out the poles', () => new PisteFurniture(this.assets, this.terrain, this.sampler));
    this.engine.scene.add(this.furniture.group);

    // --- the player arrives on foot with nothing rented
    this.skier = new Skier(this.world, { name: this.state.name });
    this.skier.stats = null;
    const base = this.terrain.stations.base;
    this.skier.placeOnGround(base.x - 22, base.z + 50, Math.PI * 1.02);

    this.avatar = new Avatar(this.assets, { colours: this.state.colours, kind: 'ski' });
    this.avatar.gear.visible = false;
    this.engine.scene.add(this.avatar.root);

    this.lostGear = new LostGear(this.engine.scene, this.world);
    this.spray = new SnowSpray(this.engine.scene);
    this.groomer = new Groomer(this.assets, this.world, this.resort);
    this.engine.scene.add(this.groomer.group);

    this.camera = new FollowCamera(this.engine.camera, this.skier, this.world);
    this.ride = new LiftRide(this.skier);

    // Grooming pays by the square metre actually restored, so an hour in the
    // machine is worth about the same as an hour of skiing — which is the only
    // reason anybody would ever get in it.
    this.groomer.onGroomed = (area) => {
      this.state.groomedArea += area;
      this.award(area * 0.55, 'Groomed');
    };

    this.hud = new HUD(this.uiRoot, this);
    this.panels = new Panels(this.uiRoot, this);
    this.audio = new GameAudio(this);
    this.session = new Session(this);

    this.engine.onQualityChange = (q) => {
      this.terrainMesh.setQuality(q);
      this.sky.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sky.sun.castShadow = q.shadow > 0;
      this.forest?.setDensity(q.trees);
      this.fire('quality', q);
    };
    this.terrainMesh.setQuality(this.engine.quality);
    this.forest.setDensity(this.engine.quality.trees);

    this.engine.add(this);
    onProgress('Ready');
    return this;
  }

  // ------------------------------------------------------------------ gear

  get equipped() { return !!this.skier.stats; }

  equip(set) {
    const check = validateSet(set);
    if (!check.ok) return check;
    this.state.set = set;
    this.skier.setGear(set);
    this.skier.stats = ridingStats(set);
    const board = gearFor(set.board);
    this.avatar.setKind(board.kind);
    this.avatar.setColours({ ...this.state.colours, gear: board.colours[0], trim: board.colours[1] });
    this.state.lostGear = false;
    this.avatar.restoreGear();
    this.avatar.gear.visible = true;
    this.fire('gear', set);
    return { ok: true };
  }

  spend(points) {
    if (this.state.points < points) return false;
    this.state.points -= points;
    return true;
  }

  award(points, label) {
    this.state.points += points;
    this.fire('score', { points, label, total: this.state.points });
  }

  // ------------------------------------------------------------------ loop

  update(dt, elapsed) {
    const raw = this.input.sample();
    const uiOpen = this.panels.isOpen;
    const idle = { steer: 0, throttle: 0, brake: 0, jump: false, jumpHeld: false, tuck: false, grab: false, lookX: 0, lookY: 0, zoom: 0 };
    const input = uiOpen || !this.input.pointerLocked ? { ...raw, ...idle } : raw;

    const zone = this.resort.zoneAt(this.skier.pos);
    const warming = zone ? (zone.kind === 'cafe' ? 0.16 : zone.kind === 'fire' ? 0.055 : 0) : 0;
    const ctx = {
      night: this.sky.nightAmount,
      onFoot: !this.equipped || this.state.lostGear,
      warming,
      sheltered: zone && ['cafe', 'rental', 'booth'].includes(zone.kind) ? 1 : 0,
    };

    this.skier._tuck = input.tuck;

    if (this.groomer.driver === this.skier) {
      this.groomer.control(dt, input);
      this.skier.pos.copy(this.groomer.seatPosition());
      this.skier.heading = this.groomer.heading;
      this.skier.mode = MODE.GROOMER;
      this.skier.updateComfort(dt, { ...ctx, sheltered: 1 });
    } else if (this.ride.active) {
      this.ride.update();
      this.skier.updateComfort(dt, ctx);
    } else {
      this.skier.update(dt, input, ctx);
    }

    this.handleEvents();
    this.handleInteractions();
    if (this.input.pressed('emote') && !uiOpen) {
      this.avatar.wave = 1.2;
      this.session.emote('wave');
    }
    if (this.input.pressed('map')) this.hud.toggleMap();
    this.scoreFeatures(dt);

    this.resort.update(dt, elapsed, this.sky.nightAmount);
    this.groomer.update(dt);
    this.lostGear.update(dt);
    this.spray.update(dt, this.skier);

    this.avatar.update(dt, this.skier);
    this.avatar.root.visible = this.groomer.driver !== this.skier;

    this.camera.update(dt, this.input.pointerLocked && !uiOpen ? raw : null);
    this.sky.update(dt, elapsed, this.engine.camera.position);
    this.terrainMesh.setSun(
      this.sky.sunDir, this.sky.sunColour, this.sky.skyColour,
      this.sky.groundColour, this.sky.fogColour, this.sky.fogDensity,
    );
    this.engine.scene.fog.color.copy(this.sky.fogColour);
    this.engine.scene.fog.density = this.sky.fogDensity;
    this.terrainMesh.setLamps(
      [...this.resort.lamps(), ...this.groomer.lamps()],
      this.engine.camera.position,
    );
    this.terrainMesh.update(dt, elapsed, this.engine.camera.position);
    this.forest.update(dt, elapsed, this.engine.camera);
    this.engine.renderer.toneMappingExposure = this.sky.exposure;

    this.session.update(dt);
    this.audio.update(dt);
    this.hud.update(dt);

    this.input.endFrame();
    this.fire('frame', this);
  }

  handleEvents() {
    for (const e of this.skier.drainEvents()) {
      if (e.type === 'trick') {
        this.state.tricks++;
        this.award(e.score, e.name);
        this.hud.showTrick(e);
        this.audio.play('trick');
      } else if (e.type === 'crash') {
        this.state.crashes++;
        this.onCrash(e);
      }
      this.fire(e.type, e);
    }
  }

  onCrash(e) {
    // Full comedy: the gear leaves. You walk to it in your boots, which is the
    // only time most players find out what walking on snow is actually like.
    const dropped = this.avatar.releaseGear();
    if (dropped.length) {
      this.lostGear.drop(dropped, e.pos, e.vel, e.heading);
      this.state.lostGear = true;
      this.skier.stats = null;
    }
    this.audio.play('crash', { volume: Math.min(1, e.speed / 16) });
    this.hud.flash('Your gear came off. Walk over and pick it up.');
  }

  handleInteractions() {
    const s = this.skier;
    const press = this.input.pressed('interact');
    this.prompt = null;

    if (this.groomer.driver === this.skier) {
      this.prompt = { key: 'F', text: 'Get out of the groomer' };
      if (press) this.groomer.dismount(this.skier);
      return;
    }
    if (this.ride.active) {
      this.prompt = { key: 'F', text: 'Get off early' };
      if (press) this.ride.exit();
      return;
    }

    if (this.state.lostGear) {
      const near = this.lostGear.nearby(s.pos, 2.6);
      if (near.length) {
        this.prompt = { key: 'F', text: near.length > 1 ? 'Pick up your gear' : 'Pick it up' };
        if (press) {
          this.lostGear.collect(near);
          if (!this.lostGear.items.length) {
            this.state.lostGear = false;
            if (this.state.set) {
              this.skier.stats = ridingStats(this.state.set);
              this.avatar.restoreGear();
              this.avatar.gear.visible = true;
            }
            this.hud.flash('Back on your feet.');
            this.audio.play('click');
          }
        }
        return;
      }
    }

    for (const lift of this.resort.lifts) {
      if (!lift.nearLoad(s.pos)) continue;
      const check = this.state.set ? validateSet(this.state.set) : { ok: false, reason: 'Rent a set at the shop first.' };
      if (!check.ok) { this.prompt = { key: null, text: check.reason, blocked: true }; return; }
      if (this.state.lostGear) { this.prompt = { key: null, text: 'Find your gear before you get on.', blocked: true }; return; }
      const carrier = lift.availableCarrier();
      this.prompt = carrier
        ? { key: 'F', text: lift.kind === 'chair' ? 'Ride the chairlift' : 'Take the drag lift' }
        : { key: null, text: 'Wait for the next one' };
      if (carrier && press && this.ride.tryBoard(lift)) this.audio.play('click');
      return;
    }

    const zone = this.resort.zoneAt(s.pos);
    if (!zone) return;
    if (zone.kind === 'rental') {
      this.prompt = { key: 'F', text: 'Rental shop' };
      if (press) this.panels.open('rental');
    } else if (zone.kind === 'booth') {
      this.prompt = { key: 'F', text: 'Change your colours' };
      if (press) this.panels.open('booth');
    } else if (zone.kind === 'cafe') {
      this.prompt = { key: 'F', text: 'Cafe' };
      if (press) this.panels.open('cafe');
    } else if (zone.kind === 'garage') {
      this.prompt = this.state.consumables.groomerKey
        ? { key: 'F', text: 'Take the groomer out' }
        : { key: null, text: 'The groomer key is at the cafe counter', blocked: true };
      if (this.state.consumables.groomerKey && press) {
        this.groomer.mount(this.skier);
        this.audio.play('engine');
      }
    } else if (zone.kind === 'fire') {
      this.prompt = { key: null, text: 'Warming up' };
    }
  }

  // ------------------------------------------------------------------ scoring

  scoreFeatures(dt) {
    const s = this.skier;
    if (!this.equipped || s.mode === MODE.LIFT || s.mode === MODE.GROOMER) return;

    for (const g of this.furniture.gates) {
      if (g.taken) continue;
      if (Math.hypot(s.pos.x - g.x, s.pos.z - g.z) < 3.4 && s.telemetry.speed > 3) {
        g.taken = true;
        this.state.gatesTaken++;
        this.award(g.feature.points, 'Gate');
        this.audio.play('gate');
      }
    }

    let onRail = null;
    for (const r of this.furniture.rails) {
      const dx = s.pos.x - r.x, dz = s.pos.z - r.z;
      const along = dx * r.dir[0] + dz * r.dir[1];
      const across = -dx * r.dir[1] + dz * r.dir[0];
      const halfW = r.box ? 0.9 : 0.42;
      if (Math.abs(along) > r.length / 2 || Math.abs(across) > halfW) continue;
      const top = this.sampler.sampleHeight(s.pos.x, s.pos.z) + r.height;
      if (Math.abs(s.pos.y - top) > 0.55) continue;
      // Locked on: the rail carries you, and the points accrue by the metre.
      s.pos.y = top;
      s.vel.y = 0;
      s.mode = MODE.RIDE;
      onRail = r;
      this.railScore += r.feature.points * dt * 0.5;
      if (Math.abs(across) > halfW * 0.82 && s.telemetry.speed > 6) s.crash('slipped off the rail');
      break;
    }
    if (!onRail && this.railScore > 0) {
      const score = Math.round(this.railScore);
      this.railScore = 0;
      if (score > 4) {
        this.award(score, 'Rail');
        this.hud.showTrick({ name: 'Rail slide', score, combo: 1 });
      }
    }

    if (s.pos.y > BASE_ELEV + 190) this._wasHigh = true;
    if (this._wasHigh && s.pos.y < BASE_ELEV + 22) {
      this._wasHigh = false;
      this.state.descents++;
      this.fire('descent', { count: this.state.descents });
      this.hud.flash(`Run ${this.state.descents} done.`);
    }
  }

  get altitudeFraction() {
    return THREE.MathUtils.clamp((this.skier.pos.y - BASE_ELEV) / (SUMMIT_ELEV - BASE_ELEV), 0, 1);
  }

  start() { this.engine.start(); }
}

// ---------------------------------------------------------------- boot

const canvas = document.getElementById('view');
const uiRoot = document.getElementById('ui');
const game = new Game(canvas, uiRoot);
window.game = game;

const boot = document.createElement('div');
boot.className = 'boot';
boot.innerHTML = '<div class="boot__label">SKI Together</div><div class="boot__step">Starting</div>';
uiRoot.appendChild(boot);
const bootStep = boot.querySelector('.boot__step');

// A build that throws must say so on screen. A loading screen that simply stops
// is the most expensive kind of bug: it looks like slowness, so nobody reports it.
function fatal(err) {
  console.error(err);
  boot.innerHTML = `<div class="boot__label">Something broke</div>
    <div class="boot__step">${String((err && err.message) || err).slice(0, 220)}</div>`;
  boot.classList.add('boot--error');
}
window.addEventListener('error', (e) => fatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

game.build((label) => { bootStep.textContent = label; }).catch(fatal).then((built) => {
  if (!built) return;
  boot.remove();
  game.start();
  game.hud.mount();
  canvas.addEventListener('click', () => {
    if (!game.panels.isOpen) game.input.requestPointerLock();
  });
  game.input.onPointerLockChange = (locked) => game.hud.setLocked(locked);
});
