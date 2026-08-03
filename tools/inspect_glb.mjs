// Dump the structure of a GLB: every node, its mesh names, bounds and material.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const path = process.argv[2];
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.parse(ab, '', (gltf) => {
  for (const root of gltf.scene.children) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    console.log(`\n== ${root.name}  size ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`
      + `  y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`);
    root.traverse((n) => {
      if (!n.isMesh) return;
      const b = new THREE.Box3().setFromObject(n);
      const s = b.getSize(new THREE.Vector3());
      const mats = (Array.isArray(n.material) ? n.material : [n.material]).map((m) => m?.name).join(',');
      console.log(`   ${n.name.padEnd(26)} ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`
        + `  y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}  [${mats}]`
        + `  tris ${(n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3}`);
    });
  }
}, (e) => { console.error(e); process.exit(1); });
