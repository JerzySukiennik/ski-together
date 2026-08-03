// The rental shop's stock.
//
// Three numbers decide how a ski or a board rides, and all three are printed on
// the rack so nothing is hidden:
//
//   turnRadius  how tight an arc it can hold, in metres. Small = darty.
//   topSpeed    how fast it will run before the base gives up, in m/s.
//   edgeGrip    how hard it bites. This is what saves you on ice.
//
// Sport shapes are fast and stable but swing wide and punish mistakes.
// Manoeuvrable shapes turn like a toy and run out of grip when it gets steep.

export const TIER_NAMES = ['Rental', 'Performance', 'Race room'];

export const SKIS = [
  {
    id: 'ski-piste74', kind: 'ski', tier: 0, price: 0, style: 'All-mountain',
    name: 'Alpina Piste 74', short: 'Piste 74',
    turnRadius: 16, topSpeed: 22, edgeGrip: 0.95, weight: 1.0,
    blurb: 'The pair everybody starts on. Nothing it does will surprise you.',
    colours: ['#e8e9ec', '#2e6fd9'],
  },
  {
    id: 'ski-slalom63', kind: 'ski', tier: 0, price: 0, style: 'Manoeuvrable',
    name: 'Alpina Slalom 63', short: 'Slalom 63',
    turnRadius: 11, topSpeed: 19.5, edgeGrip: 1.0, weight: 0.92,
    blurb: 'Turns almost on the spot. Give it speed and it starts arguing.',
    colours: ['#f2f5f8', '#d3352c'],
  },
  {
    id: 'ski-giant84', kind: 'ski', tier: 1, price: 900, style: 'Sport',
    name: 'Corniche Giant 84', short: 'Giant 84',
    turnRadius: 22, topSpeed: 26, edgeGrip: 1.05, weight: 1.14,
    blurb: 'Long arcs, quiet at speed. Needs room to do anything at all.',
    colours: ['#16202b', '#ffb23f'],
  },
  {
    id: 'ski-carve68', kind: 'ski', tier: 1, price: 900, style: 'Manoeuvrable',
    name: 'Corniche Carve 68', short: 'Carve 68',
    turnRadius: 12.5, topSpeed: 22.5, edgeGrip: 1.15, weight: 0.98,
    blurb: 'Bites hard for something this short. Happiest on hard snow.',
    colours: ['#0f5f52', '#f2f5f8'],
  },
  {
    id: 'ski-downhill92', kind: 'ski', tier: 2, price: 2600, style: 'Sport',
    name: 'Kolej Downhill 92', short: 'Downhill 92',
    turnRadius: 30, topSpeed: 30, edgeGrip: 1.1, weight: 1.3,
    blurb: 'Built for one thing. On the black it is the fastest thing here.',
    colours: ['#0c0f13', '#d3352c'],
  },
  {
    id: 'ski-race66', kind: 'ski', tier: 2, price: 2600, style: 'Manoeuvrable',
    name: 'Kolej Race 66', short: 'Race 66',
    turnRadius: 13, topSpeed: 25, edgeGrip: 1.3, weight: 1.05,
    blurb: 'Holds an edge on ice that throws everything else off the run.',
    colours: ['#f2f5f8', '#16202b'],
  },
];

export const BOARDS = [
  {
    id: 'brd-freeride156', kind: 'board', tier: 0, price: 0, style: 'All-mountain',
    name: 'Wierch Freeride 156', short: 'Freeride 156',
    turnRadius: 8.5, topSpeed: 20.5, edgeGrip: 0.92, weight: 1.0,
    blurb: 'Floats in the deep stuff and forgives a lot on the way down.',
    colours: ['#2b3f55', '#c7d4e0'],
  },
  {
    id: 'brd-park148', kind: 'board', tier: 0, price: 0, style: 'Manoeuvrable',
    name: 'Wierch Park 148', short: 'Park 148',
    turnRadius: 6.5, topSpeed: 18.5, edgeGrip: 0.95, weight: 0.9,
    blurb: 'Short, light and made to spin. Rides switch without complaining.',
    colours: ['#ffb23f', '#16202b'],
  },
  {
    id: 'brd-all160', kind: 'board', tier: 1, price: 900, style: 'All-mountain',
    name: 'Turnia All-Mountain 160', short: 'All-Mtn 160',
    turnRadius: 9.5, topSpeed: 24, edgeGrip: 1.05, weight: 1.1,
    blurb: 'The one you keep reaching for once you can link turns properly.',
    colours: ['#0f5f52', '#f2f5f8'],
  },
  {
    id: 'brd-twin152', kind: 'board', tier: 1, price: 900, style: 'Manoeuvrable',
    name: 'Turnia Twin 152', short: 'Twin 152',
    turnRadius: 7.0, topSpeed: 21, edgeGrip: 1.12, weight: 0.95,
    blurb: 'Identical nose and tail. Landing backwards is not a mistake on this.',
    colours: ['#d3352c', '#f2f5f8'],
  },
  {
    id: 'brd-freecarve168', kind: 'board', tier: 2, price: 2600, style: 'Sport',
    name: 'Granica Freecarve 168', short: 'Freecarve 168',
    turnRadius: 12, topSpeed: 28, edgeGrip: 1.12, weight: 1.24,
    blurb: 'Lays a trench you can see from the chairlift. Wants commitment.',
    colours: ['#16202b', '#2e6fd9'],
  },
  {
    id: 'brd-race158', kind: 'board', tier: 2, price: 2600, style: 'Manoeuvrable',
    name: 'Granica Race 158', short: 'Race 158',
    turnRadius: 8.0, topSpeed: 24.5, edgeGrip: 1.3, weight: 1.08,
    blurb: 'Race plate under your feet. Ice stops being a problem.',
    colours: ['#f2f5f8', '#0c0f13'],
  },
];

export const BOOTS = [
  {
    id: 'boot-ski', kind: 'boot', fits: 'ski', tier: 0, price: 0,
    name: 'Ski boots', short: 'Ski boots', warmth: 1.0, walkSpeed: 0.78,
    blurb: 'Four buckles, no give. Walking in these is its own punishment.',
  },
  {
    id: 'boot-board', kind: 'boot', fits: 'board', tier: 0, price: 0,
    name: 'Snowboard boots', short: 'Board boots', warmth: 1.15, walkSpeed: 1.0,
    blurb: 'Soft and laced. You can actually walk to the cafe in them.',
  },
];

export const HELMETS = [
  {
    id: 'helmet-rental', kind: 'helmet', tier: 0, price: 0,
    name: 'Rental helmet', short: 'Rental', warmth: 1.0,
    blurb: 'Scuffed, safe, and free with any set.',
    colours: ['#16202b'],
  },
  {
    id: 'helmet-vent', kind: 'helmet', tier: 1, price: 450,
    name: 'Vented helmet', short: 'Vented', warmth: 0.92,
    blurb: 'Lighter, with a proper visor. Colder on a still evening.',
    colours: ['#f2f5f8'],
  },
  {
    id: 'helmet-lined', kind: 'helmet', tier: 1, price: 620,
    name: 'Lined helmet', short: 'Lined', warmth: 1.35,
    blurb: 'Fleece-lined ear pads. Buys you a long run after dark.',
    colours: ['#ffb23f'],
  },
];

export const JACKETS = [
  { id: 'jacket-shell', name: 'Rental shell', warmth: 1.0, price: 0, blurb: 'It keeps the wind out. That is the whole review.' },
  { id: 'jacket-insulated', name: 'Insulated jacket', warmth: 1.5, price: 700, blurb: 'Real loft. The cold bar drains at two thirds the rate.' },
  { id: 'jacket-down', name: 'Down parka', warmth: 2.1, price: 1800, blurb: 'Overkill at noon. Exactly right under the floodlights.' },
];

export const CONSUMABLES = [
  { id: 'tea', name: 'Hot tea', price: 60, blurb: 'Refills your warmth on the spot. Buy two.', effect: 'warm' },
  { id: 'snowmap', name: 'Snow report', price: 240, blurb: 'Puts live snow condition on the piste rail. See the ice before you find it.', effect: 'map' },
  { id: 'groomer-key', name: 'Groomer key', price: 0, blurb: 'Free from the counter. Whoever holds it can take the machine out.', effect: 'groomer' },
];

export const ALL_GEAR = [...SKIS, ...BOARDS, ...BOOTS, ...HELMETS];
export const byId = new Map(ALL_GEAR.map((g) => [g.id, g]));

export function gearFor(id) {
  return byId.get(id) || null;
}

/** The boots that go with whatever you picked up off the rack. */
export function bootFor(boardId) {
  const b = gearFor(boardId);
  if (!b) return null;
  return b.kind === 'board' ? 'boot-board' : 'boot-ski';
}

/** A complete, legal set. The lift will not take you without one. */
export function validateSet(set) {
  const missing = [];
  const board = gearFor(set.board);
  const boot = gearFor(set.boot);
  const helmet = gearFor(set.helmet);
  if (!helmet) missing.push('a helmet');
  if (!board) missing.push('skis or a board');
  if (!boot) missing.push('boots');
  if (board && boot && boot.fits !== board.kind) {
    return {
      ok: false,
      reason: boot.fits === 'ski'
        ? 'Ski boots do not go into snowboard bindings. Swap one of them.'
        : 'Snowboard boots do not go into ski bindings. Swap one of them.',
    };
  }
  if (missing.length) {
    return { ok: false, reason: `You still need ${missing.join(' and ')}.` };
  }
  return { ok: true, reason: '' };
}

export function ridingStats(set) {
  const board = gearFor(set.board);
  const boot = gearFor(set.boot);
  const helmet = gearFor(set.helmet);
  const jacket = JACKETS.find((j) => j.id === set.jacket) || JACKETS[0];
  if (!board) return null;
  return {
    kind: board.kind,
    turnRadius: board.turnRadius,
    topSpeed: board.topSpeed,
    edgeGrip: board.edgeGrip,
    weight: board.weight,
    walkSpeed: boot?.walkSpeed ?? 0.8,
    warmth: (boot?.warmth ?? 1) * 0.25 + (helmet?.warmth ?? 1) * 0.25 + jacket.warmth * 0.5,
  };
}
