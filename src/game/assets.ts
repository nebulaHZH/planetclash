import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildUsagiAsset, type UsagiAsset } from './usagi'
import { buildNailongAsset } from './nailong'
import { ANIM_URLS, CHARACTER_URLS, GUN_URLS, nailongUrl, usagiUrl } from './glbs'

/** KayKit Rig_Medium animation packs we ship. All share the same 23-bone skeleton. */
const ANIM_PACKS = ['General', 'MovementBasic', 'CombatRanged', 'MovementAdvanced'] as const
const CHARACTER_MODELS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'] as const
// Poly Pizza CC-BY 3.0: Raygun by Gabriel Valdivia, Coil Gun by Vas Pupin,
// Sci-Fi Grenade Launcher by Christian Hohlfeld. Credit them wherever the game ships.
// `axis` is the model's own barrel axis in file space. Bounding boxes lie on the
// chunky ones (a big disc makes a pistol look square), so these are hand-checked.
const GUN_MODELS = [
  { name: 'raygun', axis: 'x', flip: false, tint: 0.14, grip: [0, 0, 0] },
  { name: 'coilgun', axis: 'x', flip: false, tint: 0.14, grip: [0, 0, 0] },
  // The launcher ships in drab army greys, so it needs a harder pull into the palette.
  // Its grip also sits forward of centre, so the viewmodel shifts to meet the fist.
  { name: 'launcher', axis: 'x', flip: false, tint: 0.44, grip: [-0.06, 0.0, -0.02] },
] as const

export type GunAsset = {
  /** A group centred on the origin with the barrel along +Z. */
  scene: THREE.Group
  /** Distance from origin to the muzzle, in world units. */
  tip: number
  /** Barrel-aligned bounding size, in metres. */
  size: THREE.Vector3
  /** How hard to pull the model's own colours toward the weapon colour. */
  tint: number
  /** Nudge that lines the model's grip up with the fist, in view space. */
  grip: readonly [number, number, number]
}

export type GameAssets = {
  characters: Map<string, THREE.Group>
  clips: THREE.AnimationClip[]
  guns: GunAsset[]
  /** Sculpted one-off guests, already baked into a single geometry. */
  sculpts: Map<string, UsagiAsset>
}

const loader = new GLTFLoader()

let pending: Promise<GameAssets> | null = null

export function loadGameAssets() {
  if (!pending) pending = load()
  return pending
}

async function load(): Promise<GameAssets> {
  const [charGltfs, animGltfs, gunGltfs, usagi, nailong] = await Promise.all([
    Promise.all(CHARACTER_MODELS.map((name) => loader.loadAsync(CHARACTER_URLS[name]))),
    Promise.all(ANIM_PACKS.map((name) => loader.loadAsync(ANIM_URLS[name]))),
    Promise.all(GUN_MODELS.map((gun) => loader.loadAsync(GUN_URLS[gun.name]))),
    loader.loadAsync(usagiUrl),
    loader.loadAsync(nailongUrl),
  ])

  const characters = new Map<string, THREE.Group>()
  CHARACTER_MODELS.forEach((name, i) => {
    const scene = charGltfs[i].scene
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.metalness = 0
      mat.roughness = 0.82
      // KayKit ships one skinned mesh per body part, so the head is easy to tag for headshots.
      if (/head|helmet|hat|hood/i.test(mesh.name) && !/shoulder/i.test(mesh.name)) mesh.userData.head = true
    })
    characters.set(name, scene)
  })

  const clips: THREE.AnimationClip[] = []
  for (const gltf of animGltfs) clips.push(...gltf.animations)

  const guns = gunGltfs.map((gltf, i) => normalizeGun(gltf.scene, 0.5, GUN_MODELS[i].flip, GUN_MODELS[i].axis, GUN_MODELS[i].tint, GUN_MODELS[i].grip))
  const sculpts = new Map<string, UsagiAsset>([
    ['Usagi', buildUsagiAsset(usagi.scene)],
    ['Nailong', buildNailongAsset(nailong.scene)],
  ])
  return { characters, clips, guns, sculpts }
}

/** Every hand-held enemy gun is scaled to this length so chibis carry proportional toys. */
export function heldGunScale(gun: GunAsset, length = 0.4) {
  return length / Math.max(0.06, gun.tip * 2)
}

/** Chunkier guns get capped here so they never fill the screen. */
const MAX_CROSS = 0.2

/** Centre a viewmodel gun on the origin, barrel along Z, scaled to `length` metres. */
function normalizeGun(scene: THREE.Group, length: number, flip: boolean, forcedAxis?: 'x' | 'y' | 'z', tint = 0.14, grip: readonly [number, number, number] = [0, 0, 0]): GunAsset {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.metalness = 0
    mat.roughness = 0.55
  })
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  // Sourced guns point down whatever axis their artist liked: turn the long one onto Z.
  const axis = forcedAxis ?? (size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z')
  const pivot = new THREE.Group()
  if (axis === 'x') pivot.rotation.y = -Math.PI / 2
  else if (axis === 'y') pivot.rotation.x = Math.PI / 2
  pivot.add(scene)
  pivot.updateMatrixWorld(true)
  const long = Math.max(size.x, size.y, size.z)
  const cross = [size.x, size.y, size.z].sort((a, b) => a - b)[1]
  let scale = length / Math.max(0.001, long)
  // A stubby toy gun scaled by length swallows the screen: cap its bulk instead.
  if (cross * scale > MAX_CROSS) scale = MAX_CROSS / Math.max(0.001, cross)
  // Artists disagree on which end is the muzzle; `flip` points it at +Z.
  if (flip) pivot.rotation.y += Math.PI
  pivot.scale.setScalar(scale)
  pivot.updateMatrixWorld(true)
  const scaled = new THREE.Box3().setFromObject(pivot)
  const center = scaled.getCenter(new THREE.Vector3())
  pivot.position.sub(center)

  const group = new THREE.Group()
  group.add(pivot)
  const final = new THREE.Vector3(size.x * scale, size.y * scale, size.z * scale)
  if (axis === 'x') final.set(size.z * scale, size.y * scale, size.x * scale)
  else if (axis === 'y') final.set(size.x * scale, size.z * scale, size.y * scale)
  return { scene: group, tip: final.z / 2, size: final, tint, grip }
}
