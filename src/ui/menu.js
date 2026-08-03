import * as THREE from 'three';
import { Skier, MODE } from '../player/skier.js';
import { Avatar } from '../player/avatar.js';

// The main menu.
//
// It is not a picture of the game, it IS the game: the same mountain, the same
// snow, the same lifts turning. The camera orbits the base station, flies up the
// cable, orbits the summit and comes back, while a handful of skiers actually
// ski down. Moving the mouse leans the whole shot — the near snow slides, the
// far peaks barely move — and pressing Play just hands the camera back.

const BASE_ORBIT = 26; // seconds
const CLIMB = 13;
const SUMMIT_ORBIT = 20;
const DESCEND = 13;
const LOOP = BASE_ORBIT + CLIMB + SUMMIT_ORBIT + DESCEND;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const smooth = (t) => t * t * (3 - 2 * t);

export class MainMenu {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.time = 0;
    this.mouse = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.smoothLook = new THREE.Vector3();
    this.initialised = false;
    this.ghosts = [];
    this.node = null;

    this._onMove = (e) => {
      this.mouse.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    };
  }

  // ---------------------------------------------------------------- scene

  /** A few skiers already on the mountain, so the shot is never empty. */
  spawnGhosts(count = 4) {
    const g = this.game;
    const runs = g.terrain.runs;
    const colours = [
      { jacket: '#2e6fd9', trousers: '#16202b', helmet: '#f2f5f8' },
      { jacket: '#ffb23f', trousers: '#1b2430', helmet: '#0f5f52' },
      { jacket: '#f2f5f8', trousers: '#26407a', helmet: '#d3352c' },
      { jacket: '#0f5f52', trousers: '#16202b', helmet: '#ffb23f' },
    ];
    for (let i = 0; i < count; i++) {
      const run = runs[i % runs.length];
      const start = 6 + Math.floor((i / count) * (run.line.length * 0.7));
      const skier = new Skier(g.world, { name: `ghost${i}` });
      skier.setGear({
        board: i % 3 === 0 ? 'brd-freeride156' : 'ski-piste74',
        boot: i % 3 === 0 ? 'boot-board' : 'boot-ski',
        helmet: 'helmet-rental',
        jacket: 'jacket-shell',
      });
      const [x, z] = run.line[start];
      const [nx, nz] = run.line[start + 4];
      skier.placeOnGround(x, z, Math.atan2(nx - x, nz - z));
      skier.mode = MODE.RIDE;
      const avatar = new Avatar(g.assets, {
        colours: colours[i % colours.length],
        kind: i % 3 === 0 ? 'board' : 'ski',
      });
      g.engine.scene.add(avatar.root);
      this.ghosts.push({ skier, avatar, run, idx: start, target: 12 + i * 1.5 });
    }
  }

  updateGhosts(dt) {
    for (const gh of this.ghosts) {
      const line = gh.run.line;
      while (gh.idx < line.length - 2) {
        const [px, pz] = line[gh.idx];
        const [qx, qz] = line[gh.idx + 1];
        if ((gh.skier.pos.x - px) * (qx - px) + (gh.skier.pos.z - pz) * (qz - pz) > 0) gh.idx++;
        else break;
      }
      // Back to the top when they reach the bottom, so the mountain stays busy.
      if (gh.idx >= line.length - 6) {
        gh.idx = 4;
        const [x, z] = line[4];
        const [nx, nz] = line[8];
        gh.skier.placeOnGround(x, z, Math.atan2(nx - x, nz - z));
        gh.skier.mode = MODE.RIDE;
      }
      const look = Math.min(line.length - 1, gh.idx + 8);
      const [tx, tz] = line[look];
      const want = Math.atan2(tx - gh.skier.pos.x, tz - gh.skier.pos.z);
      let d = want - gh.skier.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const steer = THREE.MathUtils.clamp(-d * 1.6, -0.75, 0.75);
      const brake = gh.skier.telemetry.speed > gh.target ? 1 : 0;
      gh.skier.update(dt, {
        steer, throttle: gh.skier.telemetry.speed < 4 ? 1 : 0, brake,
        tuck: false, jump: false, grab: false,
      }, { night: this.game.sky.nightAmount });
      if (gh.skier.mode === MODE.CRASH) {
        gh.skier.recover();
        gh.skier.mode = MODE.RIDE;
      }
      gh.avatar.update(dt, gh.skier);
    }
  }

  removeGhosts() {
    for (const gh of this.ghosts) this.game.engine.scene.remove(gh.avatar.root);
    this.ghosts.length = 0;
  }

  // ---------------------------------------------------------------- camera

  /** Where the camera and its target are at time t in the loop. */
  path(t) {
    const g = this.game;
    const base = g.terrain.stations.base;
    const summit = g.terrain.stations.summit;
    const baseY = g.sampler.sampleHeight(base.x, base.z);
    const summitY = g.sampler.sampleHeight(summit.x, summit.z);
    const pos = this.pos, look = this.look;

    if (t < BASE_ORBIT) {
      const a = (t / BASE_ORBIT) * Math.PI * 2 + 0.6;
      const r = 74 - Math.sin(t / BASE_ORBIT * Math.PI) * 12;
      pos.set(base.x + Math.sin(a) * r, baseY + 26, base.z + Math.cos(a) * r);
      look.set(base.x, baseY + 5, base.z - 6);
      return;
    }
    let u = t - BASE_ORBIT;
    if (u < CLIMB) {
      // Along the cable, the way a chair sees it.
      const k = smooth(u / CLIMB);
      const lift = g.resort.chair;
      const at = lift.at(k * lift.length);
      const ahead = lift.at(Math.min(lift.length, k * lift.length + 90));
      pos.set(at.x - lift.dir.x * 26, at.cable + 16, at.z - lift.dir.y * 26);
      look.set(ahead.x, ahead.ground + 4, ahead.z);
      return;
    }
    u -= CLIMB;
    if (u < SUMMIT_ORBIT) {
      const a = (u / SUMMIT_ORBIT) * Math.PI * 1.6 + 2.2;
      const r = 58;
      pos.set(summit.x + Math.sin(a) * r, summitY + 22, summit.z + Math.cos(a) * r);
      look.set(summit.x, summitY + 2, summit.z + 14);
      return;
    }
    u -= SUMMIT_ORBIT;
    const k = smooth(u / DESCEND);
    const lift = g.resort.chair;
    const at = lift.at((1 - k) * lift.length);
    const ahead = lift.at(Math.max(0, (1 - k) * lift.length - 110));
    pos.set(at.x + lift.dir.x * 22, at.cable + 20, at.z + lift.dir.y * 22);
    look.set(ahead.x, ahead.ground + 3, ahead.z);
  }

  updateCamera(dt) {
    const cam = this.game.engine.camera;
    this.path(this.time % LOOP);

    // Parallax. The camera swings a couple of metres and the look target swings
    // the other way, so the near snow slides and the far peaks barely move —
    // which is what parallax is, rather than an effect layered on top.
    this.parallax.lerp(this.mouse, Math.min(1, dt * 2.4));
    const right = new THREE.Vector3().subVectors(this.look, this.pos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    this.pos.addScaledVector(right, -this.parallax.x * 5.5);
    this.pos.y += this.parallax.y * 3.2;
    this.look.addScaledVector(right, this.parallax.x * 2.4);
    this.look.y -= this.parallax.y * 1.4;

    if (!this.initialised) {
      this.smoothPos.copy(this.pos);
      this.smoothLook.copy(this.look);
      this.initialised = true;
    } else {
      this.smoothPos.lerp(this.pos, Math.min(1, dt * 3.2));
      this.smoothLook.lerp(this.look, Math.min(1, dt * 3.2));
    }
    cam.position.copy(this.smoothPos);
    cam.lookAt(this.smoothLook);
    if (Math.abs(cam.fov - 52) > 0.05) {
      cam.fov = THREE.MathUtils.damp(cam.fov, 52, 3, dt);
      cam.updateProjectionMatrix();
    }
  }

  update(dt) {
    this.time += dt;
    this.updateGhosts(dt);
    this.updateCamera(dt);
  }

  // ---------------------------------------------------------------- dom

  mount() {
    const g = this.game;
    this.node = el('div', 'menu');

    const plate = el('div', 'menu__plate');
    const title = el('h1', 'menu__title');
    title.innerHTML = '<span>SKI</span><span>Together</span>';
    plate.appendChild(title);
    plate.appendChild(el('p', 'menu__tagline',
      'A mountain that remembers every turn. Rent a set, ride up, and find out what your friends did to the snow.'));

    const actions = el('div', 'menu__actions');
    const play = el('button', 'btn btn--primary btn--big', 'Ski');
    play.addEventListener('click', () => this.play());
    // Both used to open the same panel under two different names, which teaches
    // the player a vocabulary that is not true.
    const rooms = el('button', 'btn', 'Play together');
    rooms.addEventListener('click', () => g.panels.open('menu', 'rooms'));
    const settings = el('button', 'btn', 'Settings');
    settings.addEventListener('click', () => g.panels.open('menu', 'settings'));
    actions.append(play, rooms, settings);
    plate.appendChild(actions);

    // The board at the bottom of every real resort: which runs there are, how
    // long, how steep, and whether they are open. It replaces a row of headline
    // numbers that included "Snow cells — 5.2 M", which is a term out of the
    // source code and means nothing to anyone standing at the lift.
    const board = el('div', 'pistes');
    const head = el('div', 'pistes__head');
    head.append(el('span', 't-label', 'Pistes'), el('span', 'pistes__state', 'All open'));
    board.appendChild(head);

    const list = el('ul', 'pistes__list');
    for (const run of g.terrain.runs) {
      const grade = (run.topElev - run.bottomElev) / run.length;
      const li = el('li', `pistes__run pistes__run--${run.key}`);
      li.append(
        el('i', 'pistes__chip'),
        el('span', 'pistes__name', run.name),
        el('span', 'pistes__len t-num', `${(run.length / 1000).toFixed(1)} km`),
        el('span', 'pistes__grade t-num', `${Math.round(grade * 100)}%`),
      );
      list.appendChild(li);
    }
    board.appendChild(list);

    const foot = el('p', 'pistes__foot',
      `${Math.round(g.terrain.runs[0].topElev - g.terrain.runs[0].bottomElev)} m of vertical, `
      + 'one chairlift, one drag lift. Up to five of you.');
    board.appendChild(foot);
    plate.appendChild(board);
    this.node.appendChild(plate);

    this.node.appendChild(el('div', 'menu__hint', 'Move the mouse to look around'));

    this.root.appendChild(this.node);
    window.addEventListener('mousemove', this._onMove);
    this.spawnGhosts();
    g.hud.node.classList.add('hud--hidden');
  }

  play() {
    const g = this.game;
    this.node?.classList.add('menu--leaving');
    window.removeEventListener('mousemove', this._onMove);
    setTimeout(() => {
      this.node?.remove();
      this.node = null;
    }, 420);
    this.removeGhosts();
    g.hud.node.classList.remove('hud--hidden');
    g.mode = 'play';
    g.camera.reset();
    g.input.requestPointerLock();
  }

  dispose() {
    window.removeEventListener('mousemove', this._onMove);
    this.removeGhosts();
    this.node?.remove();
  }
}
