import * as THREE from 'three'
import { COLORS, WEAPONS, type CharacterConfig, type WeaponConfig } from '../config'
import type { Player } from './player'
import type { GameAudio } from './audio'
import { outlined, radialTexture, starGeometry, toon } from './toon'

export type WeaponHooks = {
  onShoot: (weapon: WeaponConfig, spread: number) => void
  onEmpty: () => void
  onReload: () => void
  onSwap: () => void
}

type Model = {
  group: THREE.Group
  flash: THREE.Sprite
  flashMat: THREE.SpriteMaterial
  mag: THREE.Object3D | null
  muzzle: THREE.Vector3
}

const HIP = new THREE.Vector3(0.32, -0.27, -0.80)
const ADS = new THREE.Vector3(0.19, -0.23, -0.60)
const _v = new THREE.Vector3()

export class WeaponSystem {
  index = 0
  ammo: number[] = []
  reserve: number[] = []
  bloom = 0
  kick = 0
  spread01 = 0
  aiming = false
  viewScene: THREE.Scene
  viewCamera: THREE.PerspectiveCamera
  private root = new THREE.Group()
  private models: Model[] = []
  private character: CharacterConfig | null = null
  private reloading = false
  private reloadT = 0
  private cooldown = 0
  private switchT = 1
  private flashT = 0
  private triggerHeld = false
  private queued = false
  private autoReload = -1
  private time = 0
  private swayX = 0
  private swayY = 0
  private aimLerp = 0
  private hooks: WeaponHooks
  private audio: GameAudio

  constructor(audio: GameAudio, hooks: WeaponHooks) {
    this.audio = audio
    this.hooks = hooks
    this.ammo = WEAPONS.map((w) => w.magazine)
    this.reserve = WEAPONS.map((w) => w.reserve)

    this.viewScene = new THREE.Scene()
    this.viewScene.add(new THREE.HemisphereLight('#FFF6FF', '#8C6AA8', 2.1))
    const key = new THREE.DirectionalLight('#FFF1D6', 1.7)
    key.position.set(0.6, 1.2, 0.7)
    this.viewScene.add(key)
    const rim = new THREE.DirectionalLight('#FF9FD0', 0.9)
    rim.position.set(-1, -0.4, -0.8)
    this.viewScene.add(rim)

    this.viewCamera = new THREE.PerspectiveCamera(74, 1, 0.01, 10)
    this.viewScene.add(this.viewCamera)
    this.viewCamera.add(this.root)
  }

  get weapon() {
    return WEAPONS[this.index]
  }

  setCharacter(character: CharacterConfig) {
    this.character = character
    for (const model of this.models) {
      this.root.remove(model.group)
      model.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
      model.flashMat.dispose()
    }
    this.models = []
    WEAPONS.forEach((weapon) => {
      const model = this.buildModel(weapon, character)
      model.group.visible = false
      this.root.add(model.group)
      this.models.push(model)
    })
    this.models[this.index].group.visible = true
  }

  private material(color: THREE.ColorRepresentation) {
    return toon(color)
  }

  private buildModel(weapon: WeaponConfig, character: CharacterConfig): Model {
    const group = new THREE.Group()
    const metal = this.material('#EFE9F7')
    const dark = this.material('#5B4276')
    const accent = this.material(character.accentColor)
    const accent2 = this.material(character.bodyColor)
    const gold = this.material(COLORS.gold)
    const skin = this.material(COLORS.skin)

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, outline = true) => {
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      if (outline) outlined(mesh, 1.06)
      group.add(mesh)
      return mesh
    }

    let muzzle = new THREE.Vector3(0, 0.04, -0.55)
    let mag: THREE.Object3D | null = null

    if (weapon.viewmodel === 'pistol') {
      const body = add(new THREE.CapsuleGeometry(0.075, 0.24, 6, 14), metal, 0, 0.03, -0.14)
      body.rotation.x = Math.PI / 2
      add(new THREE.BoxGeometry(0.055, 0.03, 0.3), accent, 0, 0.1, -0.12)
      add(new THREE.BoxGeometry(0.03, 0.05, 0.045), metal, 0, 0.13, -0.25)
      const nozzle = add(new THREE.CylinderGeometry(0.058, 0.078, 0.14, 12), dark, 0, 0.03, -0.37)
      nozzle.rotation.x = Math.PI / 2
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.017, 6, 16), gold)
      ring.position.set(0, 0.03, -0.43)
      ring.rotation.y = 0
      group.add(ring)
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 14, 10),
        toon(COLORS.sky, { transparent: true, opacity: 0.5 }),
      )
      bubble.position.set(0, 0.155, 0.02)
      group.add(bubble)
      const grip = add(new THREE.BoxGeometry(0.11, 0.24, 0.13), dark, 0, -0.17, 0.05)
      grip.rotation.x = 0.24
      add(new THREE.BoxGeometry(0.12, 0.035, 0.14), accent2, 0, -0.29, 0.08)
      const star = new THREE.Mesh(starGeometry(0.06, 0.024), gold)
      star.position.set(-0.078, 0.03, -0.16)
      star.rotation.y = -Math.PI / 2
      group.add(star)
      muzzle = new THREE.Vector3(0, 0.03, -0.5)
      this.addHands(group, skin, accent2, 0.01, -0.20, 0.03)
    } else if (weapon.viewmodel === 'smg') {
      add(new THREE.BoxGeometry(0.18, 0.19, 0.5), accent, 0, 0.03, -0.18)
      add(new THREE.BoxGeometry(0.13, 0.12, 0.34), metal, 0, 0.05, -0.42)
      const barrel = add(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10), dark, 0, 0.05, -0.6)
      barrel.rotation.x = Math.PI / 2
      const drum = add(new THREE.CylinderGeometry(0.11, 0.11, 0.17, 14), metal, 0, -0.14, -0.08)
      drum.rotation.z = Math.PI / 2
      mag = drum
      const grip = add(new THREE.BoxGeometry(0.11, 0.24, 0.14), dark, 0, -0.22, 0.08)
      grip.rotation.x = 0.28
      add(new THREE.BoxGeometry(0.07, 0.085, 0.16), accent2, 0, 0.02, 0.11)
      const ringColors = [COLORS.candy, COLORS.lemon, COLORS.mint]
      ringColors.forEach((color, i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 6, 16), this.material(color))
        ring.position.set(0, 0.05, -0.33 - i * 0.09)
        group.add(ring)
      })
      muzzle = new THREE.Vector3(0, 0.05, -0.73)
      this.addHands(group, skin, accent2, 0.08, -0.18, 0.07)
    } else {
      for (const x of [-0.07, 0.07]) {
        const barrel = add(new THREE.CylinderGeometry(0.062, 0.062, 0.66, 10), metal, x, 0.045, -0.38)
        barrel.rotation.x = Math.PI / 2
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.018, 6, 14), gold)
        band.position.set(x, 0.045, -0.66)
        group.add(band)
      }
      add(new THREE.BoxGeometry(0.22, 0.16, 0.3), accent, 0, 0.01, -0.12)
      const pump = add(new THREE.BoxGeometry(0.19, 0.13, 0.2), dark, 0, -0.04, -0.34)
      pump.rotation.x = 0.02
      const stock = add(new THREE.BoxGeometry(0.10, 0.14, 0.18), accent2, 0, -0.10, 0.09)
      stock.rotation.x = -0.14
      add(new THREE.BoxGeometry(0.1, 0.2, 0.12), dark, 0, -0.2, 0.08)
      const star = new THREE.Mesh(starGeometry(0.11, 0.045), gold)
      star.position.set(0.115, 0.03, -0.14)
      star.rotation.y = Math.PI / 2
      group.add(star)
      muzzle = new THREE.Vector3(0, 0.045, -0.73)
      this.addHands(group, skin, accent2, 0.08, -0.18, 0.08)
    }

    const flashMat = new THREE.SpriteMaterial({
      map: radialTexture(64, 'rgba(255,252,210,1)', 'rgba(255,170,210,0.35)'),
      color: weapon.color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const flash = new THREE.Sprite(flashMat)
    flash.position.copy(muzzle)
    flash.scale.setScalar(0.3)
    flash.visible = false
    group.add(flash)

    group.position.copy(HIP)
    group.scale.setScalar(0.55)
    return { group, flash, flashMat, mag, muzzle }
  }

  private addHands(group: THREE.Group, skin: THREE.Material, sleeve: THREE.Material, x: number, y: number, z: number) {
    // One chunky mitten on the grip reads better than a pair of tiny hands at this FOV.
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skin)
    hand.position.set(x + 0.045, y, z + 0.03)
    hand.scale.set(1.05, 0.9, 1.2)
    group.add(hand)
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.13, 4, 8), sleeve)
    arm.position.copy(hand.position).add(new THREE.Vector3(0.02, -0.15, 0.11))
    arm.rotation.x = 0.55
    arm.rotation.z = 0.12
    group.add(arm)
  }

  reset() {
    WEAPONS.forEach((weapon, i) => {
      this.ammo[i] = weapon.magazine
      this.reserve[i] = weapon.reserve
    })
    this.index = 0
    this.reloading = false
    this.reloadT = 0
    this.cooldown = 0
    this.switchT = 1
    this.bloom = 0
    this.kick = 0
    this.triggerHeld = false
    this.queued = false
    this.autoReload = -1
    this.spread01 = 0
    this.models.forEach((model, i) => {
      model.group.visible = i === 0
      model.group.position.copy(HIP)
      model.group.rotation.set(0, 0, 0)
    })
  }

  select(index: number) {
    const next = ((index % WEAPONS.length) + WEAPONS.length) % WEAPONS.length
    if (next === this.index) return
    this.models[this.index].group.visible = false
    this.index = next
    this.models[this.index].group.visible = true
    this.reloading = false
    this.reloadT = 0
    this.switchT = 0
    this.cooldown = Math.max(this.cooldown, 0.16)
    this.queued = false
    this.autoReload = -1
    this.hooks.onSwap()
    this.audio.equip()
  }

  cycle(direction: number) {
    this.select(this.index + direction)
  }

  triggerDown() {
    this.triggerHeld = true
    this.queued = true
  }

  triggerUp() {
    this.triggerHeld = false
  }

  reload() {
    const weapon = this.weapon
    if (this.reloading || this.ammo[this.index] >= weapon.magazine || this.reserve[this.index] <= 0) return
    this.reloading = true
    this.reloadT = 0
    this.queued = false
    this.hooks.onReload()
    this.audio.reload()
  }

  giveAmmo(amount: number) {
    const weapon = this.weapon
    this.reserve[this.index] = Math.min(weapon.reserve * 1.5, this.reserve[this.index] + amount)
  }

  update(dt: number, player: Player, aiming: boolean, triggerHeld: boolean, lookX: number, lookY: number) {
    this.time += dt
    const weapon = this.weapon
    this.aiming = aiming
    this.triggerHeld = triggerHeld
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.flashT = Math.max(0, this.flashT - dt)
    this.bloom = Math.max(0, this.bloom - dt * 3.2)
    this.kick = Math.max(0, this.kick - dt * 6)
    this.switchT = Math.min(1, this.switchT + dt / weapon.draw)
    this.aimLerp += ((aiming ? 1 : 0) - this.aimLerp) * Math.min(1, dt * 13)
    this.swayX += (-lookX * 0.0009 - this.swayX) * Math.min(1, dt * 9)
    this.swayY += (-lookY * 0.0009 - this.swayY) * Math.min(1, dt * 9)

    if (this.reloading) {
      this.reloadT += dt
      if (this.reloadT >= weapon.reload) {
        const need = weapon.magazine - this.ammo[this.index]
        const take = Math.min(need, this.reserve[this.index])
        this.ammo[this.index] += take
        this.reserve[this.index] -= take
        this.reloading = false
        this.reloadT = 0
      }
    }

    if (this.autoReload >= 0) {
      this.autoReload -= dt
      if (this.autoReload < 0) this.reload()
    }

    if (!this.reloading && this.switchT > 0.82 && this.cooldown <= 0) {
      if ((weapon.auto && triggerHeld) || this.queued) {
        this.fire()
      }
    }

    const movement = player.speedNorm * (aiming ? 0.006 : 0.03)
    const air = player.grounded ? 0 : 0.025
    const bloomSpread = this.bloom * 0.016
    const spread = (aiming ? weapon.spreadAim : weapon.spreadHip) + movement + air + bloomSpread
    this.spread01 = THREE.MathUtils.clamp(spread / 0.14, 0, 1)

    this.animate(dt, player)
  }

  private fire() {
    const weapon = this.weapon
    if (this.ammo[this.index] <= 0) {
      this.queued = false
      this.cooldown = 0.4
      this.hooks.onEmpty()
      this.audio.empty()
      this.autoReload = 0.18
      return
    }
    this.queued = false
    this.ammo[this.index] -= 1
    this.cooldown = 1 / weapon.rate
    this.bloom = Math.min(1.6, this.bloom + 0.1 + weapon.recoil * 0.09)
    this.kick = Math.min(1, this.kick + 0.35 + weapon.recoil * 0.12)
    this.flashT = 0.055
    const spread = (this.aiming ? weapon.spreadAim : weapon.spreadHip) + this.bloom * 0.012 + 0.004
    this.audio.shoot(weapon.sound)
    this.hooks.onShoot(weapon, spread)
    if (this.ammo[this.index] === 0) this.autoReload = 0.22
  }

  private animate(dt: number, player: Player) {
    const model = this.models[this.index]
    if (!model) return
    const group = model.group
    const moving = player.grounded ? player.speedNorm : 0.25
    const phase = player.bobPhase
    const bobX = Math.sin(phase) * 0.014 * moving
    const bobY = Math.abs(Math.cos(phase)) * -0.012 * moving
    const lift = 1 - this.switchT
    const reloadPhase = this.reloading ? Math.min(1, this.reloadT / this.weapon.reload) : 0
    const dip = Math.sin(reloadPhase * Math.PI)

    _v.copy(HIP).lerp(ADS, this.aimLerp)
    _v.x += bobX * (1 - this.aimLerp * 0.7) + this.swayX
    _v.y += bobY + this.swayY - player.landDip * 0.45 - lift * 0.5 + this.kick * 0.018 - dip * 0.13
    _v.z += this.kick * 0.06
    group.position.lerp(_v, 1 - Math.exp(-24 * dt))

    const rotX = this.kick * 0.24 - lift * 0.7 + dip * 0.55
    const rotY = this.swayX * 3.5 + (1 - this.aimLerp) * 0.07
    const rotZ = lift * 0.35 + Math.sin(phase) * 0.012 * moving + dip * 0.2
    group.rotation.x += (rotX - group.rotation.x) * Math.min(1, dt * 18)
    group.rotation.y += (rotY - group.rotation.y) * Math.min(1, dt * 12)
    group.rotation.z += (rotZ - group.rotation.z) * Math.min(1, dt * 12)

    if (model.mag) {
      model.mag.position.y = -0.14 - dip * 0.34
    }

    for (const m of this.models) {
      m.flash.visible = m === model && this.flashT > 0
      if (m.flash.visible) {
        m.flashMat.opacity = Math.min(1, this.flashT * 22)
        const scale = 0.26 + Math.random() * 0.16
        m.flash.scale.setScalar(scale)
        m.flash.material.rotation = Math.random() * Math.PI
      }
    }
  }

  get reloadProgress() {
    return this.reloading ? Math.min(1, this.reloadT / this.weapon.reload) : 0
  }

  get isReloading() {
    return this.reloading
  }

  /** Muzzle position in main-camera space, for tracers. */
  muzzleWorld(camera: THREE.Camera, out: THREE.Vector3) {
    const model = this.models[this.index]
    if (!model) return out.copy(camera.position)
    model.flash.getWorldPosition(out)
    return camera.localToWorld(out)
  }
}
