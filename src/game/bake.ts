import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS } from '../config'
import { toon } from './toon'

/**
 * Flatten a tree of coloured meshes into a single vertex-coloured geometry.
 * One call = one draw call, which is what lets the world hold ~200 props and a
 * handful of hand-built characters without touching the frame budget.
 */

let shared: THREE.MeshToonMaterial | null = null

/** The shared material every baked prop draws with. */
export function bakedMaterial(): THREE.MeshToonMaterial {
  if (!shared) {
    shared = toon(COLORS.white)
    shared.vertexColors = true
  }
  return shared
}

/** A baked material owned by one object, so `emissive` can flash it alone. */
export function ownedMaterial(): THREE.MeshToonMaterial {
  const mat = toon(COLORS.white)
  mat.vertexColors = true
  return mat
}

export function bakeGroup(group: THREE.Object3D, material: THREE.Material = bakedMaterial()): THREE.Mesh {
  group.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    geo.deleteAttribute('uv')
    geo.deleteAttribute('uv1')
    const flat = geo.index ? geo.toNonIndexed() : geo
    if (flat !== geo) geo.dispose()
    const color = (mesh.material as THREE.MeshToonMaterial).color
    const count = flat.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(flat)
  })
  const merged = mergeGeometries(parts, false)!
  for (const part of parts) part.dispose()
  merged.computeBoundingSphere()
  const mesh = new THREE.Mesh(merged, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
