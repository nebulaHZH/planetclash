import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ownedMaterial } from './bake'
import { outlined } from './toon'
import type { GuestBuild } from './guests'

/**
 * 乌萨奇 as the user shipped him: a 16k-triangle sculpt (`model.stl` ->
 * `usagi.glb`, see `tools/build-usagi.mjs`). There is no skeleton and no UVs,
 * so the face is painted on the way a toy would be: flat colour patches that
 * are shrink-wrapped onto the sculpt with a few raycasts, then merged into the
 * body so the whole rabbit is still one draw call.
 *
 * The sculpt's own relief is about 1mm on a 64mm figure — a flat sticker would
 * either float or get pierced by it, hence the wrap.
 */

export type UsagiAsset = {
  /** Body + face, centred on the bbox so the outline shell scales evenly. */
  geometry: THREE.BufferGeometry
  height: number
  /** Half height: how far to lift the mesh so the feet sit on y = 0. */
  lift: number
}

const INK = '#2B1B2F'
const BLUSH = '#FF9EBB'
const GLINT = '#FFFDF8'
/** 乌萨奇 is the yellow one of the trio — same lemon as the palette. */
const BODY = '#FFE38A'

type Patch = {
  x: number
  y: number
  rx: number
  ry: number
  color: string
  /** Extra push along +Z, so stacked patches (eye then glint) never fight. */
  lift?: number
}

/** Measured off the sculpt, in metres above the feet. Front faces +Z. */
const FACE: Patch[] = [
  { x: -0.116, y: 0.752, rx: 0.042, ry: 0.05, color: INK },
  { x: 0.116, y: 0.752, rx: 0.042, ry: 0.05, color: INK },
  { x: -0.13, y: 0.774, rx: 0.014, ry: 0.015, color: GLINT, lift: 0.04 },
  { x: 0.102, y: 0.774, rx: 0.014, ry: 0.015, color: GLINT, lift: 0.04 },
  { x: -0.226, y: 0.658, rx: 0.058, ry: 0.048, color: BLUSH },
  { x: 0.226, y: 0.658, rx: 0.058, ry: 0.048, color: BLUSH },
]

function colorize(geo: THREE.BufferGeometry, hex: string) {
  const c = new THREE.Color(hex)
  const count = geo.attributes.position.count
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    out[i * 3] = c.r
    out[i * 3 + 1] = c.g
    out[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3))
  return geo
}

/** A disc of vertices dropped straight onto the sculpt from the front. */
function wrap(probe: THREE.Mesh, patch: Patch, seg = 6) {
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, 0, -1)
  const n = seg + 1
  const grid: THREE.Vector3[] = []
  const zs: number[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let u = (i / seg) * 2 - 1
      let v = (j / seg) * 2 - 1
      const r = Math.hypot(u, v)
      if (r > 1) {
        u /= r
        v /= r
      }
      const x = patch.x + u * patch.rx
      const y = patch.y + v * patch.ry
      ray.set(new THREE.Vector3(x, y, 2), down)
      const hit = ray.intersectObject(probe, false)[0]
      grid.push(new THREE.Vector3(x, y, hit ? hit.point.z : 0.34))
      zs.push(hit ? hit.point.z : 0.34)
    }
  }
  // The sculpt's eyes and cheeks are sunk into real cavities, and a patch that
  // followed them down would just disappear inside. Paint sits on the cavity
  // mouth instead: one flat plate at the frontmost surface the sample found.
  let top = -Infinity
  for (const z of zs) top = Math.max(top, z)

  const position = new Float32Array(grid.length * 3)
  for (let k = 0; k < grid.length; k++) {
    position[k * 3] = grid[k].x
    position[k * 3 + 1] = grid[k].y
    position[k * 3 + 2] = top + 0.006 + (patch.lift ?? 0)
  }
  const index: number[] = []
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return colorize(geo, patch.color)
}

/** Turn the shipped mesh into one vertex-coloured geometry with a face on it. */
export function buildUsagiAsset(root: THREE.Object3D): UsagiAsset {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) meshes.push(mesh)
  })
  const source = meshes[0]
  if (!source) throw new Error('usagi: glb has no mesh')

  const body = source.geometry.clone()
  body.applyMatrix4(source.matrixWorld)
  body.deleteAttribute('uv')
  body.deleteAttribute('uv1')
  colorize(body, BODY)
  if (!body.attributes.normal) body.computeVertexNormals()

  // A throwaway mesh to cast rays at; its own material is never drawn.
  const probe = new THREE.Mesh(body, new THREE.MeshBasicMaterial())
  const pieces = [body, ...FACE.map((patch) => wrap(probe, patch))]
  const merged = mergeGeometries(pieces, false)!
  for (const piece of pieces) piece.dispose()

  merged.computeBoundingBox()
  const box = merged.boundingBox!
  const centre = box.getCenter(new THREE.Vector3())
  merged.translate(-centre.x, -centre.y, -centre.z)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  const height = box.max.y - box.min.y
  merged.userData.shared = true
  return { geometry: merged, height, lift: height / 2 }
}

export function buildUsagi(asset: UsagiAsset): GuestBuild {
  const material = ownedMaterial()
  const group = new THREE.Group()
  const body = new THREE.Group()

  const mesh = new THREE.Mesh(asset.geometry, material)
  mesh.position.y = asset.lift
  mesh.castShadow = true
  mesh.receiveShadow = true
  body.add(outlined(mesh, 1.028))

  // Rigid toy: nothing splits at the neck, so `ToonRig` only gets to bob,
  // lean, squash and topple the body. The empty joints keep its API happy.
  const head = new THREE.Group()
  const arms = [new THREE.Group(), new THREE.Group()]
  const legs = [new THREE.Group(), new THREE.Group()]
  head.position.y = asset.height * 0.72

  const hands = new THREE.Group()
  // The sculpt is a plush hugging a pillow: the toy gun sits at the belly.
  hands.position.set(0, asset.height * 0.24, 0.27)
  group.add(body, hands)

  return { group, body, head, arms, legs, hands, height: asset.height, material }
}
