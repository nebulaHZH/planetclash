/**
 * Legacy: the Kenney GLB cover props. `world.ts` now builds cover procedurally
 * in `cover.ts` so the crates, fences and columns share the candy palette, so
 * nothing calls `loadPropAssets()` any more. Kept only for the `seeded` RNG and
 * the `Obstacle` type, which are still in use.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { gradientMap } from './toon'

export type PropAsset = {
  scene: THREE.Group
  /** Half of the widest horizontal footprint, in model units. */
  footprint: number
  /** Model height in model units, with the base at y = 0. */
  height: number
}

export type Obstacle = {
  dir: THREE.Vector3
  radius: number
  height: number
}

export type PropKind = 'tree' | 'rock' | 'block' | 'wall' | 'column' | 'barricade' | 'bush'

const FILES: { file: string; kind: PropKind }[] = [
  { file: 'nature/tree_default.glb', kind: 'tree' },
  { file: 'nature/tree_cone.glb', kind: 'tree' },
  { file: 'nature/tree_fat.glb', kind: 'tree' },
  { file: 'nature/rock_largeA.glb', kind: 'rock' },
  { file: 'nature/rock_largeB.glb', kind: 'rock' },
  { file: 'nature/rock_tallA.glb', kind: 'rock' },
  { file: 'nature/rock_tallB.glb', kind: 'rock' },
  { file: 'nature/rock_smallA.glb', kind: 'rock' },
  { file: 'nature/log_large.glb', kind: 'rock' },
  { file: 'nature/plant_bush.glb', kind: 'bush' },
  { file: 'nature/mushroom_red.glb', kind: 'bush' },
  { file: 'arena/block.glb', kind: 'block' },
  { file: 'arena/wall.glb', kind: 'wall' },
  { file: 'arena/column.glb', kind: 'column' },
  { file: 'arena/column-damaged.glb', kind: 'column' },
  { file: 'arena/bricks.glb', kind: 'block' },
  { file: 'town/barricade-doorway-a.glb', kind: 'barricade' },
  { file: 'town/barricade-window-a.glb', kind: 'barricade' },
  { file: 'town/wall-low.glb', kind: 'wall' },
]

// Structural props drop Kenney's atlas and use flat macaron colours; nature keeps its
// painted texture so leaves and trunks still read as different materials.
const FLAT: Partial<Record<PropKind, string>> = {
  block: '#FFC65C',
  wall: '#F2B8CE',
  column: '#F5E9CE',
  barricade: '#FF9FC0',
}

const loader = new GLTFLoader()
let pending: Promise<Map<PropKind, PropAsset[]>> | null = null

export function loadPropAssets() {
  if (!pending) pending = load()
  return pending
}

async function load(): Promise<Map<PropKind, PropAsset[]>> {
  const gltfs = await Promise.all(FILES.map((entry) => loader.loadAsync(`/assets/props/${entry.file}`)))
  const byKind = new Map<PropKind, PropAsset[]>()
  gltfs.forEach((gltf, i) => {
    const { scene } = gltf
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const src = mesh.material as THREE.MeshStandardMaterial
      if (src) {
        const kind = FILES[i].kind
        const flat = FLAT[kind]
        // Same 3-step ramp as the characters so props sit in the toy world.
        const mat = new THREE.MeshToonMaterial({
          map: flat ? null : (src.map ?? null),
          color: flat ? new THREE.Color(flat) : new THREE.Color(src.color),
          gradientMap: gradientMap(),
          vertexColors: src.vertexColors,
        })
        mesh.material = mat
        src.dispose()
      }
    })
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    scene.position.y -= box.min.y
    const asset: PropAsset = {
      scene,
      footprint: Math.max(size.x, size.z) / 2,
      height: Math.max(0.001, size.y),
    }
    const { kind } = FILES[i]
    const list = byKind.get(kind) ?? []
    list.push(asset)
    byKind.set(kind, list)
  })
  return byKind
}

/** Tiny deterministic RNG so the arena layout is the same on every load. */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
