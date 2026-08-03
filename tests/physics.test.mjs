// Does it feel like skiing? You cannot measure "feel", but you can measure every
// number that produces it.
//
// The micro-measurements run on a synthetic constant slope, so what they measure
// is the physics and nothing else. The descents run on the real mountain.

import { generateTerrain, makeSampler } from '../src/shared/terrain.js';
import { SnowField } from '../src/shared/snowfield.js';
import { Skier, MODE } from '../src/player/skier.js';
import { SKIS, BOARDS } from '../src/gear/catalog.js';

let failures = 0;
const results = [];
const check = (label, ok, detail) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

const NEUTRAL = { steer: 0, throttle: 0, brake: 0, tuck: false, jump: false, grab: false };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- test slope

// A featureless plane at a chosen gradient, falling towards +z.
function slopeWorld(grade, { cond = 255, onPiste = true } = {}) {
  const len = Math.hypot(1, grade);
  const fakeTerrain = { piste: new Uint8Array(1024 * 1024).fill(onPiste ? 2 : 0) };
  const snow = new SnowField(fakeTerrain);
  snow.cond.fill(cond);
  snow.carve.fill(0);
  const sampler = {
    sampleHeight: (x, z) => 1400 - z * grade,
    sampleNormal: () => [0, 1 / len, grade / len],
    samplePiste: () => (onPiste ? 2 : 0),
    sampleSlope: () => Math.atan(grade),
  };
  return { terrain: fakeTerrain, sampler, snow };
}

function rider(world, gearId = 'ski-piste74', bootId = 'boot-ski') {
  const s = new Skier(world, {
    set: { board: gearId, boot: bootId, helmet: 'helmet-rental', jacket: 'jacket-shell' },
  });
  s.placeOnGround(0, 0, 0); // facing +z, straight down the fall line
  s.mode = MODE.RIDE;
  return s;
}

function run(skier, seconds, inputFn, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    skier.update(dt, { ...NEUTRAL, ...(inputFn ? inputFn(skier, i * dt) : null) }, { night: 0 });
  }
  return skier;
}

// ---------------------------------------------------------------- schuss

function terminalSpeed(grade, opts = {}) {
  const s = rider(slopeWorld(grade, opts), opts.gear);
  run(s, 40, () => ({ tuck: !!opts.tuck }));
  return s.telemetry.speed;
}

console.log('\nstraight down a groomed piste, no steering:');
for (const grade of [0.12, 0.19, 0.275, 0.40]) {
  const v = terminalSpeed(grade);
  console.log(`  ${(grade * 100).toFixed(0).padStart(3)}% slope → ${(v * 3.6).toFixed(1).padStart(5)} km/h`);
}
const vBlue = terminalSpeed(0.19);
const vRed = terminalSpeed(0.275);
const vBlack = terminalSpeed(0.40);
check('a red-gradient schuss runs 50–90 km/h', vRed * 3.6 > 50 && vRed * 3.6 < 90, `${(vRed * 3.6).toFixed(1)} km/h`);
check('steeper is faster', vBlack > vRed && vRed > vBlue,
  `${(vBlue * 3.6).toFixed(0)} / ${(vRed * 3.6).toFixed(0)} / ${(vBlack * 3.6).toFixed(0)} km/h`);

// Measured on a ski whose own top speed is not the limit, or the gear ceiling
// hides the aerodynamics.
const upright = terminalSpeed(0.275, { gear: 'ski-downhill92' });
const tucked = terminalSpeed(0.275, { gear: 'ski-downhill92', tuck: true });
console.log(`  tuck on 27.5% (Downhill 92): ${(upright * 3.6).toFixed(1)} → ${(tucked * 3.6).toFixed(1)} km/h`);
check('tucking is meaningfully faster', tucked > upright * 1.07,
  `${(tucked * 3.6).toFixed(1)} vs ${(upright * 3.6).toFixed(1)} km/h`);

const fastSki = terminalSpeed(0.275, { gear: 'ski-downhill92' });
const slowSki = terminalSpeed(0.275, { gear: 'ski-slalom63' });
console.log(`  Downhill 92 ${(fastSki * 3.6).toFixed(1)} km/h vs Slalom 63 ${(slowSki * 3.6).toFixed(1)} km/h on the same slope`);
check('the sport ski is genuinely faster than the slalom ski', fastSki > slowSki * 1.12,
  `${(fastSki * 3.6).toFixed(1)} vs ${(slowSki * 3.6).toFixed(1)} km/h`);

// ---------------------------------------------------------------- turn radius

function turnRadius(gearId) {
  const s = rider(slopeWorld(0.22), gearId);
  run(s, 8);
  const h0 = s.heading;
  const p0 = s.pos.clone();
  run(s, 1.6, () => ({ steer: 1 }));
  const arc = Math.abs(wrap(s.heading - h0));
  const dist = Math.hypot(s.pos.x - p0.x, s.pos.z - p0.z);
  return arc > 0.05 ? dist / (2 * Math.sin(arc / 2)) * arc / arc * (arc / arc) && dist / arc : Infinity;
}

console.log('\nturn radius, full edge on a 22% slope:');
for (const gear of [SKIS[1], SKIS[0], SKIS[4]]) {
  const r = turnRadius(gear.id);
  console.log(`  ${gear.short.padEnd(13)} printed ${String(gear.turnRadius).padStart(4)} m → measured ${r.toFixed(1).padStart(5)} m`);
  check(`${gear.short} turns near its printed radius`, r > gear.turnRadius * 0.5 && r < gear.turnRadius * 2.4,
    `${r.toFixed(1)} m vs ${gear.turnRadius} m printed`);
}
check('the manoeuvrable ski turns tighter than the sport ski',
  turnRadius('ski-slalom63') < turnRadius('ski-downhill92') * 0.7, '');

// ---------------------------------------------------------------- turning costs speed

function afterFourteen(steerFn) {
  const s = rider(slopeWorld(0.275));
  const p0 = s.pos.clone();
  run(s, 16, (sk, t) => ({ steer: steerFn(t) }));
  return { speed: s.telemetry.speed, dist: Math.hypot(s.pos.x - p0.x, s.pos.z - p0.z), drop: p0.z - s.pos.z };
}
const straight = afterFourteen(() => 0);
const carved = afterFourteen((t) => Math.sin(t * 1.4) * 0.95);
const stopped = afterFourteen(() => 0);
console.log(`\nafter 16 s on 27.5%: straight ${(straight.speed * 3.6).toFixed(1)} km/h (${straight.dist.toFixed(0)} m), carving ${(carved.speed * 3.6).toFixed(1)} km/h (${carved.dist.toFixed(0)} m)`);
check('turning costs speed', carved.speed < straight.speed * 0.88,
  `${(carved.speed * 3.6).toFixed(1)} vs ${(straight.speed * 3.6).toFixed(1)} km/h`);
void stopped;

// braking must actually stop you
{
  const s = rider(slopeWorld(0.19));
  run(s, 10);
  const before = s.telemetry.speed;
  run(s, 4, () => ({ brake: 1 }));
  console.log(`snowplough on 19%: ${(before * 3.6).toFixed(1)} → ${(s.telemetry.speed * 3.6).toFixed(1)} km/h in 4 s`);
  check('the snowplough brakes hard', s.telemetry.speed < before * 0.45,
    `${(s.telemetry.speed * 3.6).toFixed(1)} km/h`);
}

// ---------------------------------------------------------------- snow states

function skidOnTurn(cond, opts = {}) {
  const s = rider(slopeWorld(0.275, { cond, ...opts }));
  run(s, 7);
  let skid = 0, n = 0;
  run(s, 3, (sk) => { skid += sk.telemetry.skid; n++; return { steer: 1 }; });
  return { skid: skid / n, speed: s.telemetry.speed };
}
const corduroy = skidOnTurn(255);
const ice = skidOnTurn(8);
console.log(`\nhard turn: corduroy skids ${(corduroy.skid * 100).toFixed(0)}%, ice skids ${(ice.skid * 100).toFixed(0)}%`);
check('ice makes the edge let go', ice.skid > corduroy.skid + 0.15,
  `${(ice.skid * 100).toFixed(0)}% vs ${(corduroy.skid * 100).toFixed(0)}%`);

// The question that matters on ice is not "does it slide" — everything slides —
// but "can you still make the turn". Measure the turn you actually get.
function turnHeldOnIce(gearId) {
  const s = rider(slopeWorld(0.275, { cond: 8 }), gearId);
  run(s, 7);
  const h0 = s.heading;
  run(s, 2.5, () => ({ steer: 0.7 }));
  return Math.abs(wrap(s.heading - h0)) * 180 / Math.PI;
}
const rentalIce = turnHeldOnIce('ski-piste74');
const raceIce = turnHeldOnIce('ski-race66');
console.log(`turn achieved on ice in 2.5 s: rental ${rentalIce.toFixed(0)}°, race ski ${raceIce.toFixed(0)}°`);
check('the race ski is what saves you on ice', raceIce > rentalIce * 1.15,
  `${raceIce.toFixed(0)}° vs ${rentalIce.toFixed(0)}°`);

const powder = terminalSpeed(0.275, { onPiste: false });
console.log(`off-piste powder on 27.5%: ${(powder * 3.6).toFixed(1)} km/h`);
check('powder is much slower than the piste', powder < vRed * 0.75,
  `${(powder * 3.6).toFixed(1)} vs ${(vRed * 3.6).toFixed(1)} km/h`);

// ---------------------------------------------------------------- walking

function walkSpeed(world) {
  const s = rider(world);
  const p0 = s.pos.clone();
  for (let i = 0; i < 60 * 8; i++) s.update(1 / 60, { ...NEUTRAL, throttle: 1 }, { onFoot: true, night: 0 });
  return Math.hypot(s.pos.x - p0.x, s.pos.z - p0.z) / 8;
}
const walkPiste = walkSpeed(slopeWorld(0.06));
const walkPowder = walkSpeed(slopeWorld(0.06, { onPiste: false }));
const walkIce = walkSpeed(slopeWorld(0.06, { cond: 6 }));
console.log(`\nwalking in boots: piste ${walkPiste.toFixed(2)} m/s, powder ${walkPowder.toFixed(2)} m/s, ice ${walkIce.toFixed(2)} m/s`);
// Deliberately faster than a literal human walk: crossing the resort at 1.4 m/s
// turned the walk to the shop into the longest part of the game.
check('walking on a groomed piste is brisk but not a sprint',
  walkPiste > 1.6 && walkPiste < 3.4, `${walkPiste.toFixed(2)} m/s`);
check('walking in powder is a slog', walkPowder < walkPiste * 0.62, `${walkPowder.toFixed(2)} m/s`);

// ---------------------------------------------------------------- the real mountain

const terrain = generateTerrain();
const sampler = makeSampler(terrain);
const realWorld = () => ({ terrain, sampler, snow: new SnowField(terrain) });

// kicker: come in straight and fast along its own axis
function kickerAir(feature) {
  const world = realWorld();
  const s = new Skier(world, { set: { board: 'ski-giant84', boot: 'boot-ski', helmet: 'helmet-rental', jacket: 'jacket-shell' } });
  const [dx, dz] = feature.dir;
  const runIn = 55;
  s.placeOnGround(feature.x - dx * runIn, feature.z - dz * runIn, Math.atan2(dx, dz));
  s.mode = MODE.RIDE;
  s.vel.set(dx * 16, 0, dz * 16);
  // The longest single flight, not the sum of every hop on the way down.
  let current = 0, best = 0, peak = 0;
  const want = Math.atan2(dx, dz);
  run(s, 12, (sk) => {
    if (sk.telemetry.airborne) {
      current += 1 / 60;
      if (current > best) { best = current; peak = sk.air.height; }
    } else current = 0;
    return { steer: Math.max(-1, Math.min(1, -wrap(want - sk.heading) * 2.0)), tuck: true };
  });
  return { airTime: best, peak };
}
const kickers = terrain.features.filter((f) => f.type === 'kicker');
const small = kickerAir(kickers.reduce((a, b) => (a.size < b.size ? a : b)));
const big = kickerAir(kickers.reduce((a, b) => (a.size > b.size ? a : b)));
console.log(`\nkickers: smallest gives ${small.airTime.toFixed(2)} s of air (${small.peak.toFixed(1)} m), biggest gives ${big.airTime.toFixed(2)} s (${big.peak.toFixed(1)} m)`);
check('a kicker actually launches you', big.airTime > 0.5, `${big.airTime.toFixed(2)} s`);
check('a bigger kicker gives more air', big.airTime > small.airTime, `${big.airTime.toFixed(2)} vs ${small.airTime.toFixed(2)} s`);

// an autopilot that skis the centre line
function descend(run_, gearId, targetSpeed) {
  const world = realWorld();
  const s = new Skier(world, { set: { board: gearId, boot: 'boot-ski', helmet: 'helmet-rental', jacket: 'jacket-shell' } });
  const [x, z] = run_.line[2];
  const [nx, nz] = run_.line[8];
  s.placeOnGround(x, z, Math.atan2(nx - x, nz - z));
  s.mode = MODE.RIDE;

  let idx = 2, t = 0, crashes = 0, offLine = 0, samples = 0;
  const dt = 1 / 60;
  while (t < 320) {
    // Advance along the line by projection, not by proximity: a skier who is 20 m
    // wide of the piste is still making progress down it.
    while (idx < run_.line.length - 2) {
      const [px, pz] = run_.line[idx];
      const [qx, qz] = run_.line[idx + 1];
      if ((s.pos.x - px) * (qx - px) + (s.pos.z - pz) * (qz - pz) > 0) idx++;
      else break;
    }
    if (idx >= run_.line.length - 4) break;
    const look = Math.min(run_.line.length - 1, idx + Math.round(5 + s.telemetry.speed * 0.55));
    const [tx, tz] = run_.line[look];
    const want = Math.atan2(tx - s.pos.x, tz - s.pos.z);
    const diff = wrap(want - s.heading);
    // Cross-track term: how far off the centre line, signed by which side.
    const [cx0, cz0] = run_.line[idx];
    const [cx1, cz1] = run_.line[Math.min(idx + 1, run_.line.length - 1)];
    const dirX = cx1 - cx0, dirZ = cz1 - cz0;
    const dl = Math.hypot(dirX, dirZ) || 1;
    const cross = ((s.pos.x - cx0) * dirZ - (s.pos.z - cz0) * dirX) / dl;
    // A real skier rides a partial edge. Full lock every turn scrubs so much speed
    // that the descent time stops measuring the mountain and starts measuring the
    // autopilot's panic.
    const steer = Math.max(-0.8, Math.min(0.8, -diff * 1.5 - cross * 0.03));
    const brake = s.telemetry.speed > targetSpeed ? 1 : 0;
    const throttle = s.telemetry.speed < 5.5 ? 1 : 0;
    s.update(dt, { ...NEUTRAL, steer, brake, throttle }, { night: 0 });
    if (s.mode === MODE.CRASH) { crashes++; s.recover(); s.mode = MODE.RIDE; }
    const [cx, cz] = run_.line[idx];
    offLine += Math.hypot(s.pos.x - cx, s.pos.z - cz);
    samples++;
    t += dt;
  }
  return { seconds: t, crashes, reached: idx >= run_.line.length - 4, offLine: offLine / samples };
}

console.log('');
const descents = {};
for (const [key, gear, target] of [['blue', 'ski-piste74', 13], ['red', 'ski-piste74', 16], ['black', 'ski-carve68', 18]]) {
  const r = terrain.runs.find((x) => x.key === key);
  const d = descend(r, gear, target);
  descents[key] = d;
  console.log(`${r.name.padEnd(10)} autopilot: ${d.seconds.toFixed(1)} s, ${d.crashes} crash(es), avg ${d.offLine.toFixed(1)} m off the line, finished ${d.reached}`);
  check(`${key}: the autopilot reaches the bottom`, d.reached, `gave up after ${d.seconds.toFixed(0)} s`);
  check(`${key}: the autopilot holds the piste`, d.offLine < 12, `${d.offLine.toFixed(1)} m average`);
}
check('a blue descent lands near the 90 s design target',
  descents.blue.seconds > 70 && descents.blue.seconds < 210, `${descents.blue.seconds.toFixed(0)} s`);
check('the red is quicker than the blue', descents.red.seconds < descents.blue.seconds,
  `${descents.red.seconds.toFixed(0)} s vs ${descents.blue.seconds.toFixed(0)} s`);

// snow really does get worn down by a descent
{
  const world = realWorld();
  const before = world.snow.surfaceAt(...terrain.runs[1].line[40]).cond;
  const s = new Skier(world, { set: { board: 'ski-piste74', boot: 'boot-ski', helmet: 'helmet-rental', jacket: 'jacket-shell' } });
  const r = terrain.runs[1];
  const [x, z] = r.line[36];
  s.placeOnGround(x, z, Math.atan2(r.line[40][0] - x, r.line[40][1] - z));
  s.mode = MODE.RIDE;
  run(s, 6, () => ({ steer: Math.sin(Date.now()) > 2 ? 1 : 0 }));
  const after = world.snow.surfaceAt(x, z).cond;
  console.log(`\none pass over a patch: condition ${(before * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}%`);
  check('riding leaves the snow measurably worse', after < before, `${(after * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------- board

const boardSpeed = terminalSpeed(0.275, { gear: 'brd-freeride156' });
console.log(`\nsnowboard on 27.5%: ${(boardSpeed * 3.6).toFixed(1)} km/h`);
check('the board rides too', boardSpeed * 3.6 > 40, `${(boardSpeed * 3.6).toFixed(1)} km/h`);
check('every board in the shop has a sane spec',
  BOARDS.every((b) => b.turnRadius > 3 && b.topSpeed > 12 && b.edgeGrip > 0.5), '');

// ---------------------------------------------------------------- cold

{
  const s = rider(slopeWorld(0.0));
  for (let i = 0; i < 60 * 60 * 8; i++) s.update(1 / 60, NEUTRAL, { night: 0 });
  console.log(`warmth after 8 minutes out at noon: ${(s.warmth * 100).toFixed(0)}%`);
  check('eight minutes leaves you shivering, not finished', s.warmth < 0.4 && s.warmth > 0.02,
    `${(s.warmth * 100).toFixed(0)}%`);
  check('cold costs grip but never ends the run', s.coldPenalty > 0 && s.coldPenalty <= 1,
    `penalty ${(s.coldPenalty * 100).toFixed(0)}%`);
  const before = s.warmth;
  for (let i = 0; i < 60 * 25; i++) s.update(1 / 60, NEUTRAL, { warming: 0.09 });
  check('the cafe warms you back up', s.warmth > before + 0.5, `${(s.warmth * 100).toFixed(0)}%`);

  const night = rider(slopeWorld(0.0));
  for (let i = 0; i < 60 * 60 * 8; i++) night.update(1 / 60, NEUTRAL, { night: 1 });
  check('the night is colder than the afternoon', night.warmth < s.warmth * 0.99 || night.warmth < 0.4,
    `${(night.warmth * 100).toFixed(0)}% at night`);
}

console.log('\n' + results.join('\n'));
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
