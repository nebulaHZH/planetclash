import * as THREE from 'three'
import { heldGunScale, type GunAsset } from './assets'
import { bakedMaterial, bakeGroup } from './bake'
import { buildGuest, isGuest, type GuestBuild } from './guests'
import { buildUsagi, type UsagiAsset } from './usagi'
import { buildNailong } from './nailong'
import { toon } from './toon'
import type { CharacterConfig } from '../config'

/**
 * A tiny hand-animated rig for the procedural guest characters. It exposes the
 * same surface as `CharacterRig` so `enemies.ts` can treat both the same way:
 * KayKit clip names come in, `play()` turns them into pose weights, and
 * `update()` eases the pose over. No mixer, no skeleton, no clips to load.
 */
let mittMat: THREE.MeshToonMaterial | null = null
/** Muzzle cant for held enemy guns, radians. */
const CANT_X = -0.1
const CANT_Y = 0.8
const CANT_Z = 0.05

export class ToonRig {
  readonly root = new THREE.Group()
  readonly height: number
  private build: GuestBuild
  private tip = new THREE.Object3D()
  private gunBase = new THREE.Vector3()
  private t = Math.random() * 8
  private aimTarget = 0
  private aim = 0
  private recoil = 0
  private hurt = 0
  private dead = 0
  private spawn = 0
  private flashValue = 0
  private currentName = 'Idle_A'

  constructor(config: CharacterConfig, sculpts?: Map<string, UsagiAsset>) {
    // Sculpted guests (乌萨奇) ship as a baked geometry; the rest are built from
    // primitives. Either way the rig only ever sees a `GuestBuild`.
    const sculpt = sculpts?.get(config.model)
    const fallback = isGuest(config.model) && !sculpt ? config.model : 'Chiikawa'
    this.build = sculpt ? (config.model === 'Nailong' ? buildNailong(sculpt) : buildUsagi(sculpt)) : buildGuest(fallback)
    this.height = this.build.height
    this.build.group.add(this.tip)
    this.root.add(this.build.group)
  }

  has() {
    return true
  }

  get playing() {
    return this.currentName
  }

  play(name: string) {
    this.currentName = name
    switch (name) {
      case 'Ranged_1H_Aiming':
        this.aimTarget = 1
        break
      case 'Ranged_1H_Shoot':
        this.recoil = 1
        this.aimTarget = 1
        break
      case 'Hit_A':
        this.hurt = 1
        break
      case 'Death_A':
        if (this.dead === 0) this.dead = 0.0001
        break
      case 'Spawn_Ground':
        this.spawn = 1
        break
      default:
        this.aimTarget = 0
    }
  }

  setGun(gun: GunAsset | null) {
    const hands = this.build.hands
    while (hands.children.length > 0) hands.remove(hands.children[0])
    this.gunBase.copy(hands.position)
    if (!gun) {
      this.tip.position.set(0, 0, 0)
      hands.add(this.tip)
      return
    }
    const clone = gun.scene.clone(true)
    // The gun models are shared between every enemy, so their geometry must not
    // be swept up by `dispose()` when one rig goes away.
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.userData.shared = true
    })
    const k = heldGunScale(gun, 0.52)
    const half = gun.tip * k
    clone.scale.setScalar(k)
    clone.position.set(0, -0.02, half)
    // A guest that faces the player points its barrel straight down the camera
    // axis, which reads as a stub. Canting the muzzle to its right keeps a bit
    // of the barrel in profile without looking like it aims elsewhere.
    clone.rotation.set(-CANT_X, CANT_Y, CANT_Z)
    hands.add(clone)

    // Muzzle marker rides the gun, so recoil and the cant move it too.
    this.tip.position.set(0, -0.02 / k, gun.tip)
    clone.add(this.tip)

    const hold = new THREE.Group()
    hold.position.copy(clone.position)
    hold.rotation.copy(clone.rotation)
    hold.add(this.buildMitts(half * 2))
    hands.add(hold)
  }

  /**
   * A guest has stub arms, so a bare gun reads as floating. Two baked mitts
   * pinched around the grip and the fore-end are what sell the hold — one
   * extra draw call, shared material, no skeleton.
   */
  private buildMitts(length: number) {
    if (!mittMat) mittMat = toon('#FFE9D2')
    const parts = new THREE.Group()
    const ball = (z: number, r: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mittMat!)
      m.position.set(0, -0.085, z)
      m.scale.set(1, 0.94, 1.15)
      parts.add(m)
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(r * 0.52, 10, 8), mittMat!)
      knuckle.position.set(0, -0.055, z + r * 0.55)
      parts.add(knuckle)
    }
    ball(-length * 0.3, 0.072)
    ball(length * 0.14, 0.062)
    const mesh = bakeGroup(parts, bakedMaterial())
    parts.clear()
    return mesh
  }

  flash(amount: number) {
    this.flashValue = amount
    this.build.material.emissive.set('#FFFFFF')
    this.build.material.emissiveIntensity = amount * 1.4
  }

  muzzle(out: THREE.Vector3) {
    this.tip.getWorldPosition(out)
    return out
  }

  update(dt: number) {
    this.t += dt
    const ease = 1 - Math.exp(-11 * dt)
    this.aim += (this.aimTarget - this.aim) * ease
    this.recoil = Math.max(0, this.recoil - dt * 4.5)
    this.hurt = Math.max(0, this.hurt - dt * 4)
    if (this.spawn > 0) this.spawn = Math.max(0, this.spawn - dt / 0.75)
    if (this.dead > 0 && this.dead < 1) this.dead = Math.min(1, this.dead + dt / 0.7)

    const b = this.build
    const body = b.body
    const breath = Math.sin(this.t * 2.1)
    const settle = Math.sin(this.t * 1.4 + 1) * 0.05 * (1 - this.aim)

    // A death roll and a pop-up from the ground both own the whole body.
    const alive = this.dead > 0 ? 0 : 1
    const rise = this.spawn > 0 ? 1 - this.spawn : 1
    const pop = this.spawn > 0 ? Math.sin(rise * Math.PI) * 0.06 : 0

    body.position.y = breath * 0.014 * alive - (1 - rise) * 1.5 - this.dead * 0.12 + pop
    body.rotation.x = this.aim * 0.11 + this.dead * 1.5
    body.rotation.z = Math.sin(this.t * 0.9) * 0.02 * (1 - this.aim)
    const squash = this.hurt * 0.9
    body.scale.set(1 + squash * 0.12, 1 - squash * 0.16, 1 + squash * 0.12)

    b.head.rotation.z = settle
    b.head.rotation.x = -this.aim * 0.12 + this.dead * 0.3

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1
      const arm = b.arms[i]
      const swing = Math.sin(this.t * 2.1 + (side > 0 ? 0.6 : -0.6)) * 0.08
      arm.rotation.x = swing - this.aim * 1.05 - this.recoil * 0.35 * (side > 0 ? 1 : 0.4)
      arm.rotation.z = side * (0.16 - this.aim * 0.4)
      b.legs[i].rotation.x = Math.sin(this.t * 2.1 + (side > 0 ? Math.PI : 0)) * 0.05 * (1 - this.dead)
    }

    const hands = b.hands
    hands.position.set(this.gunBase.x, this.gunBase.y, this.gunBase.z - this.recoil * 0.09)
    hands.rotation.x = -this.recoil * 0.5 - this.aim * 0.05

    if (this.flashValue > 0) {
      this.flashValue = Math.max(0, this.flashValue - dt * 5)
      this.build.material.emissiveIntensity = this.flashValue * 1.4
    }

    this.root.updateMatrixWorld(true)
  }

  dispose() {
    this.build.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      // Sculpted guests share one baked geometry across every instance.
      if (mesh.isMesh && !mesh.geometry.userData.shared) mesh.geometry.dispose()
    })
    this.build.material.dispose()
  }
}
