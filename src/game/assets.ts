import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** KayKit Rig_Medium animation packs we ship. All share the same 23-bone skeleton. */
const ANIM_PACKS = ['General', 'MovementBasic', 'CombatRanged', 'MovementAdvanced'] as const
const CHARACTER_MODELS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'] as const
const GUN_MODELS = ['blaster-d', 'blaster-g', 'blaster-j', 'blaster-m'] as const

export type GunAsset = {
  /** A group centred on the origin with the barrel along +Z. */
  scene: THREE.Group
  /** Distance from origin to the muzzle, in world units. */
  tip: number
}

export type GameAssets = {
  characters: Map<string, THREE.Group>
  clips: THREE.AnimationClip[]
  guns: GunAsset[]
}

const loader = new GLTFLoader()

let pending: Promise<GameAssets> | null = null

export function loadGameAssets() {
  if (!pending) pending = load()
  return pending
}

async function load(): Promise<GameAssets> {
  const [charGltfs, animGltfs, gunGltfs] = await Promise.all([
    Promise.all(CHARACTER_MODELS.map((name) => loader.loadAsync(`/assets/chars/${name}.glb`))),
    Promise.all(ANIM_PACKS.map((name) => loader.loadAsync(`/assets/anim/Rig_Medium_${name}.glb`))),
    Promise.all(GUN_MODELS.map((name) => loader.loadAsync(`/assets/guns/${name}.glb`))),
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

  const guns = gunGltfs.map((gltf) => normalizeGun(gltf.scene, 0.66))
  return { characters, clips, guns }
}

/** Centre a Kenney blaster on the origin and scale it to `length` metres. */
function normalizeGun(scene: THREE.Group, length: number): GunAsset {
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
  const scale = length / Math.max(0.001, Math.max(size.x, size.y, size.z))
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  box.setFromObject(scene)
  const center = box.getCenter(new THREE.Vector3())
  scene.position.sub(center)

  const group = new THREE.Group()
  group.add(scene)
  const tip = (size.z * scale) / 2
  return { scene: group, tip }
}
