import * as THREE from 'three'
import { COLORS, WEAPONS, type CharacterConfig, type WeaponConfig } from '../config'
import type { Player } from './player'
import type { GameAudio } from './audio'
import type { GunAsset } from './assets'
import { OUTLINE_MAT, gradientMap, toon } from './toon'

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
  flashLight: THREE.PointLight
  mag: THREE.Object3D | null
  magBase: THREE.Vector3
  gun: THREE.Object3D | null
  grip: readonly [number, number, number]
  mats: THREE.Material[]
  geos: THREE.BufferGeometry[]
}

const HIP = new THREE.Vector3(0.152, -0.143, -0.485)
const ADS = new THREE.Vector3(0.0, -0.185, -0.52)
/** Sourced guns are normalised to 0.5 m in assets.ts; this is the on-screen length. */
const GUN_LENGTH = 0.4
const _v = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _right = new THREE.Vector3(1, 0, 0)
const _tmp = new THREE.Vector3()
/** One finger, reused by both hands: a capsule lying along its own Y. */
const fingerGeo = new THREE.CapsuleGeometry(0.0105, 0.036, 4, 12)
/** Fingertip/nail-side cap, reused by both hands. */
const tipGeo = new THREE.SphereGeometry(0.0105, 12, 10)
const _alongX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
const _alongZ = new THREE.Quaternion().setFromAxisAngle(_right, Math.PI / 2)
const _tint = new THREE.Color()

type Shell = { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }

let flashTex: THREE.CanvasTexture | null = null
/** Six-point spark with a hot core, drawn once and shared by every gun. */
function muzzleFlashTexture() {
  if (flashTex) return flashTex
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.26, 'rgba(255,255,255,0.92)')
  glow.addColorStop(0.52, 'rgba(255,255,255,0.26)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  ctx.translate(c, c)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3)
    const ray = ctx.createLinearGradient(0, 0, 0, -c)
    ray.addColorStop(0, 'rgba(255,255,255,0.95)')
    ray.addColorStop(0.6, 'rgba(255,255,255,0.35)')
    ray.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = ray
    ctx.beginPath()
    ctx.moveTo(-6.5, 0)
    ctx.lineTo(0, -c * 0.96)
    ctx.lineTo(6.5, 0)
    ctx.closePath()
    ctx.fill()
  }
  flashTex = new THREE.CanvasTexture(canvas)
  flashTex.colorSpace = THREE.SRGBColorSpace
  return flashTex
}

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
  private shells: Shell[] = []
  private guns: GunAsset[] = []
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

    const shellGeo = new THREE.CylinderGeometry(0.0075, 0.0075, 0.022, 6)
    const shellMat = new THREE.MeshBasicMaterial({ color: COLORS.gold })
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(shellGeo, shellMat)
      mesh.visible = false
      this.viewScene.add(mesh)
      this.shells.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 })
    }
  }

  get weapon() {
    return WEAPONS[this.index]
  }

  setGuns(guns: GunAsset[]) {
    this.guns = guns
    if (this.character) this.setCharacter(this.character)
  }

  setCharacter(character: CharacterConfig) {
    this.character = character
    for (const model of this.models) {
      this.root.remove(model.group)
      model.flashMat.dispose()
      // Gun geometry/maps belong to the shared asset pack, so only dispose what we built here.
      for (const mat of model.mats) mat.dispose()
      for (const geo of model.geos) geo.dispose()
    }
    this.models = []
    WEAPONS.forEach((weapon, i) => {
      const model = this.buildModel(weapon, character, this.guns[i])
      model.group.visible = false
      this.root.add(model.group)
      this.models.push(model)
    })
    this.models[this.index].group.visible = true
  }

  private buildModel(weapon: WeaponConfig, character: CharacterConfig, asset?: GunAsset): Model {
    const group = new THREE.Group()
    const mats: THREE.Material[] = []
    const geos: THREE.BufferGeometry[] = []
    const glove = toon('#43304F')
    const sleeve = toon(character.accentColor)
    mats.push(glove, sleeve)
    const muzzle = new THREE.Vector3(0, 0.012, -0.34)
    let gunObj: THREE.Object3D | null = null
    let mag: THREE.Object3D | null = null
    const magBase = new THREE.Vector3()

    const cuffMat = toon('#FFFDF8')
    const skinMat = toon(COLORS.skin)
    mats.push(cuffMat, skinMat)

    const addPart = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, quat?: THREE.Quaternion, size?: THREE.Vector3) => {
      geos.push(geo)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      if (quat) mesh.quaternion.copy(quat)
      if (size) mesh.scale.copy(size)
      group.add(mesh)
      return mesh
    }

    /**
     * A fist around the weapon: rounded back of the hand, three knuckle bumps, a thumb
     * hooked over the top, then a knit cuff and a tapered forearm running off frame.
     */
    const addHand = (anchor: THREE.Vector3, mirror: boolean, wrist: THREE.Vector3, elbow: THREE.Vector3) => {
      const s = mirror ? -1 : 1
      /** A part plus its ink shell, so the hand reads like the rest of the game. */
      const handPart = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, quat: THREE.Quaternion, size: THREE.Vector3) => {
        const mesh = addPart(geo, mat, pos, quat, size)
        if (mat !== cuffMat) {
          const shell = new THREE.Mesh(geo, OUTLINE_MAT)
          shell.scale.setScalar(1.09)
          shell.renderOrder = -1
          mesh.add(shell)
        }
        return mesh
      }

      // Back of the hand: flattened, taller than wide, angled toward the grip.
      handPart(
        new THREE.SphereGeometry(0.03, 18, 14),
        glove,
        anchor.clone().add(_tmp.set(0.03 * s, 0.004, 0.014)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.16, -0.34 * s, 0.12 * s)),
        new THREE.Vector3(0.86, 1.22, 1.0),
      )

      // Four fingers stacked down the front of the grip, each a little shorter and
      // more curled than the one above it.
      for (let i = 0; i < 4; i++) {
        const len = 1 - i * 0.1
        const curl = 0.16 + i * 0.1
        addPart(
          fingerGeo,
          glove,
          anchor.clone().add(_tmp.set((0.004 + i * 0.002) * s, 0.026 - i * 0.0168, -0.026 + i * 0.0035)),
          _alongX.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, curl * s, 0.1 * s))),
          new THREE.Vector3(len, 1, len),
        )
        addPart(
          tipGeo,
          glove,
          anchor.clone().add(_tmp.set(0.026 * s, 0.026 - i * 0.0168, -0.033 + i * 0.004)),
          _alongX.clone(),
          new THREE.Vector3(0.95, 0.95, 0.95),
        )
      }

      // Thumb hooks over the top of the grip toward the barrel.
      addPart(
        fingerGeo,
        glove,
        anchor.clone().add(_tmp.set(0.026 * s, 0.032, -0.006)),
        _alongZ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5 * s, 0, 0))),
        new THREE.Vector3(1.1, 1.15, 1.1),
      )

      // Ribbed knit cuff, then a short sleeve stub that leaves frame before it can
      // foreshorten into blocks. No long forearm: it only ever reads as clutter.
      _dir.subVectors(wrist, anchor).normalize()
      const cuffQ = new THREE.Quaternion().setFromUnitVectors(_up, _dir)
      handPart(new THREE.CylinderGeometry(0.031, 0.027, 0.03, 16), sleeve, anchor.clone().addScaledVector(_dir, 0.028), cuffQ, new THREE.Vector3(1, 1, 1))
      for (let i = 0; i < 2; i++) {
        addPart(
          new THREE.TorusGeometry(0.0285, 0.0042, 8, 16),
          cuffMat,
          anchor.clone().addScaledVector(_dir, 0.036 + i * 0.017),
          cuffQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_right, Math.PI / 2)),
        )
      }
      _dir.subVectors(elbow, anchor).normalize()
      const stub = Math.min(0.34, elbow.distanceTo(anchor) * 0.45)
      handPart(
        new THREE.CylinderGeometry(0.034, 0.027, stub, 14),
        sleeve,
        anchor.clone().addScaledVector(_dir, 0.062 + stub * 0.5),
        new THREE.Quaternion().setFromUnitVectors(_up, _dir),
        new THREE.Vector3(1, 1, 1),
      )
    }

    if (asset) {
      const gun = asset.scene.clone(true)
      gunObj = gun
      gun.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const src = mesh.material as THREE.MeshStandardMaterial
        const mat = new THREE.MeshToonMaterial({
          map: src.map ?? null,
          // Sourced guns arrive in muddy factory colours: warm them toward the palette.
          color: _tint
            .copy(src.color ?? new THREE.Color('#ffffff'))
            .lerp(new THREE.Color('#ffffff'), 0.16)
            .lerp(new THREE.Color(weapon.color), asset.tint),
          gradientMap: gradientMap(),
        })
        mats.push(mat)
        mesh.material = mat
        mesh.castShadow = false
        mesh.receiveShadow = false
        if (/magazine/i.test(mesh.name)) {
          mag = mesh
          magBase.copy(mesh.position)
        }
      })
      const cross = Math.max(asset.size.x, asset.size.y)
      const scale = Math.min(GUN_LENGTH / Math.max(0.01, asset.tip * 2), 0.155 / Math.max(0.01, cross))
      gun.scale.setScalar(scale)
      // Barrel points down -Z in view space.
      gun.rotation.y = Math.PI
      gun.position.set(0.004, 0.012, -0.055)
      group.add(gun)
      muzzle.set(0.004, 0.012, -0.02 - asset.tip * scale - 0.02)

      // Right hand on the grip, left hand under the barrel for the two-handers.
      addHand(
        new THREE.Vector3(0.0, -0.062, 0.03),
        false,
        new THREE.Vector3(0.13, -0.175, 0.04),
        new THREE.Vector3(0.2, -0.5, 0.26),
      )
      if (weapon.pellets > 1 || weapon.auto) {
        addHand(
          new THREE.Vector3(0.02, -0.062, -0.13),
          true,
          new THREE.Vector3(-0.11, -0.165, -0.05),
          new THREE.Vector3(-0.26, -0.5, 0.24),
        )
      }
    } else {
      // Pre-asset fallback so the weapon system is never empty.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.34), glove)
      geos.push(body.geometry)
      body.position.set(0, 0, -0.06)
      group.add(body)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 10), sleeve)
      geos.push(barrel.geometry)
      barrel.position.set(0, 0.015, -0.26)
      barrel.rotation.x = Math.PI / 2
      group.add(barrel)
      addHand(
        new THREE.Vector3(0.0, -0.062, 0.03),
        false,
        new THREE.Vector3(0.13, -0.175, 0.04),
        new THREE.Vector3(0.2, -0.5, 0.26),
      )
      muzzle.set(0, 0.015, -0.34)
    }

    const flashMat = new THREE.SpriteMaterial({
      map: muzzleFlashTexture(),
      color: weapon.color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
    const flash = new THREE.Sprite(flashMat)
    flash.position.copy(muzzle)
    flash.scale.setScalar(0.3)
    flash.visible = false
    group.add(flash)

    const flashLight = new THREE.PointLight(weapon.color, 0, 1.6, 2)
    flashLight.position.copy(muzzle)
    group.add(flashLight)

    group.position.copy(HIP)
    return {
      group, flash, flashMat, flashLight, mag, magBase, mats, geos,
      gun: gunObj,
      grip: asset?.grip ?? [0, 0, 0],
    }
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
    this.flashT = 0
    this.aimLerp = 0
    this.swayX = 0
    this.swayY = 0
    for (const shell of this.shells) {
      shell.life = 0
      shell.mesh.visible = false
    }
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

    this.updateShells(dt)
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
    this.ejectShell()
    const spread = (this.aiming ? weapon.spreadAim : weapon.spreadHip) + this.bloom * 0.012 + 0.004
    this.audio.shoot(weapon.sound)
    this.hooks.onShoot(weapon, spread)
    if (this.ammo[this.index] === 0) this.autoReload = 0.22
  }

  private ejectShell() {
    const model = this.models[this.index]
    if (!model) return
    let shell = this.shells.find((s) => s.life <= 0)
    if (!shell) shell = this.shells[0]
    model.group.updateWorldMatrix(true, false)
    shell.mesh.position.set(0.062, 0.004, 0.03).applyMatrix4(model.group.matrixWorld)
    shell.vel.set(
      0.55 + Math.random() * 0.35,
      0.45 + Math.random() * 0.35,
      0.35 + Math.random() * 0.2,
    )
    shell.spin.set(
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26,
    )
    shell.life = 0.7
    shell.mesh.visible = true
    shell.mesh.scale.setScalar(1)
  }

  private updateShells(dt: number) {
    for (const shell of this.shells) {
      if (shell.life <= 0) continue
      shell.life -= dt
      if (shell.life <= 0) {
        shell.mesh.visible = false
        continue
      }
      shell.vel.y -= 6.2 * dt
      shell.mesh.position.addScaledVector(shell.vel, dt)
      shell.mesh.rotation.x += shell.spin.x * dt
      shell.mesh.rotation.y += shell.spin.y * dt
      shell.mesh.rotation.z += shell.spin.z * dt
      shell.mesh.scale.setScalar(Math.min(1, shell.life * 5))
    }
  }

  private animate(dt: number, player: Player) {
    const model = this.models[this.index]
    if (!model) return
    const group = model.group
    const moving = player.grounded ? player.speedNorm : 0.25
    const idle = Math.max(0, 1 - moving * 3)
    const phase = player.bobPhase
    const bobX = Math.sin(phase) * 0.014 * moving
    const bobY = Math.abs(Math.cos(phase)) * -0.012 * moving
    const lift = 1 - this.switchT
    const reloadPhase = this.reloading ? Math.min(1, this.reloadT / this.weapon.reload) : 0
    const dip = Math.sin(reloadPhase * Math.PI)
    const swayScale = 1 - this.aimLerp * 0.72

    _v.copy(HIP).lerp(ADS, this.aimLerp)
    _v.x += bobX * (1 - this.aimLerp * 0.7) + this.swayX * swayScale + Math.cos(this.time * 1.3) * 0.0025 * idle
    _v.y += bobY + this.swayY * swayScale - player.landDip * 0.45 - lift * 0.5 + this.kick * 0.018 - dip * 0.13 + Math.sin(this.time * 1.9) * 0.004 * idle
    _v.z += this.kick * 0.06
    group.position.lerp(_v, 1 - Math.exp(-24 * dt))

    const rotX = this.kick * 0.24 - lift * 0.7 + dip * 0.55
    const rotY = this.swayX * 3.2 * swayScale + (1 - this.aimLerp) * 0.15 + Math.sin(this.time * 1.1) * 0.008 * idle
    const rotZ = lift * 0.35 + Math.sin(phase) * 0.012 * moving + dip * 0.2
    group.rotation.x += (rotX - group.rotation.x) * Math.min(1, dt * 18)
    group.rotation.y += (rotY - group.rotation.y) * Math.min(1, dt * 12)
    group.rotation.z += (rotZ - group.rotation.z) * Math.min(1, dt * 12)

    if (model.mag) model.mag.position.y = model.magBase.y - dip * 0.11
    // Grips that sit off-centre on the model are nudged in the hip pose only; aimed
    // fire lines the barrel itself up with the crosshair.
    if (model.gun) {
      const k = 1 - this.aimLerp
      model.gun.position.x = 0.004 + model.grip[0] * k
      model.gun.position.y = 0.012 + model.grip[1] * k
      model.gun.position.z = -0.055 + model.grip[2] * k
    }

    for (const m of this.models) {
      const firing = m === model && this.flashT > 0
      m.flash.visible = firing
      m.flashLight.intensity = firing ? Math.min(2.2, this.flashT * 38) : 0
      if (!firing) continue
      m.flashMat.opacity = Math.min(1, this.flashT * 26)
      const scale = 0.3 + Math.random() * 0.16
      m.flash.scale.setScalar(scale)
      m.flashMat.rotation = Math.random() * Math.PI
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
