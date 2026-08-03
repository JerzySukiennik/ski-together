// Making the world solid is the one change that can quietly make the game
// impossible to finish: a collider a metre too generous, and the rental shop is
// a building you can see and never enter. So every place the player HAS to be
// able to stand is checked here, on the real models and the real terrain.

import * as THREE from 'three';
import { generateTerrain, makeSampler } from '../src/shared/terrain.js';
import { scatterTrees, scatterRocks, PisteFurniture } from '../src/world/props.js';
import { Resort } from '../src/world/resort.js';
import { buildColliders } from '../src/world/collision.js';
import { loadAssets } from './nodeAssets.mjs';

let failures = 0;
const results = [];
function check(label, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const assets = await loadAssets();
const terrain = generateTerrain();
const sampler = makeSampler(terrain);
const resort = new Resort(assets, terrain, sampler);
const keepOut = resort.keepOutZones();
const trees = scatterTrees(terrain, sampler, 5200, 7717, keepOut);
const rocks = scatterRocks(terrain, sampler, 420, 313, keepOut);
const furniture = new PisteFurniture(assets, terrain, sampler);

const t0 = Date.now();
const colliders = buildColliders(assets, resort, trees, rocks, furniture);
console.log(`\n${colliders.shapes.length} colliders built in ${Date.now() - t0} ms`);

const PLAYER = 0.42;

/** Can a player stand here without being pushed anywhere? */
function free(x, z, y = sampler.sampleHeight(x, z) + 0.9) {
  const p = new THREE.Vector3(x, y, z);
  return colliders.resolve(p, PLAYER, y) === null;
}

/** Somewhere within `radius` of here that a player can stand. */
function anyFreeNear(x, z, radius) {
  if (free(x, z)) return true;
  for (let ring = 1; ring <= 4; ring++) {
    const r = (radius * ring) / 4;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      if (free(x + Math.cos(ang) * r, z + Math.sin(ang) * r)) return true;
    }
  }
  return false;
}

// ---- the spawn point
const base = terrain.stations.base;
check('the player does not start inside something', free(base.x - 26, base.z + 58));

// ---- every interaction zone has standing room
for (const z of resort.zones) {
  check(`the ${z.name} can be reached`, anyFreeNear(z.x, z.z, Math.max(2, z.radius * 0.7)),
    `zone radius ${z.radius}`);
}

// ---- both lifts can be boarded
for (const lift of resort.lifts) {
  const lz = lift.loadZone;
  check(`the ${lift.key} lift gate can be stood on`, anyFreeNear(lz.x, lz.z, lz.radius * 0.6));
  check(`the ${lift.key} lift unloading point is clear`,
    anyFreeNear(lift.unloadZone.x, lift.unloadZone.z, lift.unloadZone.radius * 0.6));
}

// ---- the pistes themselves must stay skiable end to end
//
// Not "the centre line is clear": the top of the blue passes right beside the
// summit terminal, which is where a terminal belongs. What matters is that a
// skier always has most of the run's width to use, and that nothing hard is
// standing in the part of it people actually ski down.
for (const run of terrain.runs) {
  let worstFree = 1, worstAt = 0, hardInMiddle = 0;
  for (let i = 2; i < run.line.length - 2; i++) {
    const [x, z] = run.line[i];
    const [nx, nz] = run.line[i + 1];
    const dx = nx - x, dz = nz - z;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len;
    let open = 0;
    const SAMPLES = 15;
    for (let k = 0; k < SAMPLES; k++) {
      const off = ((k / (SAMPLES - 1)) * 2 - 1) * run.halfWidth;
      const sx = x + px * off, sz = z + pz * off;
      const y = sampler.sampleHeight(sx, sz) + 0.9;
      const p = new THREE.Vector3(sx, y, sz);
      const hit = colliders.resolve(p, PLAYER, y);
      if (!hit) open++;
      else if (hit.hard && Math.abs(off) < run.halfWidth * 0.5) hardInMiddle++;
    }
    const frac = open / SAMPLES;
    if (frac < worstFree) { worstFree = frac; worstAt = i; }
  }
  check(`the ${run.key} run is never more than half blocked`, worstFree >= 0.5,
    `narrowest point is ${(worstFree * 100).toFixed(0)}% open at index ${worstAt}`);
  check(`nothing hard stands in the middle of the ${run.key} run`, hardInMiddle === 0,
    `${hardInMiddle} samples`);
}

// ---- and something has to actually stop you
const tree = trees[0];
check('a tree trunk is solid', !free(tree.x, tree.z, tree.y + 1.0),
  `spruce at ${tree.x.toFixed(0)}, ${tree.z.toFixed(0)}`);
check('but you can pass a metre to the side of it',
  free(tree.x + 1.4, tree.z + 1.4, tree.y + 1.0));
check('and you can fly over it',
  free(tree.x, tree.z, tree.y + 40));

const bld = resort.buildings[0];
check('a building wall is solid', !free(bld.x, bld.z, bld.y + 1.0), bld.name);

// ---- the broad phase has to be worth having
const probe = new THREE.Vector3();
const t1 = Date.now();
for (let i = 0; i < 200000; i++) {
  probe.set(base.x + (i % 200) - 100, base.y + 1, base.z + ((i / 200) | 0) - 100);
  colliders.resolve(probe, PLAYER, probe.y);
}
const per = ((Date.now() - t1) / 200000) * 1000;
console.log(`\ncollision query: ${per.toFixed(2)} µs each`);
check('a collision query is cheap enough to run every substep', per < 6, `${per.toFixed(2)} µs`);

console.log('\n' + results.join('\n'));
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
