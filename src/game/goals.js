// The day's work.
//
// A room of five people skiing a mountain is five people skiing a mountain. The
// snow already gives them a reason to look at each other's lines, but nothing
// gave them a reason to DO anything together: points were private, the groomer
// was a private job, and the only shared object in the game was the snow itself.
//
// Three objectives per session fix that, and they are deliberately the kind that
// nobody can finish alone in a sensible time. Every one of them is measured from
// something the game already counts, and every one of them is a SUM ACROSS THE
// ROOM — the groomer driver and the tricks kid are working on the same board.
//
// There is no host authority here and there does not need to be. Each player
// broadcasts their own tallies and every client adds up what it has; a sum of
// per-player numbers cannot disagree with itself, and a player who drops out
// takes exactly their own contribution with them.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Every goal reads one field out of a player's tally and sums it, except the
 * ones that ask about each player separately.
 *
 * `per` marks a goal whose target is per-player rather than for the room, so a
 * room of one is not asked to do a room of five's work.
 */
const CATALOGUE = [
  {
    key: 'groom',
    text: (n) => `Groom ${(n / 1000).toFixed(1)}k m² of piste between you`,
    field: 'groom',
    base: 3200, per: 1400, unit: 'm²',
    reward: 320,
  },
  {
    key: 'fresh',
    text: (n) => `Cut ${Math.round(n)} m of first tracks`,
    field: 'fresh',
    base: 500, per: 260, unit: 'm',
    reward: 300,
  },
  {
    key: 'tricks',
    text: (n) => `Land ${Math.round(n)} tricks`,
    field: 'tricks',
    base: 8, per: 5,
    reward: 260,
  },
  {
    key: 'gates',
    text: (n) => `Take ${Math.round(n)} gates`,
    field: 'gates',
    base: 24, per: 14,
    reward: 240,
  },
  {
    key: 'vertical',
    text: (n) => `Ski ${(n / 1000).toFixed(1)}k m of vertical`,
    field: 'vertical',
    base: 1600, per: 900, unit: 'm',
    reward: 280,
  },
  {
    key: 'black',
    text: () => 'Everyone down Ostrze at least once',
    field: 'black',
    everyone: true,
    reward: 400,
  },
  {
    key: 'chair',
    text: (n) => `Ride the chair together for ${Math.round(n)} s`,
    field: 'together',
    base: 45, per: 0, unit: 's',
    needsCompany: true,
    reward: 300,
  },
];

function seededPick(list, count, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0;
    return s / 4294967296;
  };
  const pool = [...list];
  const out = [];
  while (out.length < count && pool.length) {
    out.push(pool.splice((rand() * pool.length) | 0, 1)[0]);
  }
  return out;
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class GoalBoard {
  constructor(game) {
    this.game = game;
    this.roomKey = null;
    this.goals = [];
    this.headcount = 1;
    // What this player has done. Sent to everyone else as-is; the numbers are
    // small and they are the only thing the board needs.
    this.tally = { groom: 0, fresh: 0, tricks: 0, gates: 0, vertical: 0, black: 0, together: 0 };
    this._lastPos = null;
    this._lastAlt = null;
    this.onChange = null;
    this.reseed('solo');

  }

  /**
   * The goals are drawn from the room code, so everyone in a room sees the same
   * three without a single packet being sent about it — and a new room is a new
   * day's work rather than the same three every time.
   */
  reseed(roomKey) {
    if (this.roomKey === roomKey) return;
    this.roomKey = roomKey;
    const picked = seededPick(CATALOGUE, 3, hashString(roomKey || 'solo'));
    this.goals = picked.map((def) => ({ def, done: false, progress: 0, target: 0 }));
    this.onChange?.();
  }

  /** Everyone in the room, including us. */
  tallies() {
    const out = [this.tally];
    for (const r of this.game.session.remotes.values()) if (r.tally) out.push(r.tally);
    return out;
  }

  targetFor(def, heads) {
    if (def.everyone) return heads;
    return def.base + def.per * Math.max(0, heads - 1);
  }

  update(dt) {
    const g = this.game;
    const s = g.skier;
    this.reseed(g.session.room || 'solo');
    const heads = 1 + g.session.remotes.size;
    this.headcount = heads;

    // --- our own contribution, read from the counters the game already keeps
    // rather than declared by whoever remembers to declare it
    this.tally.groom = Math.round(g.state.groomedArea);
    this.tally.tricks = g.state.tricks;
    this.tally.gates = g.state.gatesTaken;

    if (this._lastPos) {
      const step = Math.hypot(s.pos.x - this._lastPos.x, s.pos.z - this._lastPos.z);
      if (step < 20 && s.mode !== 'lift' && s.mode !== 'groomer' && g.equipped) {
        // First tracks: snow nobody has cut yet. This is the one metric only
        // this game can offer, because only this game remembers.
        const surface = g.snow.surfaceAt(s.pos.x, s.pos.z);
        if (surface.carve < 0.02 && surface.cond > 0.72 && s.telemetry.speed > 4) {
          this.tally.fresh += step;
        }
      }
      const drop = this._lastAlt - s.pos.y;
      if (drop > 0 && drop < 8 && s.mode !== 'lift') this.tally.vertical += drop;
    }
    this._lastPos = { x: s.pos.x, z: s.pos.z };
    this._lastAlt = s.pos.y;

    // Down the black at least once: measured where the black actually is.
    if (!this.tally.black && g.equipped && s.mode === 'ride') {
      const piste = g.sampler.samplePiste(s.pos.x, s.pos.z);
      if (piste === 3) this._blackTime = (this._blackTime || 0) + dt;
      if ((this._blackTime || 0) > 6) this.tally.black = 1;
    }

    // Riding the chair with somebody. Five to a chair, so "together" means close
    // enough to be on the same one.
    if (s.mode === 'lift') {
      for (const r of g.session.remotes.values()) {
        if (!r.state || r.state.m !== 'lift') continue;
        const d = Math.hypot(r.state.x - s.pos.x, r.state.z - s.pos.z);
        if (d < 14) { this.tally.together += dt; break; }
      }
    }

    // --- the board
    const all = this.tallies();
    let changed = false;
    for (const goal of this.goals) {
      const def = goal.def;
      goal.target = this.targetFor(def, heads);
      const previous = goal.progress;
      if (def.everyone) {
        goal.progress = all.reduce((a, t) => a + (t[def.field] ? 1 : 0), 0);
      } else {
        goal.progress = all.reduce((a, t) => a + (t[def.field] || 0), 0);
      }
      goal.blocked = !!def.needsCompany && heads < 2;
      // The target moves when somebody joins or leaves, and the panel has to
      // follow that as well as the progress — otherwise a board built before the
      // first update sits there reading "0 / 0" for the whole session.
      if (Math.abs(goal.progress - previous) > 0.5 || goal.target !== goal._shownTarget) {
        goal._shownTarget = goal.target;
        changed = true;
      }
      if (!goal.done && !goal.blocked && goal.progress >= goal.target) {
        goal.done = true;
        changed = true;
        // Everyone who is in the room is paid, because everyone in the room did
        // it. That is the entire point of the board.
        g.award(def.reward, 'Day\'s work');
        g.hud?.flash(`Done: ${this.label(goal)} — everyone takes ${def.reward}.`);
      }
    }
    if (changed) this.onChange?.();
  }

  label(goal) {
    return goal.def.text(goal.target);
  }

  /** What the HUD draws. */
  rows() {
    return this.goals.map((goal) => ({
      text: this.label(goal),
      done: goal.done,
      blocked: goal.blocked,
      fraction: goal.target > 0 ? clamp(goal.progress / goal.target, 0, 1) : 0,
      detail: goal.def.everyone
        ? `${Math.min(goal.progress, goal.target)}/${goal.target}`
        : `${Math.round(Math.min(goal.progress, goal.target))}${goal.def.unit ? ' ' + goal.def.unit : ''}`
          + ` / ${Math.round(goal.target)}`,
    }));
  }
}
