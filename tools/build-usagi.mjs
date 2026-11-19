// Bakes the sourced blind-box STL into a game-ready GLB: pedestal cut, welded,
// decimated, scaled to metres, Y-up facing +Z, with painted vertex colours.
import fs from 'node:fs'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { MeshoptSimplifier } from 'meshoptimizer'

const SRC = 'public/assets/chars/usagi/model.stl'
const OUT = 'public/assets/chars/usagi/usagi.glb'
const PEDESTAL = 4.2        // mm, everything below is the display stand
const HEIGHT = 1.35         // m, ear tips to feet
const TARGET_TRIS = 16000
const PAINT = JSON.parse(process.argv[2] || '{}')

const buf = fs.readFileSync(SRC)
const stl = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const src = stl.attributes.position

// --- weld: STL is a triangle soup, we need shared vertices for simplification
const H = new Map()
const remap = new Int32Array(src.count)
const verts = []
for (let i = 0; i < src.count; i++) {
  const x = src.getX(i), y = src.getY(i), z = src.getZ(i)
  const k = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`
  let id = H.get(k)
  if (id === undefined) { id = verts.length / 3; H.set(k, id); verts.push(x, y, z) }
  remap[i] = id
}

// --- cut the pedestal, keep the figure
const idx = []
for (let t = 0; t < src.count; t += 3) {
  const a = remap[t], b = remap[t + 1], c = remap[t + 2]
  if (a === b || b === c || a === c) continue
  if (verts[a * 3 + 2] < PEDESTAL || verts[b * 3 + 2] < PEDESTAL || verts[c * 3 + 2] < PEDESTAL) continue
  idx.push(a, b, c)
}
let pos = new Float32Array(verts)

// --- z-up/-y-front  ->  y-up/+z-front, feet on the floor, metres
const geo = new THREE.BufferGeometry()
geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3))
geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1))
geo.computeBoundingBox()
const bb = geo.boundingBox
const pivot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.min.z)
const scale = HEIGHT / (bb.max.z - bb.min.z)
const M = new THREE.Matrix4()
  .makeTranslation(-pivot.x, -pivot.y, -pivot.z)
  .premultiply(new THREE.Matrix4().makeScale(scale, scale, scale))
  .premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
  .premultiply(new THREE.Matrix4().makeTranslation(0, 0, 0))
geo.applyMatrix4(M)
geo.computeBoundingBox()
const nb = geo.boundingBox
// re-centre so x/z are symmetric and the feet touch y = 0
geo.translate(-(nb.min.x + nb.max.x) / 2, -nb.min.y, -(nb.min.z + nb.max.z) / 2)
geo.computeBoundingBox()

// --- decimate
await MeshoptSimplifier.ready
let p = geo.attributes.position.array
let ix = geo.index.array
const target = Math.min(TARGET_TRIS * 3, ix.length)
const [simp, error] = MeshoptSimplifier.simplify(ix, p, 3, target, 0.02, ['LockBorder'])
console.log('simplify', ix.length / 3, '->', simp.length / 3, 'error', error.toFixed(5))
// drop the vertices the simplification orphaned
const keep = new Map()
const newIdx = new Uint32Array(simp.length)
let vc = 0
for (let i = 0; i < simp.length; i++) {
  let n = keep.get(simp[i])
  if (n === undefined) { n = vc++; keep.set(simp[i], n) }
  newIdx[i] = n
}
const pack = new Float32Array(vc * 3)
for (const [from, to] of keep) { pack[to * 3] = p[from * 3]; pack[to * 3 + 1] = p[from * 3 + 1]; pack[to * 3 + 2] = p[from * 3 + 2] }
const g2 = new THREE.BufferGeometry()
g2.setAttribute('position', new THREE.BufferAttribute(pack, 3))
g2.setIndex(new THREE.BufferAttribute(newIdx, 1))

// --- paint (runs on the final mesh so the colours land on the real vertices)
g2.computeVertexNormals()
const pos2 = g2.attributes.position
const col = new Float32Array(pos2.count * 3)
const WHITE = [1.0, 0.992, 0.973]
const INK = [0.169, 0.106, 0.184]
const BLUSH = [1.0, 0.62, 0.73]
const PINK = [1.0, 0.71, 0.8]
for (let i = 0; i < pos2.count; i++) {
  let c = WHITE
  const x = pos2.getX(i), y = pos2.getY(i), z = pos2.getZ(i)
  for (const m of PAINT.masks || []) {
    const dx = (x - m.x) / m.rx, dy = (y - m.y) / m.ry, dz = (z - m.z) / (m.rz ?? 0.3)
    if (dx * dx + dy * dy + dz * dz <= 1) { c = m.color === 'ink' ? INK : m.color === 'blush' ? BLUSH : m.color === 'pink' ? PINK : WHITE; break }
  }
  col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]
}
g2.setAttribute('color', new THREE.BufferAttribute(col, 3))

// --- write a minimal GLB (one mesh, vertex colours)
const P = g2.attributes.position.array, N = g2.attributes.normal.array, C = g2.attributes.color.array, I = g2.index.array
const bin = Buffer.alloc(P.byteLength + N.byteLength + C.byteLength + I.byteLength)
let o = 0
Buffer.from(P.buffer).copy(bin, o); const oP = o; o += P.byteLength
Buffer.from(N.buffer).copy(bin, o); const oN = o; o += N.byteLength
Buffer.from(C.buffer).copy(bin, o); const oC = o; o += C.byteLength
Buffer.from(I.buffer).copy(bin, o); const oI = o
const gltf = {
  asset: { version: '2.0', generator: 'planet/build-usagi' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Usagi' }],
  meshes: [{ name: 'Usagi', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
  materials: [{ name: 'usagi', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: [nb.min.x, nb.min.y, nb.min.z], max: [nb.max.x, nb.max.y, nb.max.z] },
    { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: C.length / 3, type: 'VEC3' },
    { bufferView: 3, componentType: 5125, count: I.length, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: oP, byteLength: P.byteLength, target: 34962 },
    { buffer: 0, byteOffset: oN, byteLength: N.byteLength, target: 34962 },
    { buffer: 0, byteOffset: oC, byteLength: C.byteLength, target: 34962 },
    { buffer: 0, byteOffset: oI, byteLength: I.byteLength, target: 34963 },
  ],
  buffers: [{ byteLength: bin.length }],
}
let json = Buffer.from(JSON.stringify(gltf), 'utf8')
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
const binPad = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4, 0)])
const head = Buffer.alloc(12)
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4)
head.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8)
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4)
fs.writeFileSync(OUT, Buffer.concat([head, jh, json, bh, binPad]))
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' kB',
  'tris', I.length / 3, 'verts', P.length / 3,
  'bbox', [nb.min.toArray(), nb.max.toArray()].map(a => a.map(v => +v.toFixed(3))))
