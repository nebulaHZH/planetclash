import * as THREE from 'three'
import { COLORS, type CharacterConfig } from '../config'

const WHITE = new THREE.Color('#ffffff')

let gradient: THREE.DataTexture | null = null
let softGradient: THREE.DataTexture | null = null
/** Three-step toon ramp: highlight, mid, violet shadow. */
export function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient
  const data = new Uint8Array([
    255, 255, 255, 255,
    205, 180, 222, 255,
    104, 70, 145, 255,
  ])
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  gradient.magFilter = THREE.NearestFilter
  gradient.minFilter = THREE.NearestFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

/**
 * A gentler 8-step ramp for big curved surfaces. The 3-step ramp is right for
 * props, but across a 9 m pit wall it turns one smooth bowl into two flat bands.
 */
export function softGradientMap(): THREE.DataTexture {
  if (softGradient) return softGradient
  const steps = 8
  const data = new Uint8Array(steps * 4)
  const light = new THREE.Color('#FFFFFF')
  const mid = new THREE.Color('#CDB4DE')
  const dark = new THREE.Color('#684691')
  const c = new THREE.Color()
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1)
    if (u < 0.45) c.copy(light).lerp(mid, u / 0.45)
    else c.copy(mid).lerp(dark, (u - 0.45) / 0.55)
    data[i * 4] = Math.round(c.r * 255)
    data[i * 4 + 1] = Math.round(c.g * 255)
    data[i * 4 + 2] = Math.round(c.b * 255)
    data[i * 4 + 3] = 255
  }
  softGradient = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat)
  softGradient.magFilter = THREE.NearestFilter
  softGradient.minFilter = THREE.NearestFilter
  softGradient.generateMipmaps = false
  softGradient.needsUpdate = true
  return softGradient
}

export const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: COLORS.outline,
  side: THREE.BackSide,
})

export function toon(color: THREE.ColorRepresentation, opts: { transparent?: boolean; opacity?: number; side?: THREE.Side } = {}) {
  const material = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  })
  return material
}

/** Inverted-hull outline. Child inherits the parent's transform. */
export function outlined<T extends THREE.Mesh>(mesh: T, scale = 1.055): T {
  const shell = new THREE.Mesh(mesh.geometry, OUTLINE_MAT)
  shell.scale.setScalar(scale)
  shell.raycast = () => {}
  shell.renderOrder = -1
  mesh.add(shell)
  return mesh
}

export function shadowBlob(radius = .62, opacity = .18) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: COLORS.outline, transparent: true, opacity, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.set(1, .6, 1)
  mesh.position.y = .02
  mesh.raycast = () => {}
  return mesh
}

function box(w: number, h: number, d: number, material: THREE.Material) {
  return outlined(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material))
}

function sphere(r: number, material: THREE.Material, width = 18, height = 12) {
  return outlined(new THREE.Mesh(new THREE.SphereGeometry(r, width, height), material))
}

export type CharacterBuild = {
  group: THREE.Group
  head: THREE.Group
  height: number
  flashMats: THREE.MeshToonMaterial[]
}

/** Parametric two-head-tall chibi shared by enemies and the menu preview. */
export function buildCharacter(config: CharacterConfig, opts: { enemy?: boolean } = {}): CharacterBuild {
  const group = new THREE.Group()
  group.userData.isCharacter = true
  const bodyMat = toon(config.bodyColor)
  const accentMat = toon(config.accentColor)
  const skinMat = toon(COLORS.skin)
  const whiteMat = toon(COLORS.white)
  const goldMat = toon(COLORS.gold)
  const ink = new THREE.MeshBasicMaterial({ color: COLORS.outline })
  const flashMats = [bodyMat, accentMat]

  const body = sphere(.52, accentMat)
  body.position.y = .78
  body.scale.set(1.02, 1.12, .82)
  group.add(body)

  // resin highlight
  const shine = new THREE.Mesh(
    new THREE.SphereGeometry(.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: COLORS.white, transparent: true, opacity: .92 }),
  )
  shine.position.set(.19, .96, -.39)
  shine.scale.set(.7, 1.35, .35)
  shine.raycast = () => {}
  group.add(shine)

  const head = new THREE.Group()
  head.position.y = 1.62
  head.userData.head = true
  const skull = sphere(.62, bodyMat, 22, 16)
  skull.scale.set(1.05 * config.headScale, 1 * config.headScale, .96)
  head.add(skull)
  group.add(head)

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.095, 10, 8), ink)
    eye.scale.set(.62, 1.35, .32)
    eye.position.set(side * .23 * config.headScale, .03, -.565 * config.headScale)
    eye.raycast = () => {}
    head.add(eye)

    const glint = new THREE.Mesh(new THREE.SphereGeometry(.03, 6, 5), new THREE.MeshBasicMaterial({ color: COLORS.white }))
    glint.position.set(side * .215 * config.headScale, .095, -.6 * config.headScale)
    glint.raycast = () => {}
    head.add(glint)

    const blush = new THREE.Mesh(
      new THREE.CircleGeometry(.088, 14),
      new THREE.MeshBasicMaterial({ color: COLORS.candy, transparent: true, opacity: .55, side: THREE.DoubleSide }),
    )
    blush.position.set(side * .41 * config.headScale, -.19, -.51 * config.headScale)
    blush.rotation.y = side * .35
    blush.raycast = () => {}
    head.add(blush)

    const arm = new THREE.Group()
    arm.position.set(side * .5, .98, 0)
    arm.rotation.z = side * -.32
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(.115, .3, 5, 9), bodyMat)
    limb.position.y = -.1
    arm.add(outlined(limb))
    const hand = new THREE.Mesh(new THREE.SphereGeometry(.155, 12, 9), skinMat)
    hand.position.y = -.33
    arm.add(hand)
    group.add(arm)

    const leg = new THREE.Group()
    leg.position.set(side * .2, .36, 0)
    const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .22, 5, 9), bodyMat)
    legMesh.position.y = -.1
    leg.add(outlined(legMesh))
    const foot = new THREE.Mesh(new THREE.SphereGeometry(.2, 12, 8), accentMat)
    foot.scale.set(1.1, .62, 1.22)
    foot.position.set(0, -.26, -.06)
    leg.add(foot)
    group.add(leg)
  }

  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(.075, .018, 5, 10, Math.PI),
    ink,
  )
  mouth.position.set(0, -.19, -.585 * config.headScale)
  mouth.rotation.z = Math.PI
  mouth.raycast = () => {}
  head.add(mouth)

  const hat = new THREE.Group()
  hat.position.y = .48 * config.headScale
  head.add(hat)

  if (config.hat === 'crown') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(.25, .31, .2, 5), goldMat)
    crown.position.y = .12
    hat.add(outlined(crown, 1.07))
    for (const x of [-.18, 0, .18]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.055, .15, 4), goldMat)
      spike.position.set(x, .29, -.08)
      hat.add(spike)
      const gem = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), new THREE.MeshBasicMaterial({ color: COLORS.candy }))
      gem.position.set(x * .9, .14, -.26)
      gem.raycast = () => {}
      hat.add(gem)
    }
  } else if (config.hat === 'antenna') {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .38, 7), ink)
    rod.position.y = .2
    hat.add(rod)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.095, 10, 8), new THREE.MeshBasicMaterial({ color: COLORS.mint }))
    bulb.position.y = .42
    bulb.raycast = () => {}
    hat.add(bulb)
  } else if (config.hat === 'cat') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(.19, .38, 4), bodyMat)
      ear.position.set(side * .26, .28, 0)
      ear.rotation.z = side * -.16
      hat.add(outlined(ear, 1.07))
      const inner = new THREE.Mesh(new THREE.ConeGeometry(.1, .22, 4), accentMat)
      inner.position.set(side * .26, .27, -.03)
      inner.rotation.z = side * -.16
      hat.add(inner)
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(.32, .055, 6, 16, Math.PI * 1.15), bodyMat)
    tail.position.set(0, .12, .44)
    tail.rotation.set(.5, 0, -.4)
    hat.add(outlined(tail, 1.04))
  } else if (config.hat === 'mushroom') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, .3, 10), whiteMat)
    stem.position.y = .1
    hat.add(outlined(stem, 1.05))
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.44, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), accentMat)
    cap.position.y = .27
    hat.add(outlined(cap, 1.05))
    for (let i = 0; i < 4; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(.055, 8, 6), whiteMat)
      const a = i * 1.7
      dot.position.set(Math.cos(a) * .24, .46, Math.sin(a) * .24)
      dot.raycast = () => {}
      hat.add(dot)
    }
  } else {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(.16, .42, 5), accentMat)
    tuft.position.set(0, .2, 0)
    tuft.rotation.z = -.28
    hat.add(outlined(tuft, 1.06))
  }

  group.add(shadowBlob())
  if (opts.enemy) {
    const badge = new THREE.Mesh(new THREE.CircleGeometry(.1, 12), new THREE.MeshBasicMaterial({ color: COLORS.candy, side: THREE.DoubleSide }))
    badge.position.set(0, 1.16, -.47)
    badge.raycast = () => {}
    group.add(badge)
  }
  return { group, head, height: 2.35, flashMats }
}

export function flashCharacter(build: CharacterBuild, amount: number) {
  for (const material of build.flashMats) {
    material.emissive.copy(WHITE)
    material.emissiveIntensity = amount
  }
}

export function radialTexture(size = 128, inner = '#ffffff', mid = 'rgba(255,255,255,0.55)') {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, inner)
  g.addColorStop(.45, mid)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function alertTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFDF8'
  ctx.strokeStyle = '#2B1B2F'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(64, 64, 52, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#FF7FA8'
  ctx.font = 'bold 74px Arial Rounded MT Bold, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', 64, 60)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function flagTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 144
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, 256, 144)
  ctx.fillStyle = COLORS.outline
  ctx.beginPath()
  ctx.arc(128, 72, 40, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.translate(128, 72)
  ctx.rotate(-0.32)
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.ellipse(0, 0, 66, 20, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#FFFFFF'
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3
    ctx.beginPath()
    ctx.arc(128 + Math.cos(a) * 78, 72 + Math.sin(a) * 78, 7, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function signTexture(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFDF8'
  ctx.fillRect(6, 6, 244, 116)
  ctx.strokeStyle = '#2B1B2F'
  ctx.lineWidth = 8
  ctx.strokeRect(6, 6, 244, 116)
  ctx.fillStyle = '#7651A5'
  ctx.font = 'bold 48px Arial Rounded MT Bold, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 66)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function starGeometry(outer = .5, inner = .2): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}
