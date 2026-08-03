import { BASE_ELEV, SUMMIT_ELEV } from '../shared/terrain.js';

// The heads-up display.
//
// One idea carries it: the altitude rail down the left edge. It is the piste map,
// the progress of your descent and the roster of everyone on the mountain, in a
// single column measured in metres above the base station. Everything else on
// screen stays quiet so the rail can be the thing you read.

const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// The black run really is black, but a black line on a dark plate is a line
// nobody can see, so on the rail it is drawn as the lightest slate that still
// reads as "not blue, not red".
const RUN_COLOURS = { blue: 'var(--blue)', red: 'var(--red)', black: '#8e9aa8' };

export class HUD {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.node = el('div', 'hud');
    this.locked = false;
    this.flashTimer = 0;
    this.trickTimer = 0;
    this.build();
  }

  mount() {
    this.root.appendChild(this.node);
    this.buildRail();
  }

  build() {
    // ---- altitude rail (the signature)
    this.rail = el('div', 'rail');
    this.rail.appendChild(el('div', 'rail__label', 'Altitude'));
    this.railSvg = svgEl('svg', { viewBox: '0 0 92 400', preserveAspectRatio: 'xMidYMid meet', class: 'rail__svg' });
    this.rail.appendChild(this.railSvg);
    const foot = el('div', 'rail__foot');
    this.altValue = el('span', 'rail__alt t-num', '0');
    const altUnit = el('span', 'rail__unit', 'm');
    foot.append(this.altValue, altUnit);
    this.rail.appendChild(foot);
    this.node.appendChild(this.rail);

    // ---- bottom-left cluster: how fast, on what, and how you are holding up
    const cluster = el('div', 'cluster');
    this.speedBox = el('div', 'speed');
    this.speedValue = el('div', 'speed__value t-num', '0');
    const speedUnit = el('div', 'speed__unit', 'km/h');
    this.surface = el('div', 'speed__surface', 'corduroy');
    this.speedBox.append(this.speedValue, speedUnit, this.surface);

    this.vitals = el('div', 'vitals');
    this.coldBar = this.makeBar('Warmth', 'cold');
    this.staminaBar = this.makeBar('Breath', 'stamina');
    this.vitals.append(this.coldBar.node, this.staminaBar.node);

    cluster.append(this.speedBox, this.vitals);
    this.node.appendChild(cluster);

    // ---- score and roster
    this.board = el('div', 'board');
    const head = el('div', 'board__head');
    head.append(el('span', 't-label', 'Points'), el('span', 'board__clock t-num', '09:24'));
    this.clock = head.querySelector('.board__clock');
    this.pointsValue = el('div', 'board__points t-num', '0');
    this.roster = el('ol', 'board__roster');
    this.board.append(head, this.pointsValue, this.roster);
    this.node.appendChild(this.board);

    // ---- transient
    this.trick = el('div', 'trick');
    this.node.appendChild(this.trick);
    this.flashNode = el('div', 'flash');
    this.node.appendChild(this.flashNode);
    this.promptNode = el('div', 'prompt');
    this.node.appendChild(this.promptNode);

    this.hint = el('div', 'clicktoplay');
    this.hint.innerHTML = '<b>Click to play</b><span>W walk · F use · mouse look</span>';
    this.node.appendChild(this.hint);

    this.debug = el('div', 'debug');
    this.node.appendChild(this.debug);
  }

  makeBar(label, kind) {
    const node = el('div', `bar bar--${kind}`);
    const l = el('div', 't-label', label);
    const track = el('div', 'bar__track');
    const fill = el('i', 'bar__fill');
    track.appendChild(fill);
    node.append(l, track);
    return { node, fill };
  }

  buildRail() {
    const svg = this.railSvg;
    svg.textContent = '';
    const H = 400, top = 16, bottom = 384;
    const yFor = (elev) => bottom - ((elev - BASE_ELEV) / (SUMMIT_ELEV - BASE_ELEV)) * (bottom - top);

    // The mountain itself: a spine with a tick every 50 m and a label every 100.
    svg.appendChild(svgEl('line', {
      x1: 26, y1: top, x2: 26, y2: bottom, stroke: 'rgba(242,245,248,0.42)', 'stroke-width': 1.2,
    }));
    for (let e = BASE_ELEV; e <= SUMMIT_ELEV + 1; e += 50) {
      const y = yFor(e);
      const major = (e - BASE_ELEV) % 100 === 0;
      svg.appendChild(svgEl('line', {
        x1: major ? 18 : 22, y1: y, x2: 26, y2: y,
        stroke: 'rgba(242,245,248,0.62)', 'stroke-width': 1.2,
      }));
      if (major) {
        const t = svgEl('text', {
          x: 15, y: y + 4.2, 'text-anchor': 'end', class: 'rail__tick',
        });
        t.textContent = Math.round(e - BASE_ELEV);
        svg.appendChild(t);
      }
    }

    // Each run as a thread, spanning exactly the altitudes it actually covers.
    const runs = this.game.terrain.runs;
    this.runThreads = [];
    runs.forEach((run, i) => {
      const x = 46 + i * 17;
      const y0 = yFor(run.topElev), y1 = yFor(run.bottomElev);
      const track = svgEl('line', {
        x1: x, y1: y0, x2: x, y2: y1,
        stroke: RUN_COLOURS[run.key] || '#888', 'stroke-width': 7, 'stroke-linecap': 'round',
        opacity: 0.95,
      });
      svg.appendChild(track);
      const label = svgEl('text', { x, y: y1 + 15, 'text-anchor': 'middle', class: 'rail__run' });
      label.textContent = run.key === 'blue' ? 'B' : run.key === 'red' ? 'R' : 'K';
      svg.appendChild(label);
      // Snow condition overlay, only drawn once you have bought the report.
      const wear = svgEl('path', { d: '', stroke: '#ffffff', 'stroke-width': 5, opacity: 0, fill: 'none' });
      svg.appendChild(wear);
      this.runThreads.push({ run, x, y0, y1, track, wear });
    });

    // Everyone on the mountain.
    this.otherMarks = svgEl('g', {});
    svg.appendChild(this.otherMarks);

    // You.
    this.mark = svgEl('g', {});
    this.mark.appendChild(svgEl('line', { x1: 16, y1: 0, x2: 88, y2: 0, stroke: 'var(--sun)', 'stroke-width': 1.6 }));
    this.mark.appendChild(svgEl('polygon', { points: '8,-6 20,0 8,6', fill: 'var(--sun)' }));
    svg.appendChild(this.mark);

    this.yFor = yFor;
  }

  /** The snow report overlay on the rail, once you have bought it at the cafe. */
  toggleMap() {
    const g = this.game;
    if (!g.state.consumables.map) {
      this.flash('The snow report is sold at the cafe counter.');
      return;
    }
    this.mapOn = !this.mapOn;
    this.flash(this.mapOn ? 'Snow report on.' : 'Snow report off.');
  }

  setLocked(locked) {
    this.locked = locked;
    this.hint.style.display = locked ? 'none' : '';
    this.node.classList.toggle('hud--playing', locked);
  }

  flash(text) {
    this.flashNode.textContent = text;
    this.flashNode.classList.add('flash--on');
    this.flashTimer = 3.2;
  }

  showTrick({ name, score, combo }) {
    this.trick.innerHTML = '';
    const n = el('div', 'trick__name', name);
    const s = el('div', 'trick__score t-num', `+${score}`);
    this.trick.append(n, s);
    if (combo > 1) this.trick.append(el('div', 'trick__combo', `${combo}× in a row`));
    this.trick.classList.add('trick--on');
    this.trickTimer = 2.0;
  }

  update(dt) {
    const g = this.game;
    const s = g.skier;
    const t = s.telemetry;

    // rail
    const y = this.yFor(s.pos.y);
    this.mark.setAttribute('transform', `translate(0 ${y})`);
    this.altValue.textContent = Math.round(Math.max(0, s.pos.y - BASE_ELEV));

    if (g.state.consumables.map && this.mapOn !== false) {
      for (const th of this.runThreads) {
        const cond = this.sampleRunCondition(th.run);
        th.wear.setAttribute('opacity', '0.9');
        th.wear.setAttribute('d', th.d || '');
        th.track.setAttribute('stroke', cond < 0.35 ? 'var(--ice)' : RUN_COLOURS[th.run.key]);
        th.track.setAttribute('opacity', String(0.45 + cond * 0.5));
      }
    }

    // others
    const others = g.session.others;
    if (others.length !== this.otherMarks.childElementCount) {
      this.otherMarks.textContent = '';
      for (let i = 0; i < others.length; i++) {
        const gmark = svgEl('g');
        gmark.appendChild(svgEl('circle', { cx: 26, cy: 0, r: 3.6, fill: '#fff' }));
        this.otherMarks.appendChild(gmark);
      }
    }
    others.forEach((o, i) => {
      const node = this.otherMarks.children[i];
      if (!node) return;
      node.setAttribute('transform', `translate(0 ${this.yFor(o.y)})`);
      node.firstChild.setAttribute('fill', o.colour || '#fff');
    });

    // vitals
    this.coldBar.fill.style.transform = `scaleX(${Math.max(0, s.warmth)})`;
    this.coldBar.node.classList.toggle('bar--warning', s.warmth < 0.3);
    this.staminaBar.fill.style.transform = `scaleX(${Math.max(0, s.stamina)})`;

    // speed
    const kmh = Math.round(t.speed * 3.6);
    this.speedValue.textContent = kmh;
    this.surface.textContent = g.equipped ? t.surface : 'on foot';
    this.speedBox.classList.toggle('speed--fast', kmh > 55);

    // score
    this.pointsValue.textContent = Math.round(g.state.points).toLocaleString('en-GB');
    const hour = Math.floor(g.sky.hour);
    const minute = Math.floor((g.sky.hour % 1) * 60);
    this.clock.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    this.updateRoster();

    // prompt
    const p = g.prompt;
    if (p) {
      this.promptNode.innerHTML = p.key
        ? `<kbd>${p.key}</kbd><span>${p.text}</span>`
        : `<span>${p.text}</span>`;
      this.promptNode.classList.toggle('prompt--blocked', !!p.blocked);
      this.promptNode.classList.add('prompt--on');
    } else {
      this.promptNode.classList.remove('prompt--on');
    }

    // transient
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashNode.classList.remove('flash--on');
    }
    if (this.trickTimer > 0) {
      this.trickTimer -= dt;
      if (this.trickTimer <= 0) this.trick.classList.remove('trick--on');
    }

    // cold vignette: the screen loses colour before you do
    const chill = Math.max(0, 1 - s.warmth * 1.4);
    this.node.style.setProperty('--chill', chill.toFixed(3));

    // The HUD gets out of the way once you are moving. It is at full size while
    // you are stood in the resort reading it, and three quarters of that by the
    // time the mountain is worth looking at instead.
    const riding = g.equipped && t.speed > 4 && !g.panels.isOpen;
    const wantScale = riding ? 0.74 : 1;
    this.hudScale = this.hudScale === undefined
      ? wantScale
      : this.hudScale + (wantScale - this.hudScale) * Math.min(1, dt * 4);
    this.node.style.setProperty('--hud', this.hudScale.toFixed(3));
    this.node.classList.toggle('hud--riding', riding);

    this.updateDebug();
  }

  sampleRunCondition(run) {
    const snow = this.game.snow;
    let sum = 0, n = 0;
    for (let i = 0; i < run.line.length; i += 24) {
      const [x, z] = run.line[i];
      sum += snow.surfaceAt(x, z).cond;
      n++;
    }
    return n ? sum / n : 1;
  }

  updateRoster() {
    const g = this.game;
    const rows = [{ name: g.state.name, points: g.state.points, you: true, colour: g.state.colours.jacket },
      ...g.session.others.map((o) => ({ name: o.name, points: o.points || 0, colour: o.colour }))];
    rows.sort((a, b) => b.points - a.points);
    if (rows.length !== this.roster.childElementCount) {
      this.roster.textContent = '';
      for (const _ of rows) {
        const li = el('li', 'board__row');
        li.append(el('i', 'board__dot'), el('span', 'board__name'), el('span', 'board__score t-num'));
        this.roster.appendChild(li);
      }
    }
    rows.forEach((r, i) => {
      const li = this.roster.children[i];
      if (!li) return;
      li.classList.toggle('board__row--you', !!r.you);
      li.children[0].style.background = r.colour || '#fff';
      li.children[1].textContent = r.name;
      li.children[2].textContent = Math.round(r.points).toLocaleString('en-GB');
    });
    this.roster.style.display = rows.length > 1 ? '' : 'none';
  }

  updateDebug() {
    this._acc = (this._acc || 0) + 1;
    if (this._acc % 15) return;
    if (!this.showDebug) { this.debug.style.display = 'none'; return; }
    this.debug.style.display = '';
    const g = this.game;
    this.debug.textContent = [
      `${g.engine.stats.fps.toFixed(0)} fps · ${g.engine.stats.frameMs.toFixed(1)} ms · ${g.engine.quality.name}`,
      `${g.engine.stats.drawCalls} draws · ${(g.engine.stats.tris / 1000).toFixed(0)}k tris`,
      `${g.skier.mode} · ${(g.skier.telemetry.speed * 3.6).toFixed(0)} km/h`,
    ].join('\n');
  }
}
