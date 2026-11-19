import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { heldGunScale, type GunAsset } from './assets'

type PlayOptions = {
  fade?: number
  once?: boolean
}

/**
 * One animated KayKit character. The root sits at the feet and faces +Z;
 * the body model is scaled to ~1.9 m so it reads at gameplay distance.
 */
export class CharacterRig {
  readonly root = new THREE.Group()
  readonly model: THREE.Group
  readonly mixer: THREE.AnimationMixer
  readonly height: number
  private actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private currentName = ''
  private materials: THREE.MeshStandardMaterial[] = []
  private hand: THREE.Object3D | null = null
  private holder = new THREE.Group()
  private gunTip = new THREE.Object3D()
  private flashValue = 0

  constructor(source: THREE.Group, clips: THREE.AnimationClip[], scale = 0.74) {
    this.model = cloneSkeleton(source) as THREE.Group
    this.model.scale.setScalar(scale)
    this.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone()
      mat.metalness = 0
      mat.roughness = 0.82
      mat.emissive = new THREE.Color('#FFFFFF')
      mat.emissiveIntensity = 0
      mesh.material = mat
      this.materials.push(mat)
    })

    this.root.add(this.model)
    this.hand = this.model.getObjectByName('handslotr') ?? this.model.getObjectByName('hand.r') ?? null
    this.root.add(this.holder)
    this.holder.add(this.gunTip)

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of clips) {
      if (clip.name === 'T-Pose' || this.actions.has(clip.name)) continue
      this.actions.set(clip.name, this.mixer.clipAction(clip))
    }

    const box = new THREE.Box3().setFromObject(this.model)
    this.height = Math.max(1.4, box.max.y - box.min.y)
  }

  has(clip: string) {
    return this.actions.has(clip)
  }

  get playing() {
    return this.currentName
  }

  play(name: string, options: PlayOptions = {}) {
    const next = this.actions.get(name)
    if (!next) return
    const fade = options.fade ?? 0.18
    if (this.current === next && !options.once) return

    const once = options.once ?? false
    next.reset()
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.enabled = true
    next.setEffectiveTimeScale(1)
    next.setEffectiveWeight(1)
    if (this.current && this.current !== next) this.current.fadeOut(fade)
    next.fadeIn(fade).play()
    this.current = next
    this.currentName = name
  }

  setGun(gun: GunAsset | null) {
    while (this.holder.children.length > 0) this.holder.remove(this.holder.children[0])
    if (!gun) return
    const clone = gun.scene.clone(true)
    // Seat the grip in the palm and lift it a touch so the barrel clears the arm.
    // Models arrive normalised around their own centre, so scaling them up would
    // bury the grip in the fist — push the clone forward by the growth instead.
    const k = heldGunScale(gun)
    clone.scale.setScalar(k)
    clone.position.set(0.02, 0.06, 0.1 + gun.tip * (k - 1))
    this.holder.add(clone)
    this.gunTip.position.set(0.02, 0.06, 0.1 + gun.tip * k)
    this.holder.add(this.gunTip)
  }

  flash(amount: number) {
    this.flashValue = amount
    for (const mat of this.materials) mat.emissiveIntensity = amount * 1.5
  }

  get flashing() {
    return this.flashValue > 0.001
  }

  update(dt: number) {
    this.mixer.update(dt)
    this.root.updateMatrixWorld(true)
    if (!this.hand) return
    const p = this.hand.getWorldPosition(_p)
    this.root.worldToLocal(p)
    this.holder.position.copy(p)
    if (this.flashValue > 0) {
      this.flashValue = Math.max(0, this.flashValue - dt * 5)
      for (const mat of this.materials) mat.emissiveIntensity = this.flashValue * 1.5
    }
  }

  muzzle(out: THREE.Vector3) {
    this.gunTip.getWorldPosition(out)
    return out
  }

  dispose() {
    this.mixer.stopAllAction()
    this.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    })
    for (const mat of this.materials) mat.dispose()
  }
}

const _p = new THREE.Vector3()
