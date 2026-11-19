import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ownedMaterial } from './bake'
import { outlined } from './toon'
import type { GuestBuild } from './guests'
import type { UsagiAsset } from './usagi'

/**
 * 奶龙 as a fan sculpt (`nailong_colored.blend` -> `model.glb`). The source has
 * no skeleton, no UVs and no textures — its colour is already a baked vertex
 * layer (butter-yellow body fading to a cream belly, green eyes, ink mouth), so
 * the sculpt drops straight into the same one-draw-call pipeline as 乌萨奇.
 *
 * Rebuild with Blender:
 *   /tmp/convert4.py — bakes material x gradient into one colour attribute,
 *   decimates 68k -> 23k tris, re-centres the feet on y = 0, exports COLOR_0.
 */

export type NailongAsset = UsagiAsset

/** Bake every primitive into one vertex-coloured geometry, centred on its bbox. */
export function buildNailongAsset(root: THREE.Object3D): NailongAsset {
  root.updateMatrixWorld(true)
  const pieces: THREE.BufferGeometry[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry.clone()
    geo.applyMatrix4(mesh.matrixWorld)
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') geo.deleteAttribute(name)
    }
    if (!geo.attributes.normal) geo.computeVertexNormals()
    // glTF stores vertex colours as RGB; three wants RGBA in the shader path we
    // share with the procedural bakes only when alpha is present, so 3 is fine.
    if (geo.attributes.color.itemSize !== 3) {
      const src = geo.attributes.color
      const out = new Float32Array(src.count * 3)
      for (let i = 0; i < src.count; i++) {
        out[i * 3] = src.getX(i)
        out[i * 3 + 1] = src.getY(i)
        out[i * 3 + 2] = src.getZ(i)
      }
      geo.setAttribute('color', new THREE.BufferAttribute(out, 3))
    }
    pieces.push(geo)
  })
  if (!pieces.length) throw new Error('nailong: glb has no mesh')

  const merged = pieces.length === 1 ? pieces[0] : mergeGeometries(pieces, false)!
  if (pieces.length > 1) for (const piece of pieces) piece.dispose()

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

export function buildNailong(asset: NailongAsset): GuestBuild {
  const material = ownedMaterial()
  const group = new THREE.Group()
  const body = new THREE.Group()

  const mesh = new THREE.Mesh(asset.geometry, material)
  mesh.position.y = asset.lift
  mesh.castShadow = true
  mesh.receiveShadow = true
  body.add(outlined(mesh, 1.03))

  // Rigid toy again: `ToonRig` only bobs/leans/squashes the body, so the joints
  // below exist purely to satisfy the `GuestBuild` contract.
  const head = new THREE.Group()
  head.position.y = asset.height * 0.74
  const arms = [new THREE.Group(), new THREE.Group()]
  const legs = [new THREE.Group(), new THREE.Group()]

  // Short arms, huge belly: the gun rides out in front of the tummy, where a
  // plush would hold it.
  const hands = new THREE.Group()
  hands.position.set(0.16, asset.height * 0.47, 0.44)
  group.add(body, hands)

  return { group, body, head, arms, legs, hands, height: asset.height, material }
}
