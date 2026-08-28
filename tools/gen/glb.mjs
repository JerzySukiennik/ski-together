// A glTF 2.0 binary writer, in one file, with no dependencies.
//
// Why this exists: every model in the game used to be built by a Python script
// that only runs inside Blender. That works, but it means a change to a tree
// needs a 400 MB application installed and a subprocess, and it means the models
// cannot be regenerated from the repository alone. This writer takes plain
// arrays of floats and writes the same GLB the loader already reads, so a model
// is now a function — `node tools/gen/build.mjs vegetation` and the tree changed.
//
// Only what the game actually uses is implemented: positions, normals, indices,
// and metallic-roughness materials. No textures, no animation, no skins. The
// game's shading comes from the terrain shader and the scene lights; the models
// carry shape and a base colour, and that is all they have ever carried.
//
// Everything here is authored Y-up, which is what glTF already is. The Blender
// scripts had to rotate Z-up into Y-up and bake the result, and getting that
// wrong is how the whole character shipped facing backwards once.

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;

class BinaryStore {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  /** Append bytes, padded so the next view starts on a four-byte boundary. */
  push(bytes, target) {
    const offset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    return { byteOffset: offset, byteLength: bytes.byteLength, target };
  }

  concat() {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(new Uint8Array(c.buffer || c, c.byteOffset || 0, c.byteLength), p);
      p += c.byteLength;
    }
    return out;
  }
}

/**
 * @param scene  [{ name, primitives: [{ positions, normals, indices, material }] }]
 * @param materials  { name: { colour: [r,g,b], roughness, metallic, opacity } }
 */
export function writeGLB(scene, materials) {
  const bin = new BinaryStore();
  const bufferViews = [];
  const accessors = [];

  const addView = (bytes, target) => {
    bufferViews.push({ buffer: 0, ...bin.push(bytes, target) });
    return bufferViews.length - 1;
  };

  const addVec3 = (values) => {
    const arr = new Float32Array(values);
    const view = addView(arr, ARRAY_BUFFER);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (arr[i + k] < min[k]) min[k] = arr[i + k];
        if (arr[i + k] > max[k]) max[k] = arr[i + k];
      }
    }
    accessors.push({
      bufferView: view, componentType: FLOAT, count: arr.length / 3, type: 'VEC3', min, max,
    });
    return accessors.length - 1;
  };

  const addIndices = (values) => {
    const arr = new Uint32Array(values);
    const view = addView(arr, ELEMENT_ARRAY_BUFFER);
    accessors.push({
      bufferView: view, componentType: UNSIGNED_INT, count: arr.length, type: 'SCALAR',
    });
    return accessors.length - 1;
  };

  const matNames = Object.keys(materials);
  const gltfMaterials = matNames.map((name) => {
    const m = materials[name];
    const out = {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...m.colour, m.opacity ?? 1],
        metallicFactor: m.metallic ?? 0,
        roughnessFactor: m.roughness ?? 0.8,
      },
      doubleSided: !!m.doubleSided,
    };
    if ((m.opacity ?? 1) < 1) out.alphaMode = 'BLEND';
    if (m.emissive) out.emissiveFactor = m.emissive;
    return out;
  });

  const meshes = [];
  const nodes = [];
  for (const object of scene) {
    const primitives = object.primitives.map((p) => {
      const mat = matNames.indexOf(p.material);
      if (mat < 0) throw new Error(`material "${p.material}" is not declared`);
      return {
        attributes: { POSITION: addVec3(p.positions), NORMAL: addVec3(p.normals) },
        indices: addIndices(p.indices),
        material: mat,
      };
    });
    meshes.push({ name: object.name, primitives });
    nodes.push({ name: object.name, mesh: meshes.length - 1 });
  }

  const json = {
    asset: { version: '2.0', generator: 'SKI Together tools/gen (no Blender)' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: gltfMaterials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
  jsonChunk.set(jsonBytes, 0);

  const binBytes = bin.concat();
  const total = 12 + 8 + jsonChunk.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  view.setUint32(p, GLB_MAGIC, true); p += 4;
  view.setUint32(p, 2, true); p += 4;
  view.setUint32(p, total, true); p += 4;
  view.setUint32(p, jsonChunk.length, true); p += 4;
  view.setUint32(p, JSON_CHUNK, true); p += 4;
  out.set(jsonChunk, p); p += jsonChunk.length;
  view.setUint32(p, binBytes.length, true); p += 4;
  view.setUint32(p, BIN_CHUNK, true); p += 4;
  out.set(binBytes, p);
  return out;
}
