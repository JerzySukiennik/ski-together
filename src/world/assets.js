import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Everything modelled in Blender arrives here.
//
// The contract with the models is their names: an object called `tree_spruce_a`
// is a tree, a material called `Jacket` is a thing the colour booth may repaint.
// Nothing in the game reaches into a mesh by index.

const MODELS = {
  vegetation: 'assets/models/vegetation.glb',
  lifts: 'assets/models/lifts.glb',
  buildings: 'assets/models/buildings.glb',
  character: 'assets/models/character.glb',
};

export class AssetLibrary {
  constructor() {
    this.objects = new Map(); // name -> THREE.Object3D (a template, never added to a scene)
    this.materials = new Map(); // name -> THREE.Material
    this.loaded = false;
  }

  async load(onProgress = () => {}) {
    const loader = new GLTFLoader();
    const names = Object.keys(MODELS);
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      onProgress(`Unloading the truck (${i + 1}/${names.length})`);
      const gltf = await loader.loadAsync(MODELS[key]);
      for (const child of [...gltf.scene.children]) {
        child.updateMatrixWorld(true);
        this.register(child);
      }
    }
    this.loaded = true;
    return this;
  }

  register(object) {
    // Blender exports Z-up geometry rotated into Y-up on the node. Bake that in
    // so a template's local axes are the axes the game reasons about.
    object.position.set(0, 0, 0);
    object.updateMatrix();
    object.traverse((n) => {
      if (!n.isMesh) return;
      n.castShadow = true;
      n.receiveShadow = true;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (m && m.name && !this.materials.has(m.name)) this.materials.set(m.name, m);
      }
    });
    this.objects.set(object.name, object);
  }

  get(name) {
    const t = this.objects.get(name);
    if (!t) throw new Error(`model "${name}" is not in the library`);
    return t;
  }

  /** A fresh copy that can be placed in the world and coloured on its own. */
  instance(name, { recolour = null } = {}) {
    const clone = this.get(name).clone(true);
    if (recolour) {
      clone.traverse((n) => {
        if (!n.isMesh) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        const next = mats.map((m) => {
          const swap = recolour[m.name];
          if (!swap) return m;
          const copy = m.clone();
          copy.color = new THREE.Color(swap);
          return copy;
        });
        n.material = Array.isArray(n.material) ? next : next[0];
      });
    }
    return clone;
  }

  /**
   * Every mesh inside a template, flattened with its local transform applied —
   * what instancing needs, since an InstancedMesh takes one geometry at a time.
   */
  primitives(name) {
    const out = [];
    const template = this.get(name);
    template.updateMatrixWorld(true);
    template.traverse((n) => {
      if (!n.isMesh) return;
      const geo = n.geometry.clone();
      const m = new THREE.Matrix4();
      m.copy(n.matrixWorld);
      geo.applyMatrix4(m);
      out.push({ geometry: geo, material: n.material });
    });
    return out;
  }

  /** Bounding box of a template, in metres. Useful for placing things on snow. */
  size(name) {
    const b = new THREE.Box3().setFromObject(this.get(name));
    return b.getSize(new THREE.Vector3());
  }
}
