// Build the game's models. No Blender, no dependencies, no network.
//
//   node tools/gen/build.mjs            # everything this pipeline owns
//   node tools/gen/build.mjs vegetation # one set
//
// Each set is a module that exports MATERIALS and a build function returning
// [{ name, primitives: [{ material, positions, normals, indices }] }]. The names
// are the contract with the game: src/world/assets.js looks models up by name
// and the colour booth looks materials up by name, so a set may change shape
// freely and may not change its names without changing the game with it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeGLB } from './glb.mjs';
import { triangleCount, merge, outwardFraction } from './mesh.mjs';
import { MATERIALS as VEG_MATERIALS, buildVegetation } from './vegetation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SETS = {
  vegetation: { materials: VEG_MATERIALS, build: buildVegetation, out: 'assets/models/vegetation.glb' },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SETS);

for (const name of names) {
  const set = SETS[name];
  if (!set) {
    console.error(`no such model set: ${name} (have: ${Object.keys(SETS).join(', ')})`);
    process.exit(1);
  }
  const scene = set.build();
  const bytes = writeGLB(scene, set.materials);
  writeFileSync(join(ROOT, set.out), bytes);
  const tris = scene.reduce((a, o) => a + o.primitives.reduce((b, p) => b + triangleCount(p), 0), 0);
  console.log(`${set.out}  ${scene.length} objects, ${tris} triangles, ${(bytes.length / 1024).toFixed(0)} kB`);
  for (const o of scene) {
    const t = o.primitives.reduce((b, p) => b + triangleCount(p), 0);
    const ys = o.primitives.flatMap((p) => p.positions.filter((_, i) => i % 3 === 1));
    const facing = outwardFraction(merge(...o.primitives));
    console.log(`  ${o.name.padEnd(16)} ${String(t).padStart(5)} tris  `
      + `y ${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)}  `
      + `facing ${(facing * 100).toFixed(0)}%  `
      + `[${o.primitives.map((p) => p.material).join(' ')}]`);
    if (facing < 0.6) console.log(`  ^^ ${o.name} looks INSIDE OUT — check the winding`);
  }
}
