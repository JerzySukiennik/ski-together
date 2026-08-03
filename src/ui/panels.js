import { SKIS, BOARDS, HELMETS, JACKETS, CONSUMABLES, bootFor, gearFor, validateSet, TIER_NAMES } from '../gear/catalog.js';
import { QUALITY_LEVELS } from '../core/engine.js';

// The panels you walk into a building to open: the rental shop, the colour booth
// and the cafe counter. They are laid out as enamel signage plates — the same
// language as the trail signs outside — and they never cover the middle of the
// screen, because the point of standing in the shop is seeing what your friends
// picked up off the rack.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const PALETTE = [
  '#d3352c', '#e2622f', '#ffb23f', '#f2f5f8', '#c7d4e0', '#4f9ad6',
  '#2e6fd9', '#26407a', '#16202b', '#0f5f52', '#5aa860', '#8d4f9e',
];

export class Panels {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.node = el('div', 'panel-layer');
    this.current = null;
    root.appendChild(this.node);

    this.draft = {
      board: 'ski-piste74',
      boot: bootFor('ski-piste74'),
      helmet: 'helmet-rental',
      jacket: 'jacket-shell',
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.isOpen) this.close();
        else this.open('menu');
      }
    });
  }

  get isOpen() { return this.current !== null; }

  open(kind, focus = null) {
    if (this.current === kind) return;
    this.focus = focus;
    this.close();
    this.current = kind;
    this.game.input.exitPointerLock();
    const build = {
      rental: () => this.buildRental(),
      booth: () => this.buildBooth(),
      cafe: () => this.buildCafe(),
      menu: () => this.buildMenu(),
    }[kind];
    if (!build) { this.current = null; return; }
    this.node.appendChild(build());
    this.node.classList.add('panel-layer--on');
    if (this.focus) {
      const target = this.node.querySelector(`[data-section="${this.focus}"]`);
      if (target) target.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
    // The readouts are for the slope, not for the shop counter.
    this.game.hud?.node.classList.add('hud--hidden');
  }

  close() {
    this.node.textContent = '';
    this.node.classList.remove('panel-layer--on');
    this.game.hud?.node.classList.remove('hud--hidden');
    this.current = null;
  }

  shell(title, subtitle, band) {
    const wrap = el('section', 'panel');
    wrap.style.setProperty('--panel-band', band);
    const head = el('header', 'panel__head');
    head.append(el('h2', 'panel__title', title), el('p', 'panel__sub', subtitle));
    const close = el('button', 'panel__close', 'Close');
    close.addEventListener('click', () => this.close());
    head.appendChild(close);
    wrap.appendChild(head);
    const bodyNode = el('div', 'panel__body');
    wrap.appendChild(bodyNode);
    return { wrap, body: bodyNode };
  }

  // ---------------------------------------------------------------- rental

  statRow(label, value, max, invert = false) {
    const row = el('div', 'stat');
    row.append(el('span', 'stat__label', label));
    const track = el('div', 'stat__track');
    const fill = el('i', 'stat__fill');
    const norm = Math.max(0.04, Math.min(1, value / max));
    fill.style.width = `${(invert ? 1 - norm + 0.08 : norm) * 100}%`;
    track.appendChild(fill);
    row.append(track, el('span', 'stat__value t-num', String(value)));
    return row;
  }

  gearCard(item, slot) {
    const owned = this.game.state.owned.has(item.id);
    const card = el('button', 'card');
    card.classList.toggle('card--locked', !owned);
    card.classList.toggle('card--picked', this.draft[slot] === item.id);
    card.disabled = !owned;

    const top = el('div', 'card__top');
    top.append(el('span', 'card__name', item.short || item.name));
    if (item.style) top.append(el('span', 'card__style', item.style));
    card.appendChild(top);

    if (item.turnRadius) {
      const stats = el('div', 'card__stats');
      stats.append(
        this.statRow('Turn radius', item.turnRadius, 32, true),
        this.statRow('Top speed', Math.round(item.topSpeed * 3.6), 115),
        this.statRow('Edge grip', Math.round(item.edgeGrip * 100), 140),
      );
      card.appendChild(stats);
    }
    card.appendChild(el('p', 'card__blurb', item.blurb || ''));
    if (!owned) {
      card.appendChild(el('div', 'card__lock', `${TIER_NAMES[item.tier]} — unlock at the cafe for ${item.price}`));
    }
    card.addEventListener('click', () => {
      this.draft[slot] = item.id;
      // Boots are not a choice: ski boots do not go into snowboard bindings and
      // nobody ever wanted to pick them separately. Taking a pair off the rack
      // hands you the boots that fit it.
      if (slot === 'board') this.draft.boot = bootFor(item.id);
      this.refreshRental();
    });
    return card;
  }

  buildRental() {
    const { wrap, body } = this.shell('Rental', 'Pick a helmet, boots, and something to ride. The lift will check.', 'var(--sun)');
    this.rentalBody = body;
    this.refreshRental();
    return wrap;
  }

  refreshRental() {
    const body = this.rentalBody;
    if (!body) return;
    body.textContent = '';

    const rack = (title, note, items, slot) => {
      const sec = el('div', 'rack');
      const h = el('div', 'rack__head');
      h.append(el('h3', 't-label', title));
      if (note) h.append(el('span', 'rack__note', note));
      sec.appendChild(h);
      const row = el('div', 'rack__row');
      for (const it of items) row.appendChild(this.gearCard(it, slot));
      sec.appendChild(row);
      return sec;
    };

    body.appendChild(rack('Skis', 'On the rack by the window', SKIS, 'board'));
    body.appendChild(rack('Snowboards', 'On the wall', BOARDS, 'board'));

    body.appendChild(rack('Helmets', 'Not optional', HELMETS, 'helmet'));
    body.appendChild(rack('Jackets', 'Warmth, and nothing else', JACKETS.map((j) => ({
      ...j, short: j.name, tier: 0,
    })), 'jacket'));

    const footer = el('footer', 'panel__foot');
    const check = validateSet(this.draft);
    const msg = el('p', 'panel__msg', check.ok ? this.setSummary() : check.reason);
    msg.classList.toggle('panel__msg--bad', !check.ok);
    const take = el('button', 'btn btn--primary', 'Take this set');
    take.disabled = !check.ok;
    take.addEventListener('click', () => {
      const res = this.game.equip({ ...this.draft });
      if (res.ok) {
        this.game.hud.flash('Set taken. The lift is outside.');
        this.close();
      }
    });
    footer.append(msg, take);
    body.appendChild(footer);
  }

  setSummary() {
    const b = gearFor(this.draft.board);
    const boot = gearFor(this.draft.boot);
    if (b && boot) {
      return `${b.name} with ${boot.short.toLowerCase()} — ${b.turnRadius} m turns, `
        + `${Math.round(b.topSpeed * 3.6)} km/h, grip ${Math.round(b.edgeGrip * 100)}.`;
    }
    return `${b.name} — ${b.turnRadius} m turns, ${Math.round(b.topSpeed * 3.6)} km/h, grip ${Math.round(b.edgeGrip * 100)}.`;
  }

  // ---------------------------------------------------------------- booth

  buildBooth() {
    const { wrap, body } = this.shell('Colours', 'So your friends can find you from the chairlift.', 'var(--blue)');
    const rows = [
      ['jacket', 'Jacket'],
      ['trousers', 'Trousers'],
      ['helmet', 'Helmet'],
      ['gear', 'Skis / board'],
    ];
    for (const [key, label] of rows) {
      const sec = el('div', 'swatches');
      sec.appendChild(el('h3', 't-label', label));
      const row = el('div', 'swatches__row');
      for (const colour of PALETTE) {
        const b = el('button', 'swatch');
        b.style.background = colour;
        b.classList.toggle('swatch--on', this.game.state.colours[key] === colour);
        b.setAttribute('aria-label', `${label} ${colour}`);
        b.addEventListener('click', () => {
          this.game.state.colours[key] = colour;
          this.game.avatar.setColours(this.game.state.colours);
          for (const other of row.children) other.classList.remove('swatch--on');
          b.classList.add('swatch--on');
          this.game.session.broadcastIdentity();
        });
        row.appendChild(b);
      }
      sec.appendChild(row);
      body.appendChild(sec);
    }

    const nameRow = el('div', 'field');
    nameRow.appendChild(el('h3', 't-label', 'Name over your head'));
    const input = el('input', 'field__input');
    input.value = this.game.state.name;
    input.maxLength = 14;
    input.addEventListener('input', () => {
      this.game.state.name = input.value.trim() || 'Skier';
      this.game.session.broadcastIdentity();
    });
    nameRow.appendChild(input);
    body.appendChild(nameRow);
    return wrap;
  }

  // ---------------------------------------------------------------- cafe

  buildCafe() {
    const { wrap, body } = this.shell('Cafe', 'Points in, something useful out. Nothing carries to tomorrow.', 'var(--red)');
    this.cafeBody = body;
    this.refreshCafe();
    return wrap;
  }

  refreshCafe() {
    const body = this.cafeBody;
    if (!body) return;
    body.textContent = '';
    const g = this.game;

    const shelf = (title, note, items, render) => {
      const sec = el('div', 'rack');
      const h = el('div', 'rack__head');
      h.append(el('h3', 't-label', title));
      if (note) h.append(el('span', 'rack__note', note));
      sec.appendChild(h);
      const row = el('div', 'rack__row');
      for (const it of items) row.appendChild(render(it));
      sec.appendChild(row);
      return sec;
    };

    const buyCard = (item, onBuy, owned, priceLabel) => {
      const card = el('button', 'card card--buy');
      card.append(el('div', 'card__top', ''));
      card.firstChild.append(el('span', 'card__name', item.short || item.name));
      card.append(el('p', 'card__blurb', item.blurb || ''));
      const price = el('div', 'card__price t-num', owned ? 'Owned' : priceLabel);
      card.appendChild(price);
      card.classList.toggle('card--owned', owned);
      card.disabled = owned || g.state.points < item.price;
      card.addEventListener('click', () => { onBuy(); this.refreshCafe(); });
      return card;
    };

    const lockedGear = [...SKIS, ...BOARDS, ...HELMETS].filter((i) => !g.state.owned.has(i.id));
    if (lockedGear.length) {
      body.appendChild(shelf('Gear', 'Unlock it here, then collect it at the rental shop',
        lockedGear, (item) => buyCard(item, () => {
          if (g.spend(item.price)) {
            g.state.owned.add(item.id);
            g.hud.flash(`${item.short} unlocked. It is on the rack.`);
          }
        }, false, String(item.price))));
    }

    body.appendChild(shelf('The counter', 'Small things that change the next hour', CONSUMABLES,
      (item) => {
        const owned = item.effect === 'map' ? g.state.consumables.map
          : item.effect === 'groomer' ? g.state.consumables.groomerKey : false;
        return buyCard(item, () => {
          if (item.effect === 'warm') {
            if (g.spend(item.price)) { g.skier.warmth = 1; g.hud.flash('That is better.'); }
          } else if (item.effect === 'map') {
            if (g.spend(item.price)) { g.state.consumables.map = true; g.hud.flash('Snow report on the rail.'); }
          } else {
            g.state.consumables.groomerKey = true;
            g.hud.flash('Key taken. The machine is in the garage.');
          }
        }, owned, item.price ? String(item.price) : 'Free');
      }));

    const stats = el('div', 'tally');
    for (const [label, value] of [
      ['Points', Math.round(g.state.points)],
      ['Runs', g.state.descents],
      ['Tricks', g.state.tricks],
      ['Gates', g.state.gatesTaken],
      ['Snow restored', `${Math.round(g.state.groomedArea)} m²`],
      ['Crashes', g.state.crashes],
    ]) {
      const item = el('div', 'tally__item');
      item.append(el('span', 't-label', label), el('span', 'tally__value t-num', String(value)));
      stats.appendChild(item);
    }
    body.appendChild(stats);
  }

  // ---------------------------------------------------------------- menu

  buildMenu() {
    const { wrap, body } = this.shell('SKI Together', 'Paused. Nothing on the mountain is waiting for you.', 'var(--corduroy)');

    const controls = el('div', 'keys');
    for (const [k, what] of [
      ['W', 'Push along on the flat, walk in boots'],
      ['A / D', 'Set the edge — hold it to hold the arc'],
      ['S', 'Snowplough, and it really does stop you'],
      ['Shift', 'Tuck'],
      ['Space', 'Pop off the lip'],
      ['A / D / W / S in the air', 'Spin and flip'],
      ['E', 'Grab'],
      ['F', 'Use whatever you are standing at'],
      ['G', 'Wave'],
      ['Mouse', 'Look around, wheel to zoom'],
      ['Esc', 'This menu'],
    ]) {
      const row = el('div', 'keys__row');
      row.append(el('kbd', '', k), el('span', '', what));
      controls.appendChild(row);
    }
    body.appendChild(this.section('Controls', controls));

    // settings
    const settings = el('div', 'settings');
    const g = this.game;

    const quality = el('div', 'field');
    quality.appendChild(el('h3', 't-label', 'Detail'));
    const qRow = el('div', 'seg');
    const autoBtn = el('button', 'seg__btn', 'Auto');
    autoBtn.classList.toggle('seg__btn--on', g.engine.autoQuality);
    autoBtn.addEventListener('click', () => {
      g.engine.autoQuality = true;
      this.close();
      this.open('menu');
    });
    qRow.appendChild(autoBtn);
    QUALITY_LEVELS.forEach((q, i) => {
      const b = el('button', 'seg__btn', q.name);
      b.classList.toggle('seg__btn--on', !g.engine.autoQuality && g.engine.qualityIndex === i);
      b.addEventListener('click', () => {
        g.engine.setQuality(i, { manual: true });
        this.close();
        this.open('menu');
      });
      qRow.appendChild(b);
    });
    quality.appendChild(qRow);
    settings.appendChild(quality);

    settings.appendChild(this.slider('Time of day', 0, 24, g.sky.hour, 0.1, (v) => g.sky.setHour(v),
      (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`));
    settings.appendChild(this.toggle('Day moves on its own', !g.sky.paused, (on) => { g.sky.paused = !on; }));
    settings.appendChild(this.toggle('Sound', !g.audio.muted, (on) => g.audio.setMuted(!on)));
    settings.appendChild(this.toggle('Performance readout', !!g.hud.showDebug, (on) => { g.hud.showDebug = on; }));
    body.appendChild(this.section('Settings', settings));

    // multiplayer
    body.appendChild(this.section('Mountain', this.game.session.buildPanel()));

    const foot = el('footer', 'panel__foot');
    const resume = el('button', 'btn btn--primary', 'Back to the snow');
    resume.addEventListener('click', () => {
      this.close();
      this.game.input.requestPointerLock();
    });
    foot.append(el('p', 'panel__msg', 'Points last for this session only.'), resume);
    body.appendChild(foot);
    return wrap;
  }

  section(title, content) {
    const sec = el('div', 'section');
    sec.dataset.section = title.toLowerCase().split(' ')[0];
    sec.append(el('h3', 't-label', title), content);
    return sec;
  }

  slider(label, min, max, value, stepSize, onInput, format = (v) => v.toFixed(1)) {
    const row = el('div', 'field');
    const head = el('div', 'field__head');
    head.append(el('h3', 't-label', label));
    const out = el('span', 'field__value t-num', format(value));
    head.appendChild(out);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = stepSize; input.value = value;
    input.className = 'field__range';
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = format(v);
      onInput(v);
    });
    row.append(head, input);
    return row;
  }

  toggle(label, on, onChange) {
    const row = el('div', 'field field--toggle');
    row.appendChild(el('h3', 't-label', label));
    const btn = el('button', 'switch');
    btn.classList.toggle('switch--on', on);
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(on));
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('switch--on');
      btn.classList.toggle('switch--on', next);
      btn.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    row.appendChild(btn);
    return row;
  }
}
