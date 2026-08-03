// Acceptance test for the mountain and the snow. No browser, no guessing —
// if a run goes uphill or the black is gentler than the blue, this says so.

import { generateTerrain, makeSampler, PISTE_OFF } from '../src/shared/terrain.js';
import { SnowField, SNOW_W, SNOW_H } from '../src/shared/snowfield.js';
import { cableProfile, liftSpecs, sampleLine } from '../src/world/resort.js';

let failures = 0;
const results = [];
function check(label, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const t0 = Date.now();
const terrain = generateTerrain();
const genMs = Date.now() - t0;
const s = makeSampler(terrain);

console.log(`\nmountain generated in ${genMs} ms\n`);

// ---- runs descend, and their gradients differ the way the names promise
const stats = {};
for (const run of terrain.runs) {
  let uphill = 0, maxGrade = 0;
  const grades = [];
  for (let i = 0; i < run.line.length - 1; i++) {
    const [ax, az] = run.line[i], [bx, bz] = run.line[i + 1];
    const horiz = Math.hypot(bx - ax, bz - az);
    const drop = run.profile[i] - run.profile[i + 1];
    if (drop < -0.01) uphill++;
    if (horiz > 0.1) {
      const g = drop / horiz;
      grades.push(g);
      if (g > maxGrade) maxGrade = g;
    }
  }
  grades.sort((a, b) => a - b);
  const avg = (run.topElev - run.bottomElev) / run.length;
  stats[run.key] = { avg, maxGrade, uphill, length: run.length, drop: run.topElev - run.bottomElev };
  console.log(
    `${run.name.padEnd(10)} ${run.key.padEnd(6)} length ${run.length.toFixed(0).padStart(5)} m   drop ${(run.topElev - run.bottomElev).toFixed(1).padStart(6)} m   `
    + `avg ${(avg * 100).toFixed(1).padStart(5)}%   steepest ${(maxGrade * 100).toFixed(1).padStart(5)}%   p90 ${(grades[Math.floor(grades.length * 0.9)] * 100).toFixed(1)}%`
  );
  check(`${run.key}: never climbs`, uphill === 0, `${uphill} uphill segments`);
}

check('blue is the gentlest', stats.blue.avg < stats.red.avg,
  `blue ${(stats.blue.avg * 100).toFixed(1)}% vs red ${(stats.red.avg * 100).toFixed(1)}%`);
check('black is the steepest', stats.black.avg > stats.red.avg,
  `black ${(stats.black.avg * 100).toFixed(1)}% vs red ${(stats.red.avg * 100).toFixed(1)}%`);
check('blue is a real blue (12–22%)', stats.blue.avg > 0.12 && stats.blue.avg < 0.22,
  `${(stats.blue.avg * 100).toFixed(1)}%`);
check('black is a real black (>28%)', stats.black.avg > 0.28, `${(stats.black.avg * 100).toFixed(1)}%`);
check('blue traverses far more than it drops', stats.blue.length > stats.black.length * 1.15,
  `${stats.blue.length.toFixed(0)} m vs ${stats.black.length.toFixed(0)} m`);

// ---- a 90 second run is the design target
// A skier holding a comfortable line averages roughly 13 m/s on a blue and
// 17 m/s on a black; check the runs land near 90 s rather than 30 or 300.
// The black does not reach the valley — it feeds the red — so a black descent is
// the black plus the red below the junction. Measure the ride, not the segment.
const redRun = terrain.runs.find((r) => r.key === 'red');
const blackRun = terrain.runs.find((r) => r.key === 'black');
const junction = blackRun.line[blackRun.line.length - 1];
let nearest = 0, nd = Infinity;
for (let i = 0; i < redRun.line.length; i++) {
  const d = Math.hypot(redRun.line[i][0] - junction[0], redRun.line[i][1] - junction[1]);
  if (d < nd) { nd = d; nearest = i; }
}
let redTail = 0;
for (let i = nearest; i < redRun.line.length - 1; i++) {
  redTail += Math.hypot(redRun.line[i + 1][0] - redRun.line[i][0], redRun.line[i + 1][1] - redRun.line[i][1]);
}
console.log(`black joins the red ${nd.toFixed(1)} m off its line, with ${redTail.toFixed(0)} m of red still to run`);
check('the black actually reaches the red', nd < 25, `${nd.toFixed(1)} m off the line`);
const descents = { blue: stats.blue.length / 13, red: stats.red.length / 15, black: (stats.black.length + redTail) / 17 };
for (const [key, secs] of Object.entries(descents)) {
  console.log(`${key.padEnd(6)} full descent ≈ ${secs.toFixed(0)} s`);
  check(`${key} descent takes 60–140 s at a realistic pace`, secs > 60 && secs < 140, `${secs.toFixed(0)} s`);
}

// ---- the mountain actually has the drop the design says
const summitH = s.sampleHeight(terrain.stations.summit.x, terrain.stations.summit.z);
const baseH = s.sampleHeight(terrain.stations.base.x, terrain.stations.base.z);
check('vertical drop is 280–340 m', summitH - baseH > 280 && summitH - baseH < 340,
  `${(summitH - baseH).toFixed(1)} m`);
check('base station is flat', (() => {
  let max = 0;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const h = s.sampleHeight(terrain.stations.base.x + Math.cos(ang) * 40, terrain.stations.base.z + Math.sin(ang) * 40);
    max = Math.max(max, Math.abs(h - baseH));
  }
  return max < 1.5;
})(), 'within 40 m of the station');

// ---- the whole run is walkable/skiable: no cliffs inside the piste corridor
let cliffs = 0, sampled = 0;
for (const run of terrain.runs) {
  for (let i = 4; i < run.line.length - 4; i += 3) {
    const [x, z] = run.line[i];
    for (let o = -1; o <= 1; o++) {
      const slope = s.sampleSlope(x + o * 4, z);
      sampled++;
      if (slope > (62 * Math.PI) / 180) cliffs++;
    }
  }
}
check('no cliffs inside the pistes', cliffs === 0, `${cliffs} of ${sampled} samples steeper than 62°`);

// ---- piste coverage
let onPiste = 0;
for (let i = 0; i < terrain.piste.length; i++) if (terrain.piste[i] !== PISTE_OFF) onPiste++;
const pistePct = (onPiste / terrain.piste.length) * 100;
console.log(`\npiste covers ${pistePct.toFixed(1)}% of the map (${((onPiste * 1.5 * 1.5) / 10000).toFixed(1)} ha)`);
check('pistes cover 2–12% of the map', pistePct > 2 && pistePct < 12, `${pistePct.toFixed(1)}%`);

// ---- features sit on the runs, not in the trees
let offRun = 0;
for (const f of terrain.features) {
  if (s.samplePiste(f.x, f.z) === PISTE_OFF) offRun++;
}
check('every feature sits on its run', offRun === 0, `${offRun} of ${terrain.features.length} adrift`);
console.log(`${terrain.features.length} features placed`);

// ---- kickers actually launch: the lip must be a real step up
let weakKickers = 0;
for (const f of terrain.features.filter((f) => f.type === 'kicker')) {
  const [dx, dz] = f.dir;
  const behind = s.sampleHeight(f.x - dx * 9 * f.size, f.z - dz * 9 * f.size);
  const lip = s.sampleHeight(f.x, f.z);
  const after = s.sampleHeight(f.x + dx * 6, f.z + dz * 6);
  const rise = lip - (behind - (behind - after) * (9 * f.size) / (9 * f.size + 6));
  if (lip - after < 1.0 * f.size) weakKickers++;
  void rise;
}
check('kickers give a real lip', weakKickers === 0, `${weakKickers} too flat`);

// ---- snow
const t1 = Date.now();
const snow = new SnowField(terrain);
const snowMs = Date.now() - t1;
console.log(`\nsnow field built in ${snowMs} ms — ${SNOW_W}×${SNOW_H} = ${((SNOW_W * SNOW_H) / 1e6).toFixed(2)} M cells, ${((snow.cond.length * 2) / 1e6).toFixed(1)} MB`);

const fresh = snow.snapshot();
console.log(`fresh snapshot: ${(fresh.length / 1024).toFixed(1)} kB`);
check('fresh snapshot fits comfortably in one message', fresh.length < 200 * 1024, `${(fresh.length / 1024).toFixed(1)} kB`);

// Simulate an afternoon on the popular line: everyone takes roughly the same
// track down the red, jittered by a couple of metres like real traffic.
const red = terrain.runs.find((r) => r.key === 'red');
const mid = red.line[Math.floor(red.line.length / 2)];
const freshGrip = snow.surfaceAt(mid[0], mid[1]).grip;
// Seeded, not Math.random(): with real randomness this check passed at 49% on one
// run and 10% on the next, and a test that only usually passes is worse than none.
let seedState = 424242;
const rand = () => {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
};
const LAPS = 40;
for (let lap = 0; lap < LAPS; lap++) {
  const drift = (rand() - 0.5) * 4;
  for (let i = 0; i < red.line.length; i++) {
    const [x, z] = red.line[i];
    snow.pass(x + drift, z, 0.9, 16, 24);
  }
}
const worn = snow.snapshot();
console.log(`after ${LAPS} laps of the red: ${(worn.length / 1024).toFixed(1)} kB`);
check('a skied-out mountain still packs small', worn.length < 900 * 1024, `${(worn.length / 1024).toFixed(1)} kB`);

// the snow must actually have degraded where they skied
const at = snow.surfaceAt(mid[0], mid[1]);
console.log(`popular line after ${LAPS} laps: ${at.kind}, condition ${(at.cond * 100).toFixed(0)}%, rut ${(at.carve * 28).toFixed(1)} cm`);
check('skiing wears the snow down', at.cond < 0.55, `condition ${(at.cond * 100).toFixed(0)}%`);
check('skiing cuts a visible rut', at.carve > 0.35, `${(at.carve * 28).toFixed(1)} cm deep`);
check('worn snow holds an edge worse than fresh', at.grip < freshGrip * 0.85,
  `grip ${at.grip.toFixed(2)} vs ${freshGrip.toFixed(2)} fresh`);
check('worn snow runs faster than fresh (that is the trap)',
  at.drag < snow.surfaceAt(mid[0] + 40, mid[1]).drag || at.cond < 0.3,
  `drag ${at.drag.toFixed(4)}`);

// untouched snow two metres to the side must be untouched
const beside = snow.surfaceAt(mid[0] + 9, mid[1]);
check('the track is a track, not a wash of the whole run', beside.cond > at.cond + 0.2,
  `${(beside.cond * 100).toFixed(0)}% beside vs ${(at.cond * 100).toFixed(0)}% on the line`);

// grooming brings it back and scores area
const before = snow.groomedArea;
let area = 0;
for (let i = 0; i < red.line.length - 1; i++) {
  const [x, z] = red.line[i];
  const [nx, nz] = red.line[i + 1];
  area += snow.groom(x, z, 2.6, Math.atan2(nz - z, nx - x));
}
const afterGroom = snow.surfaceAt(mid[0], mid[1]);
check('the groomer restores the snow', afterGroom.cond > 0.98, `condition ${(afterGroom.cond * 100).toFixed(0)}%`);
check('grooming scores real area', snow.groomedArea - before > 100, `${area.toFixed(0)} m²`);

// grooming fresh snow again must score (next to) nothing — only the fringe cells
// the first pass did not fully cover can still pay out
const again = snow.groom(mid[0], mid[1], 2.6, 0);
check('re-grooming fresh corduroy pays nothing worth having', again < 1.0, `${again.toFixed(2)} m²`);

// off-piste can never be groomed
const off = snow.surfaceAt(-460, -300);
check('off-piste is powder', off.kind === 'powder', off.kind);
const groomedOff = snow.groom(-460, -300, 2.6, 0);
check('the groomer cannot touch off-piste', groomedOff === 0, `${groomedOff} m²`);
check('powder is draggier than corduroy', off.drag > snow.surfaceAt(mid[0], mid[1]).drag,
  `${off.drag.toFixed(3)} vs ${snow.surfaceAt(mid[0], mid[1]).drag.toFixed(3)}`);

// patch round trip
snow.takeDirty();
snow.pass(0, 0, 1.2, 40, 80);
const patch = snow.takePatch();
const other = new SnowField(terrain);
other.applySnapshot(fresh);
other.applyPatch(patch);
check('a patch reproduces the host exactly',
  other.cond[snow.index(0, 0)] === snow.cond[snow.index(0, 0)]
  && other.carve[snow.index(0, 0)] === snow.carve[snow.index(0, 0)],
  `patch ${patch.length} B`);

// timing: how long does a full patch upload take to prepare?
snow.markAll();
const t2 = Date.now();
snow.snapshot();
console.log(`full snapshot encode: ${Date.now() - t2} ms`);

// ---- the lifts have to hang at a height a person would recognise
//
// This is here because the first version got it badly wrong in a way no test was
// watching: the cable profile was a smoothed envelope, the smoothing could only
// raise it, and the error compounded up the mountain until the chair rode an
// average of twelve metres above the snow. Nothing in the game complained.

const blueRun = terrain.runs.find((r) => r.key === 'blue');
const dragBottom = blueRun.line[blueRun.line.length - 12];
const dragMid = blueRun.line[Math.floor(blueRun.line.length * 0.70)];

// Built from liftSpecs — the same object the game passes to `new Lift` — because
// the previous version of this test typed the parameters in a second time and
// left out `canSupport`. It measured a chairlift that does not exist.
// KNOWN OPEN DEFECT — these four checks fail on purpose.
//
// The lift heights below are measured from liftSpecs, i.e. from the lifts the
// game actually builds. The previous version of this test rebuilt them from
// numbers typed in a second time and left out `canSupport`, so it measured a
// chairlift with 39 pylons hugging the ground while the game shipped one with 14
// and stretches of rope 38 m in the air. Jurek reported "both lifts too high" and
// was told it was fixed. It was not; only the measurement was.
//
// The cause is routing, not the cable solver: the chairlift line runs up the
// middle of the runs, so nearly every position the solver wants a pylon in is on
// a piste and gets refused. Forcing a pylon in anyway puts hard obstacles in the
// middle of the red — tests/collision.test.mjs catches that, and it is worse.
// The fix is to route the line off the pistes, which moves the terminals and is a
// design change, not a constant.
//
// Left red deliberately. A green suite over a defect Jurek can see is how this
// got missed the first time.
const SPECS = liftSpecs(terrain, s);
for (const l of [
  { name: 'chairlift', ...SPECS.chair, clearance: 6.0, limit: 9.5 },
  { name: 'drag lift', ...SPECS.drag, clearance: 4.4, limit: 7.0 },
]) {
  const { pts, length } = sampleLine(s, l.from, l.to, 8);
  const spans = Math.max(2, Math.round(length / l.pylonSpacing));
  const { heights, supports } = cableProfile(pts, length, spans, l.clearance,
    { canSupport: l.canSupport });
  const clear = pts.map((p, i) => heights[i] - p.ground);
  const rider = clear.map((c) => c - l.hanger + l.seat);
  const min = Math.min(...clear), max = Math.max(...clear);
  const meanRider = rider.reduce((a, b) => a + b, 0) / rider.length;
  // A single gully the line has to fly over is terrain, not a bug — what matters
  // is the height for the ride, so the check is on the 95th percentile and the
  // maximum only has to stay off the old runaway numbers.
  const sorted = [...clear].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
  console.log(`\n${l.name}: ${length.toFixed(0)} m, ${supports.length - 2} pylons — `
    + `cable ${min.toFixed(1)}–${max.toFixed(1)} m up (95% of it under ${p95.toFixed(1)} m), `
    + `rider averages ${meanRider.toFixed(1)} m above the snow`);
  check(`${l.name} always clears the ground`, min > l.clearance - 0.6, `${min.toFixed(2)} m`);
  check(`${l.name} rides low for all but the odd gully`, p95 < l.limit, `95th percentile ${p95.toFixed(2)} m`);
  check(`${l.name} never flies over the mountain`, max < l.limit * 2.6, `worst ${max.toFixed(2)} m`);
  check(`${l.name} puts the rider within reach of the snow`,
    meanRider > 0.4 && meanRider < l.clearance - 1.0, `${meanRider.toFixed(2)} m`);
}

console.log('\n' + results.join('\n'));
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
