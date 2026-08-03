// Loads the real .glb files under Node, so the acceptance tests measure the
// models that actually ship rather than numbers typed in twice.
//
// GLTFLoader normally fetches a URL, which Node has no XHR for — but `parse`
// takes an ArrayBuffer, and these models carry no external textures, so reading
// the file and handing the bytes over works with nothing stubbed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['vegetation', 'lifts', 'buildings', 'character'];

export async function loadAssets() {
  const objects = new Map();
  const loader = new GLTFLoader();
  for (const name of FILES) {
    const buf = readFileSync(join(ROOT, 'assets/models', `${name}.glb`));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
    for (const child of [...gltf.scene.children]) {
      child.position.set(0, 0, 0);
      child.updateMatrixWorld(true);
      objects.set(child.name, child);
    }
  }

  return {
    objects,
    get(name) {
      const t = objects.get(name);
      if (!t) throw new Error(`model "${name}" is not in the library`);
      return t;
    },
    instance(name) { return this.get(name).clone(true); },
    size(name) {
      return new THREE.Box3().setFromObject(this.get(name)).getSize(new THREE.Vector3());
    },
    primitives(name) {
      const out = [];
      const template = this.get(name);
      template.updateMatrixWorld(true);
      template.traverse((n) => {
        if (!n.isMesh) return;
        const geo = n.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().copy(n.matrixWorld));
        out.push({ geometry: geo, material: n.material });
      });
      return out;
    },
  };
}
