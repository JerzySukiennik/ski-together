// Which way does a roof point?
//
// A bounding box cannot answer that: a gable and its mirror image occupy exactly
// the same box. So compare the height of the vertices near the building's centre
// line against the height of the vertices out at the eaves. A roof ridges UP in
// the middle; anything that ridges down is inside out.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const path = process.argv[2];
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

new GLTFLoader().parse(ab, '', (gltf) => {
  for (const root of gltf.scene.children) {
    root.updateMatrixWorld(true);
    let printed = false;
    root.traverse((n) => {
      if (!n.isMesh) return;
      const pos = n.geometry.attributes.position;
      const v = new THREE.Vector3();
      const pts = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld);
        pts.push(v.clone());
      }
      const box = new THREE.Box3().setFromPoints(pts);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.25) return; // a flat slab has no pitch to get wrong

      // Test both horizontal axes; the ridge runs along one of them, so the
      // meaningful signal is on the other.
      for (const axis of ['x', 'z']) {
        const half = size[axis] / 2;
        if (half < 0.5) continue;
        const inner = pts.filter((p) => Math.abs(p[axis] - c[axis]) < half * 0.25);
        const outer = pts.filter((p) => Math.abs(p[axis] - c[axis]) > half * 0.75);
        if (inner.length < 3 || outer.length < 3) continue;
        const mean = (a) => a.reduce((s, p) => s + p.y, 0) / a.length;
        const diff = mean(inner) - mean(outer);
        if (Math.abs(diff) < size.y * 0.15) continue; // flat enough either way
        if (!printed) { console.log(`\n== ${root.name}`); printed = true; }
        console.log(`   ${n.name.padEnd(22)} along ${axis}: centre ${diff > 0 ? 'HIGHER' : 'LOWER'} `
          + `than eaves by ${Math.abs(diff).toFixed(2)} m  ${diff > 0 ? '(gable, correct)' : '(INVERTED — points down)'}`);
      }
    });
  }
}, (e) => { console.error(e); process.exit(1); });
