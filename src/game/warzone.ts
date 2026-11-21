import * as THREE from 'three'
import { COLORS } from '../config'
import type { Faction } from '../types'
import { gradientMap, toon } from './toon'
import { Fx } from './fx'
import { GameAudio } from './audio'
import { LAYOUT, WAR, gravityAt, makeSpec, placeOn, surfaceFor, type PlanetSpec } from './warconfig'

/**
 * The whole two-world war. Owns both planets, both hearts and their layered
 * turret guards, the scheduled shuttle, the player's hand-flown rockets,
 * both squads of AI soldiers, and the win/lose conditions.
 *
 * Positions are expressed in each planet's LOCAL frame (see warconfig) so the
 * two worlds are the same base with a different coat of paint.
 */

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _dirB = new THREE.Vector3()
const _q = new THREE.Quaternion()
const FWD = new THREE.Vector3(0, 0, -1)
const UP = new THREE.Vector3(0, 1, 0)
const _localUp = new THREE.Vector3(0, 1, 0)
const _localRight = new THREE.Vector3(1, 0, 0)

export const PLANET_B = {
  center: new THREE.Vector3(0.42, 0.62, 0.66).normalize().multiplyScalar(430),
  radius: 96,
}

export type ShipState = 'dockedA' | 'flying' | 'dockedB'
export type VehicleKind = 'ship' | 'rocket'

type Turret = {
  group: THREE.Group
  head: THREE.Group
  tip: THREE.Object3D
  world: Faction
  tier: 'big' | 'mid' | 'small'
  hp: number
  maxHp: number
  cooldown: number
  dead: boolean
  lastPlayerHit: number   // war time of the player's most recent hit, for assists
  barFill?: THREE.Sprite
  barGroup?: THREE.Group
  barHeight: number
}

type Ship = {
  group: THREE.Group
  faction: Faction
  state: 'docked' | 'flying'
  fromWorld: Faction
  toWorld: Faction
  from: THREE.Vector3
  to: THREE.Vector3
  ctrl: THREE.Vector3
  t: number
  dur: number
  dockTimer: number
  hp: number
  heading: THREE.Quaternion
  rider: boolean
  autopilot: boolean
  cannonCd: number
  speed: number
  steer: THREE.Vector3   // manual flight offset from the bezier corridor
  vel: THREE.Vector3     // free-flight velocity while manually piloted
}

type Rocket = {
  group: THREE.Group
  faction: Faction
  active: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  heading: THREE.Quaternion
  fuel: number
  hp: number
  rider: boolean
  cannonCd: number
  fromWorld: Faction
  age: number
}

type SoldierState = 'guard' | 'board' | 'transit' | 'assault' | 'capture' | 'dead'

type Soldier = {
  group: THREE.Group
  faction: Faction
  world: Faction
  dir: THREE.Vector3
  hp: number
  maxHp: number
  state: SoldierState
  timer: number
  cooldown: number
  target: THREE.Vector3 | null
  bob: number
  lastPlayerHit: number
  isHero: boolean
  barFill?: THREE.Sprite
  barGroup?: THREE.Group
  barHeight: number
}

/** A refill crate parked near each world's pad; recharges on a cooldown. */
type Supply = {
  group: THREE.Group
  world: Faction
  pos: THREE.Vector3
  cooldown: number
  ringMat: THREE.MeshBasicMaterial
  core: THREE.Mesh
}

export type RidePose = { position: THREE.Vector3; quaternion: THREE.Quaternion; up: THREE.Vector3 }

export type RideView = {
  kind: VehicleKind
  autopilot: boolean
  hp: number
  maxHp: number
  fuel: number
  maxFuel: number
  target: Faction
  progress: number
  speed: number
  pose: RidePose
}

export type WarCtx = {
  playerPos: THREE.Vector3
  playerWorld: Faction
  playerInRide: boolean
  playerAlive: boolean
  hurtPlayer: (amount: number, from: THREE.Vector3) => void
  onAssist: () => void
  /** The PLAYER just destroyed a war unit — full kill fanfare on the game side. */
  onWarKill: (kind: 'turret' | 'soldier' | 'hero', point: THREE.Vector3, up: THREE.Vector3) => void
  refillAmmo: (amount: number) => void
  toast: (text: string, tone: 'good' | 'bad' | 'gold') => void
  onEnd: (won: boolean) => void
}

type Dig = { dir: THREE.Vector3; depth: number; radius: number }

/** A real travelling projectile — no hitscan, so a moving target can dodge it. */
type WarBullet = {
  mesh: THREE.Mesh
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  world: Faction      // which planet's battle this belongs to
  owner: Faction      // shooter faction; never damages its own faction
  kind: 'player' | 'soldier' | 'ship' | 'rocket' | 'turret'
  ref: unknown
  dmg: number
}

const BULLET_SPEED = 34
const BULLET_TIER_SPEED: Record<Turret['tier'], number> = { big: 40, mid: 34, small: 30 }

// ------------------------------------------------------------------ builders

function turretMesh(tier: Turret['tier'], hostile: boolean) {
  const scale = tier === 'big' ? 2.5 : tier === 'mid' ? 1.5 : 1
  const baseMat = toon(hostile ? '#4A3654' : '#6FA0BE')
  const headMat = toon(hostile ? '#8B63B4' : '#BFE4F5')
  const barrel = toon('#2B1B2F')
  const group = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.45, 2.1, 10), baseMat)
  base.position.y = 1.05
  group.add(base)
  const head = new THREE.Group()
  head.position.y = 2.35
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), headMat))
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.7, 8), barrel)
  gun.rotation.x = Math.PI / 2
  gun.position.set(0, 0.12, -0.95)
  head.add(gun)
  const tip = new THREE.Object3D()
  tip.position.set(0, 0.12, -1.85)
  head.add(tip)
  group.add(head)
  if (tier === 'big') {
    const crown = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.16, 8, 20), toon(hostile ? '#E0A0FF' : '#8FE4C2'))
    crown.rotation.x = Math.PI / 2
    crown.position.y = 3.4
    group.add(crown)
  }
  group.scale.setScalar(scale)
  return { group, head, tip }
}

function rocketMesh(hostile: boolean) {
  const parts = new THREE.Group()
  const shell = toon(hostile ? '#6B4E8F' : '#FFF3E0')
  const trim = toon(hostile ? '#3A2A50' : '#FF6B8F')
  const glass = toon('#BFEFFF')
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.7, 8, 14), shell)
  body.rotation.x = Math.PI / 2
  parts.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.25, 14), trim)
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -1.85
  parts.add(nose)
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.9), trim)
    const ang = (i / 3) * Math.PI * 2
    fin.position.set(Math.cos(ang) * 0.72, Math.sin(ang) * 0.72, 1.2)
    fin.rotation.z = ang + Math.PI / 2
    parts.add(fin)
  }
  const win = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), glass)
  win.position.set(0, 0.45, -0.6)
  parts.add(win)
  return parts
}

function shipMesh() {
  const parts = new THREE.Group()
  const hull = toon('#FFF0DC')
  const trim = toon('#FF6B8F')
  const glass = toon('#A7E4FF')
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 4.6, 8, 16), hull)
  body.rotation.x = Math.PI / 2
  parts.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.4, 16), trim)
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -3.6
  parts.add(nose)
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 1.6), trim)
    wing.position.set(s * 2.2, -0.2, 0.9)
    parts.add(wing)
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.78, 14, 10), glass)
  dome.position.set(0, 1.1, -0.8)
  parts.add(dome)
  return parts
}

function heartMesh(colorHex: string) {
  const mat = new THREE.MeshToonMaterial({
    color: colorHex,
    emissive: new THREE.Color(colorHex).multiplyScalar(0.4),
  })
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.15), mat)
  gem.scale.set(1, 1.45, 1)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 8, 24), toon('#FFF3DC'))
  ring.rotation.x = Math.PI / 2
  gem.add(ring)
  return gem
}

function soldierMesh(hostile: boolean) {
  const g = new THREE.Group()
  const body = toon(hostile ? '#6B4E8F' : '#7FC7E8')
  const face = toon(hostile ? '#8FE4C2' : '#FFF3DC')
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.72, 6, 10), body)
  torso.position.y = 0.78
  g.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), body)
  head.position.y = 1.46
  g.add(head)
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), face)
  visor.position.set(0, 1.48, -0.2)
  g.add(visor)
  return g
}

function beacon(color: string) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 26, 16, 1, true), mat)
  beam.position.y = 13
  g.add(beam)
  const disc = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }))
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.12
  g.add(disc)
  return g
}

function labelSprite(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 72
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(24,12,40,0.78)'
  ctx.beginPath()
  ctx.roundRect(4, 6, 248, 60, 16)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = color
  ctx.font = 'bold 34px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 37)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sprite.scale.set(4.6, 1.3, 1)
  sprite.renderOrder = 10
  return sprite
}

function healthBar(color: string, width = 4.2) {
  const g = new THREE.Group()
  // Solid, high-contrast bar so it reads clearly against both planets.
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#140C22', depthTest: false, transparent: true, opacity: 0.92 }))
  bg.scale.set(width + 0.2, 0.56, 1)
  bg.renderOrder = 40
  const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false }))
  fill.scale.set(width, 0.38, 1)
  fill.position.z = 0.01
  fill.renderOrder = 41
  g.add(bg, fill)
  // Anchor the fill at its left edge so shrinking reads as a draining bar.
  ;(fill.material as THREE.SpriteMaterial).sizeAttenuation = true
  g.userData.barWidth = width
  g.userData.fill = fill
  return { group: g, fill }
}

/** A hero is a larger, crowned soldier with a nameplate and health bar. */
function heroMesh(hostile: boolean, name: string) {
  const g = soldierMesh(hostile)
  g.scale.setScalar(1.85)
  const accent = hostile ? '#E0A0FF' : '#8FE4C2'
  // Crown ring above the head.
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.1, 8, 18), toon(hostile ? '#FFD75E' : '#FFF3DC'))
  crown.rotation.x = Math.PI / 2
  crown.position.y = 1.86
  g.add(crown)
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 6), toon(hostile ? '#FFD75E' : '#FFF3DC'))
    const a = (i / 5) * Math.PI * 2
    spike.position.set(Math.cos(a) * 0.46, 2.02, Math.sin(a) * 0.46)
    g.add(spike)
  }
  // Glowing aura disc at the feet.
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.25, 24),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  )
  aura.rotation.x = -Math.PI / 2
  aura.position.y = 0.03
  g.add(aura)
  const plate = labelSprite(name, accent)
  plate.position.y = 3.5
  g.add(plate)
  return { group: g }
}

/** An ammo crate: a glowing box with a floating ring, dims while recharging. */
function supplyMesh() {
  const g = new THREE.Group()
  const ringMat = new THREE.MeshBasicMaterial({ color: '#FFD75E', transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), toon('#F0C24B'))
  box.position.y = 0.6
  g.add(box)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.28, 1.75), toon('#FFF3DC'))
  lid.position.y = 1.28
  g.add(lid)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 24), ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.12
  g.add(ring)
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ color: '#FFF3DC' }))
  core.position.y = 2.1
  g.add(core)
  return { group: g, ringMat, core }
}

// --------------------------------------------------------------------- class

export class Warzone {
  readonly group = new THREE.Group()
  /** Everything the player's bullets can hit. */
  readonly hostiles = new THREE.Group()
  /** World-space health bars — never inherit a unit's scale or rotation. */
  private readonly bars = new THREE.Group()
  readonly terrains: THREE.Object3D[] = []

  readonly specs: Record<Faction, PlanetSpec>
  private readonly heartMesh: Record<Faction, THREE.Mesh>
  private readonly heartBeam: Record<Faction, THREE.MeshBasicMaterial>
  private readonly fx: Fx
  private readonly audio: GameAudio

  private turrets: Turret[] = []
  private ships: Ship[] = []
  private rockets: Rocket[] = []
  private soldiers: Soldier[] = []
  private supplies: Supply[] = []
  private bullets: WarBullet[] = []
  private bulletMat = new THREE.MeshBasicMaterial({ color: '#FFD98A' })
  private digsB: Dig[] = []
  /** Pristine vertex colours of the B terrain, so healed digs repaint back. */
  private bBaseColors: Float32Array | null = null

  /** 0..1 — enemy stealing our heart / our progress on theirs. */
  progressA = 0
  progressB = 0
  bHeartState: 'hidden' | 'risen' | 'taken' = 'hidden'
  shipState: ShipState = 'dockedA'
  ride: RideView | null = null
  private carried: { kind: VehicleKind; ref: Ship | Rocket } | null = null

  private lastCtx: WarCtx | null = null
  private enemyWarned = false
  private bigDownWarned = false
  private shuttleToB = true
  private endLock = false
  private time = 0

  constructor(scene: THREE.Scene, fx: Fx, audio: GameAudio) {
    this.fx = fx
    this.audio = audio
    scene.add(this.group)
    scene.add(this.hostiles)
    scene.add(this.bars)

    // Fixed pool of visible projectile meshes (borrowed pattern from EnemyManager).
    const bulletGeo = new THREE.SphereGeometry(0.28, 10, 8)
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(bulletGeo, this.bulletMat)
      mesh.visible = false
      this.group.add(mesh)
      this.bullets.push({
        mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        life: 0, world: 'B', owner: 'B', kind: 'soldier', ref: null, dmg: 0,
      })
    }

    const specA = makeSpec('A', new THREE.Vector3(), 96, new THREE.Vector3(0, 1, 0), {
      sea: '#7FE0D6', land: '#8FE4C2', rock: '#B9E6D2', cap: '#F3FFF8', accent: '#FF6B8F', heart: '#FF5FA2',
    })
    const specB = makeSpec('B', PLANET_B.center.clone(), PLANET_B.radius, PLANET_B.center.clone().negate(), {
      sea: '#3EC8C8', land: '#B48BD8', rock: '#544070', cap: '#EDE4FF', accent: '#C86BFA', heart: '#FFD75E',
    })
    this.specs = { A: specA, B: specB }

    for (const key of ['A', 'B'] as const) {
      const mesh = this.buildPlanet(this.specs[key])
      this.group.add(mesh)
      this.terrains.push(mesh)
    }
    // Snapshot B's grass/sea colours so healed digs can repaint them back.
    {
      const geo = (this.terrains[1] as THREE.Mesh).geometry as THREE.BufferGeometry
      this.bBaseColors = (geo.attributes.color as THREE.BufferAttribute).array.slice() as Float32Array
    }

    this.heartMesh = {
      A: heartMesh(specA.palette.heart),
      B: heartMesh(specB.palette.heart),
    }
    this.group.add(this.heartMesh.A, this.heartMesh.B)
    this.heartBeam = { A: this.buildHeartBeam('A'), B: this.buildHeartBeam('B') }

    // Layered turret guard: one big, four mid, six small — on both worlds.
    for (const key of ['A', 'B'] as const) {
      this.spawnTurret(key, 'big', LAYOUT.big)
      for (const dir of LAYOUT.mid) this.spawnTurret(key, 'mid', dir)
      for (const dir of LAYOUT.small) this.spawnTurret(key, 'small', dir)
    }

    // A whole fleet of shuttles, phased so one is always arriving or leaving.
    for (let i = 0; i < WAR.shipCount; i++) {
      const hull = shipMesh()
      this.group.add(hull)
      const ship: Ship = {
        group: hull, faction: 'A', state: 'docked',
        fromWorld: i % 2 === 0 ? 'A' : 'B', toWorld: 'A',
        from: new THREE.Vector3(), to: new THREE.Vector3(), ctrl: new THREE.Vector3(),
        t: 0, dur: 1, dockTimer: WAR.shipCruise * (i / WAR.shipCount) + 0.6, hp: WAR.shipHp,
        heading: new THREE.Quaternion().setFromUnitVectors(FWD, new THREE.Vector3(0, 0, -1)),
        rider: false, autopilot: true, cannonCd: 0, speed: 0, steer: new THREE.Vector3(), vel: new THREE.Vector3(),
      }
      hull.traverse((o) => { o.userData.war = 'ship'; o.userData.ref = ship })
      this.ships.push(ship)
    }

    // Ammo crates: one near each world's pad, always glowing on the map.
    for (const world of ['A', 'B'] as const) {
      const crate = supplyMesh()
      this.group.add(crate.group)
      this.supplies.push({ group: crate.group, world, pos: new THREE.Vector3(), cooldown: 0, ringMat: crate.ringMat, core: crate.core })
    }

    // Distinct beacons make the vehicles impossible to miss.
    const padA = beacon('#8ED8FF')
    this.group.add(padA)
    padA.userData.padA = true
  }

  /** Wire home structures once Game reveals its capture pad direction. */
  init(padADir: THREE.Vector3) {
    const spec = this.specs.A
    spec.capitalDir.copy(padADir).normalize()
    spec.frame.setFromUnitVectors(UP, spec.capitalDir)
    this.placeStructures()
  }

  private buildPlanet(spec: PlanetSpec) {
    const geo = new THREE.IcosahedronGeometry(1, 40)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const col = new THREE.Color()
    const dir = new THREE.Vector3()
    const sea = new THREE.Color(spec.palette.sea)
    const land = new THREE.Color(spec.palette.land)
    const rock = new THREE.Color(spec.palette.rock)
    const cap = new THREE.Color(spec.palette.cap)
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize()
      const base = surfaceFor(spec, dir)
      pos.setXYZ(i, dir.x * base, dir.y * base, dir.z * base)
      const wob = Math.sin(dir.x * 6.3 + dir.z * 4.1) * 0.5 + Math.sin(dir.y * 8.2 - dir.x * 3.7) * 0.5
      const dry = 2.1 + wob * 1.4
      const above = base - spec.radius
      if (above < dry - 0.9) col.copy(sea)
      else if (above > dry + 2.6) col.copy(rock).lerp(land, 0.35)
      else col.copy(land)
      const polar = THREE.MathUtils.smoothstep(Math.abs(dir.y), 0.72, 0.95)
      col.lerp(cap, polar)
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.translate(spec.center.x, spec.center.y, spec.center.z)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() }))
    mesh.name = `planet${spec.faction}`
    return mesh
  }

  private buildHeartBeam(world: Faction) {
    const mat = new THREE.MeshBasicMaterial({ color: '#C86BFA', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 22, 18, 1, true), mat)
    beam.name = `beam${world}`
    this.group.add(beam)
    return mat
  }

  private spawnTurret(world: Faction, tier: Turret['tier'], local: THREE.Vector3) {
    const mesh = turretMesh(tier, world === 'B')
    const cfg = WAR.turret[tier]
    const scale = tier === 'big' ? 2.5 : tier === 'mid' ? 1.5 : 1
    const color = world === 'B' ? '#FF7A5C' : '#8FE4C2'
    const bar = healthBar(color, tier === 'big' ? 5.4 : tier === 'mid' ? 4.2 : 3.4)
    const turret: Turret = {
      ...mesh, world, tier, hp: cfg.hp, maxHp: cfg.hp, cooldown: Math.random(), dead: false, lastPlayerHit: -99,
      barFill: bar.fill, barGroup: bar.group, barHeight: 4.2 * scale,
    }
    this.bars.add(bar.group)
    turret.group.userData.local = local.clone()
    turret.group.traverse((o) => { o.userData.war = 'turret'; o.userData.ref = turret })
    this.hostiles.add(turret.group)
    this.turrets.push(turret)
    return turret
  }

  private placeStructures() {
    for (const t of this.turrets) {
      const local = t.group.userData.local as THREE.Vector3
      placeOn(this.specs[t.world], local, 0, (d) => this.digDepth(d), t.group.position)
      t.group.quaternion.setFromUnitVectors(UP, _a.copy(t.group.position).sub(this.specs[t.world].center).normalize())
    }
    for (const world of ['A', 'B'] as const) {
      const spec = this.specs[world]
      placeOn(spec, LAYOUT.capital, 1.6, (d) => this.digDepth(d), this.heartMesh[world].position)
      const up = _a.copy(this.heartMesh[world].position).sub(spec.center).normalize()
      this.heartMesh[world].quaternion.setFromUnitVectors(UP, up)
      const beam = this.group.getObjectByName(`beam${world}`)
      if (beam) {
        beam.position.copy(this.heartMesh[world].position).addScaledVector(up, 11)
        beam.quaternion.setFromUnitVectors(UP, up)
      }
    }
    // Park each shuttle on its home pad if it is docked; in-flight ones keep flying.
    for (const s of this.ships) {
      if (s.state !== 'docked') continue
      this.parkShip(s, s.fromWorld)
    }
    // Supply crates sit beside each pad.
    for (const supply of this.supplies) {
      placeOn(this.specs[supply.world], LAYOUT.supply, 0.4, (d) => this.digDepth(d), supply.pos)
      supply.group.position.copy(supply.pos)
      const up = _a.copy(supply.pos).sub(this.specs[supply.world].center).normalize()
      supply.group.quaternion.setFromUnitVectors(UP, up)
    }
  }

  /** Fresh round: clear the skies and reset every system. */
  reset() {
    for (const r of this.rockets) this.group.remove(r.group)
    this.rockets.length = 0
    for (const s of this.soldiers) this.hostiles.remove(s.group)
    this.soldiers.length = 0
    // Soldier bars are rebuilt on spawn; drop the old ones (turret bars persist).
    for (const child of [...this.bars.children]) {
      if (child.userData.soldierBar) this.bars.remove(child)
    }
    for (const b of this.bullets) { b.life = 0; b.mesh.visible = false }
    this.digsB.length = 0
    this.progressA = 0
    this.progressB = 0
    this.bHeartState = 'hidden'
    this.heartMesh.A.visible = this.heartMesh.B.visible = true
    this.heartBeam.A.color.set('#C86BFA')
    this.heartBeam.B.color.set('#C86BFA')
    this.enemyWarned = false
    this.bigDownWarned = false
    this.endLock = false
    this.carried = null
    this.ride = null
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]
      s.hp = WAR.shipHp
      s.rider = false
      s.autopilot = true
      s.state = 'docked'
      s.fromWorld = i % 2 === 0 ? 'A' : 'B'
      s.dockTimer = WAR.shipCruise * (i / this.ships.length) + 0.6
      s.vel.set(0, 0, 0)
      s.steer.set(0, 0, 0)
      s.speed = 0
    }
    for (const supply of this.supplies) {
      supply.cooldown = 0
      supply.ringMat.color.set('#FFD75E')
      supply.ringMat.opacity = 0.85
      supply.core.visible = true
    }
    for (const t of this.turrets) {
      t.dead = false
      t.hp = t.maxHp
      t.group.visible = true
      t.group.scale.setScalar(t.tier === 'big' ? 2.5 : t.tier === 'mid' ? 1.5 : 1)
      t.cooldown = Math.random()
    }
    this.placeStructures()
    this.spawnSquads()
  }

  // --------------------------------------------------------------- squads

  private spawnSquads() {
    for (const faction of ['A', 'B'] as const) {
      for (let i = 0; i < WAR.squadPerSide; i++) this.spawnSoldier(faction, i)
      this.spawnSoldier(faction, 0, true)
    }
  }

  private spawnSoldier(faction: Faction, index: number, hero = false) {
    const name = hero ? (faction === 'B' ? '紫晶英雄' : '糖果骑士') : ''
    const built = hero ? heroMesh(faction === 'B', name) : { group: soldierMesh(faction === 'B') }
    const group = built.group
    const base = (hero ? LAYOUT.heroRally : LAYOUT.rally).clone()
      .add(_a.set(hero ? 0 : (index - 0.5) * 0.07, 0, hero ? 0 : iRand() * 0.04))
    const hp = hero ? WAR.hero.hp : WAR.soldier.hp
    const color = faction === 'B' ? '#FF7A5C' : '#8FE4C2'
    const bar = healthBar(color, hero ? 4.6 : 2.6)
    bar.group.userData.soldierBar = true
    const soldier: Soldier = {
      // dir is a WORLD direction; rotate the local rally through this world's frame.
      group, faction, world: faction, dir: base.normalize().applyQuaternion(this.specs[faction].frame).normalize(),
      hp, maxHp: hp, state: 'guard', timer: WAR.aiFirstWaveDelay + iRand() * 4 + (hero ? -2 : 0),
      cooldown: iRand(), target: null, bob: iRand() * 6, lastPlayerHit: -99,
      isHero: hero, barFill: bar.fill, barGroup: bar.group,
      barHeight: hero ? 4.6 : 2.4,
    }
    this.bars.add(bar.group)
    group.traverse((o) => { o.userData.war = hero ? 'hero' : 'soldier'; o.userData.ref = soldier })
    this.hostiles.add(group)
    this.soldiers.push(soldier)
  }

  // ---------------------------------------------------------------- hearts

  private bigTurret(world: Faction) {
    return this.turrets.find((t) => t.world === world && t.tier === 'big')!
  }

  get homeTurretDead() { return this.bigTurret('A').dead }

  get heartPositions() {
    return { A: this.heartMesh.A.position.clone(), B: this.heartMesh.B.position.clone() }
  }

  capitalDir(world: Faction) {
    return _a.copy(this.heartMesh[world].position).sub(this.specs[world].center).normalize().clone()
  }

  // --------------------------------------------------------------- vehicles

  private parkPoint(world: Faction, out = new THREE.Vector3()) {
    return placeOn(this.specs[world], LAYOUT.pad, 1.4, (d) => this.digDepth(d), out)
  }

  private rocketPadPoint(world: Faction, out = new THREE.Vector3()) {
    return placeOn(this.specs[world], LAYOUT.rocketPad, 2.4, (d) => this.digDepth(d), out)
  }

  /** Park one specific shuttle on a pad. */
  private parkShip(ship: Ship, world: Faction) {
    ship.state = 'docked'
    ship.fromWorld = world
    ship.toWorld = world
    ship.dockTimer = WAR.shipCruise
    ship.speed = 0
    ship.steer.set(0, 0, 0)
    ship.group.position.copy(this.parkPoint(world))
    const up = _a.copy(ship.group.position).sub(this.specs[world].center).normalize()
    ship.group.quaternion.setFromUnitVectors(UP, up)
    ship.heading.copy(ship.group.quaternion)
  }

  /** Send one specific shuttle on a crossing. */
  private launchShip(ship: Ship, to: Faction) {
    if (ship.state !== 'docked') return
    const from = ship.group.position.clone()
    const fromWorld = ship.fromWorld
    const toPos = this.parkPoint(to)
    const upFrom = _a.copy(from).sub(this.specs[fromWorld].center).normalize().clone()
    const upTo = _b.copy(toPos).sub(this.specs[to].center).normalize().clone()
    const mid = from.clone().add(toPos).multiplyScalar(0.5)
    const lift = from.distanceTo(toPos) * 0.16 + 22
    ship.from.copy(from)
    ship.to.copy(toPos)
    ship.ctrl.copy(mid).addScaledVector(upFrom, lift).addScaledVector(upTo, lift)
    ship.fromWorld = fromWorld
    ship.toWorld = to
    ship.state = 'flying'
    ship.t = 0
    ship.dur = WAR.shipFlight
    ship.heading.copy(ship.group.quaternion)
    ship.autopilot = true
    if (ship.rider) this.shuttleToB = to === 'B'
  }

  /** Nearest boardable vehicle, for the HUD prompt and the F key. */
  nearestVehicle(pos: THREE.Vector3): { kind: VehicleKind; dist: number; point: THREE.Vector3 } | null {
    let bestDist = Infinity
    let bestKind: VehicleKind | null = null
    let bestPoint: THREE.Vector3 | null = null
    for (const s of this.ships) {
      if (s.state !== 'docked') continue
      const d = pos.distanceTo(s.group.position)
      if (d < 6 && d < bestDist) { bestDist = d; bestKind = 'ship'; bestPoint = s.group.position.clone() }
    }
    for (const point of [this.rocketPadPoint('A'), this.rocketPadPoint('B')]) {
      const d = pos.distanceTo(point)
      if (d < 5 && d < bestDist) { bestDist = d; bestKind = 'rocket'; bestPoint = point }
    }
    return bestKind && bestPoint ? { kind: bestKind, dist: bestDist, point: bestPoint } : null
  }

  /** Nearest boardable shuttle (any faction), used when F is pressed. */
  private nearestShip(pos: THREE.Vector3): Ship | null {
    let best: Ship | null = null
    let bestDist = Infinity
    for (const s of this.ships) {
      if (s.state !== 'docked') continue
      const d = pos.distanceTo(s.group.position)
      if (d < 6 && d < bestDist) { bestDist = d; best = s }
    }
    return best
  }

  /** Board the nearest vehicle at the player's feet. */
  board(kind: VehicleKind, world: Faction, playerDir: THREE.Vector3, at?: THREE.Vector3): boolean {
    if (this.carried) return false
    if (kind === 'ship') {
      const ship = at ? this.nearestShip(at) : null
      if (!ship) return false
      ship.rider = true
      this.carried = { kind: 'ship', ref: ship }
      this.launchShip(ship, ship.fromWorld === 'A' ? 'B' : 'A')
      this.audio.equip()
      this.toast(ship.toWorld === 'B' ? '登舰！飞船直飞敌方星球 · E 切换手动操控' : '返航糖果星球 · E 切换手动操控', 'gold')
    } else {
      const r = this.makeRocket(world, this.rocketPadPoint(world), playerDir)
      r.rider = true
      this.carried = { kind: 'rocket', ref: r }
      this.toast('火箭已点燃 · 鼠标转向，W 推进，燃料耗尽会被引力拽走！', 'gold')
    }
    this.syncRide()
    return true
  }

  /** Eject a rocket from a flying shuttle; the shuttle keeps its course. */
  ejectRocket() {
    if (this.carried?.kind !== 'ship') return false
    const ship = this.carried.ref as Ship
    if (ship.state !== 'flying') return false
    const r = this.makeRocket(ship.toWorld, ship.group.position, _a.copy(ship.group.position).sub(this.specs[ship.fromWorld].center).normalize())
    r.vel.copy(_b.set(0, 0, 0))
    if (ship.state === 'flying') {
      r.vel.addScaledVector(_c.copy(ship.to).sub(ship.from).normalize(), ship.speed)
    }
    r.rider = true
    ship.rider = false
    this.carried = { kind: 'rocket', ref: r }
    this.toast('弹射！操控火箭冲向敌方星球', 'gold')
    this.syncRide()
    return true
  }

  private makeRocket(world: Faction, at: THREE.Vector3, up: THREE.Vector3) {
    const group = rocketMesh(world === 'B')
    group.position.copy(at)
    // The mesh nose and thrust both point along local FWD (-Z). Align FWD to
    // the radial `up` so "forward" means "away from the planet" on launch.
    group.quaternion.setFromUnitVectors(FWD, up)
    const rocket: Rocket = {
      group, faction: 'A', active: true, pos: at.clone(),
      vel: _a.copy(up).multiplyScalar(WAR.rocketLaunch).clone(),
      heading: group.quaternion.clone(), fuel: WAR.rocketFuel, hp: WAR.rocketHp,
      rider: false, cannonCd: 0, fromWorld: world, age: 0,
    }
    group.traverse((o) => { o.userData.war = 'rocket'; o.userData.ref = rocket })
    this.group.add(group)
    this.rockets.push(rocket)
    return rocket
  }

  toggleAutopilot() {
    if (this.carried?.kind !== 'ship') return
    const ship = this.carried.ref as Ship
    ship.autopilot = !ship.autopilot
    if (ship.autopilot) {
      // Handing back to the autopilot: clear free-flight state, it flies the corridor again.
      ship.vel.set(0, 0, 0)
      ship.steer.set(0, 0, 0)
      this.toast('自动驾驶 · 飞船自动巡航往返', 'gold')
    } else {
      // Taking over mid-flight: inherit the cruise direction so there is no dead stop.
      const fwd = _a.copy(FWD).applyQuaternion(ship.heading).normalize()
      ship.vel.copy(fwd).multiplyScalar(Math.max(ship.speed, 20))
      this.toast('手动接管 · W/S 前进后退 · 鼠标转向 · A/D 侧移', 'gold')
    }
    this.syncRide()
  }

  /** Apply this frame's pilot input to the carried vehicle.
   *  Yaw/pitch turn in the vehicle's LOCAL frame (post-multiply), so mouse-X
   *  actually changes the nose direction — world-frame yaw around UP does not. */
  pilot(dt: number, forward: number, strafe: number, dx: number, dy: number) {
    if (!this.carried) return
    const ref = this.carried.ref
    const yaw = (r: number) => _q.setFromAxisAngle(_localUp, -r)
    const pitch = (r: number) => _q.setFromAxisAngle(_localRight, -r)
    if (this.carried.kind === 'ship') {
      const ship = ref as Ship
      if (ship.autopilot) return
      // Free flight: the mouse aims the nose in the ship's LOCAL frame, and
      // W/S push along that nose, A/D push sideways. Position is integrated
      // from velocity — no bezier corridor, no invisible rail, no fixed pad.
      ship.heading.multiply(yaw(dx * 0.0030))
      ship.heading.multiply(pitch(dy * 0.0030))
      ship.heading.normalize()
      const nose = _a.copy(FWD).applyQuaternion(ship.heading).normalize()
      if (forward !== 0) ship.vel.addScaledVector(nose, WAR.shipThrust * forward * dt)
      if (strafe !== 0) {
        const right = _b.copy(_localRight).applyQuaternion(ship.heading).normalize()
        ship.vel.addScaledVector(right, WAR.shipStrafe * strafe * dt)
      }
      // Bleed speed so releasing the keys coasts to a stop instead of drifting
      // forever; clamp so sustained thrust reaches a sane terminal velocity.
      ship.vel.multiplyScalar(Math.max(0, 1 - WAR.shipDamping * dt))
      if (ship.vel.length() > WAR.shipMaxSpeed) ship.vel.setLength(WAR.shipMaxSpeed)
      ship.group.position.addScaledVector(ship.vel, dt)
      ship.speed = ship.vel.length()
      ship.group.quaternion.copy(ship.heading)

      // Touchdown: whichever world's surface the player flies into, at the
      // exact spot they chose. Gentle = land in place; fast = crash.
      for (const world of ['A', 'B'] as const) {
        const spec = this.specs[world]
        const toCenter = _c.copy(ship.group.position).sub(spec.center)
        const dist = toCenter.length()
        const dir = _dirB.copy(toCenter).divideScalar(Math.max(dist, 1e-4))
        const surface = this.surfaceAt(world, dir)
        if (dist > surface + WAR.shipLandingDist) continue
        // Only count it as a landing when actually closing on the surface.
        // Flying away from the pad (e.g. just took off) must not re-trigger it.
        const radial = -ship.vel.dot(dir)
        if (radial <= 0.5) continue
        if (radial > WAR.shipLandingSpeed) {
          this.fx.burst(ship.group.position, 26, { colors: [COLORS.gold, '#FF7A5C'], speed: 8, size: 0.14, life: 0.6, up: dir.clone() })
          if (ship.rider) {
            this.toast('飞船坠毁！在己方星球重生…', 'bad')
            if (this.lastCtx) this.bailRider(this.lastCtx)
          }
          ship.hp = WAR.shipHp
          this.parkShip(ship, ship.toWorld)
        } else {
          // Set down exactly where the player flew to, not a scripted pad.
          ship.group.position.copy(spec.center).addScaledVector(dir, surface + 1.4)
          ship.group.quaternion.setFromUnitVectors(UP, dir)
          ship.heading.copy(ship.group.quaternion)
          ship.state = 'docked'
          ship.fromWorld = world
          ship.toWorld = world
          ship.dockTimer = WAR.shipCruise
          ship.speed = 0
          ship.vel.set(0, 0, 0)
          ship.steer.set(0, 0, 0)
          ship.autopilot = true
          this.audio.capture()
          this.toast(world === 'B' ? '降落敌方星球 · 就地起飞去拆塔夺心！' : '降落糖果星球 · 补给站可补弹', 'good')
        }
        break
      }
    } else {
      const rocket = ref as Rocket
      rocket.heading.multiply(yaw(dx * 0.0022))
      rocket.heading.multiply(pitch(dy * 0.0022))
      rocket.heading.normalize()
      rocket.group.quaternion.copy(rocket.heading)
      if (forward !== 0 && rocket.fuel > 0) {
        const dir = _a.copy(FWD).applyQuaternion(rocket.heading).normalize()
        rocket.vel.addScaledVector(dir, WAR.rocketThrust * forward * dt)
        rocket.fuel = Math.max(0, rocket.fuel - WAR.rocketBurn * Math.abs(forward) * dt)
      }
      void strafe
    }
  }

  /** Fire the carried vehicle's cannon at world targets; returns a hit point. */
  fireVehicle(damageMult = 1) {
    if (!this.carried) return
    const ref = this.carried.ref
    if (this.carried.kind === 'ship') {
      const ship = ref as Ship
      if (ship.cannonCd > 0) return
      ship.cannonCd = WAR.shipCannonPeriod
      this.autoHit(ship.group.position, ship.group.quaternion, WAR.shipCannonRange, WAR.shipCannonDamage * damageMult, '#8ED8FF')
    } else {
      const rocket = ref as Rocket
      if (rocket.cannonCd > 0 || rocket.fuel <= 0) return
      rocket.cannonCd = WAR.rocketCannonPeriod
      this.autoHit(rocket.group.position, rocket.heading, WAR.rocketCannonRange, WAR.rocketCannonDamage * damageMult, COLORS.gold)
    }
  }

  /** Free-aim cannon: pick the closest hostile roughly in front and shoot it. */
  private autoHit(origin: THREE.Vector3, quat: THREE.Quaternion, range: number, damage: number, color: string) {
    const dir = _a.copy(FWD).applyQuaternion(quat).normalize()
    let best: { point: THREE.Vector3; kind: string; ref: unknown } | null = null
    let bestScore = 0.72
    for (const t of this.turrets) {
      if (t.dead || t.world === 'A') continue
      const to = _b.copy(t.group.position).sub(origin)
      const d = to.length()
      if (d > range) continue
      const score = to.normalize().dot(dir)
      if (score > bestScore) { bestScore = score; best = { point: t.group.position.clone(), kind: 'turret', ref: t } }
    }
    for (const s of this.soldiers) {
      if (s.faction !== 'B' || s.state === 'dead') continue
      const to = _b.copy(s.group.position).sub(origin)
      const d = to.length()
      if (d > range) continue
      const score = to.normalize().dot(dir)
      if (score > bestScore) { bestScore = score; best = { point: s.group.position.clone().addScaledVector(s.dir, 1), kind: 'soldier', ref: s } }
    }
    const end = best ? best.point : _c.copy(origin).addScaledVector(dir, range * 0.6).clone()
    this.fx.tracer(origin.clone(), end.clone(), color)
    this.fx.flash(origin.clone(), color, 0.5)
    if (best) this.hitTarget(best.kind, best.ref, damage, best.point)
  }

  /** Leave the carried vehicle; returns where to put the player on foot. */
  dismount(): { world: Faction; point: THREE.Vector3 } | null {
    if (!this.carried) return null
    const carried = this.carried
    this.carried = null
    this.ride = null
    if (carried.kind === 'ship') {
      const ship = carried.ref as Ship
      ship.rider = false
      if (ship.state !== 'flying') return { world: ship.fromWorld, point: ship.group.position.clone() }
      // Bail out mid-flight: pick the nearer world and fall there.
      const world: Faction = ship.group.position.distanceTo(this.specs.A.center) < ship.group.position.distanceTo(this.specs.B.center) ? 'A' : 'B'
      return { world, point: this.capitalDir(world).multiplyScalar(surfaceFor(this.specs[world], this.capitalDir(world))).add(this.specs[world].center) }
    }
    const rocket = carried.ref as Rocket
    rocket.rider = false
    const world = rocket.age < 1 ? rocket.fromWorld : (rocket.group.position.distanceTo(this.specs.A.center) < rocket.group.position.distanceTo(this.specs.B.center) ? 'A' : 'B')
    return { world, point: rocket.group.position.clone() }
  }

  private syncRide() {
    if (!this.carried) { this.ride = null; return }
    const ref = this.carried.ref
    if (this.carried.kind === 'ship') {
      const s = ref as Ship
      this.ride = {
        kind: 'ship', autopilot: s.autopilot, hp: s.hp, maxHp: WAR.shipHp,
        fuel: 0, maxFuel: 0, target: s.toWorld, progress: s.t, speed: s.speed,
        pose: { position: s.group.position, quaternion: s.group.quaternion, up: _a.copy(s.group.position).sub(this.specs[s.fromWorld].center).normalize().clone() },
      }
    } else {
      const r = ref as Rocket
      this.ride = {
        kind: 'rocket', autopilot: false, hp: r.hp, maxHp: WAR.rocketHp,
        fuel: r.fuel, maxFuel: WAR.rocketFuel, target: r.fromWorld === 'A' ? 'B' : 'A',
        progress: 0, speed: r.vel.length(),
        pose: { position: r.group.position, quaternion: r.heading, up: _a.set(0, 1, 0).applyQuaternion(r.heading).clone() },
      }
    }
  }

  /** Seconds until the next docked shuttle departs (the soonest timer). */
  shuttleEta() {
    let soonest = Infinity
    for (const s of this.ships) {
      if (s.state === 'docked' && s.dockTimer < soonest) soonest = s.dockTimer
    }
    return Number.isFinite(soonest) ? Math.max(0, soonest) : 0
  }

  get isFlying() { return this.ships.some((s) => s.state === 'flying') }
  get shuttleDestination() { return this.shuttleToB ? 'B' as const : 'A' as const }

  // -------------------------------------------------------------- B digging

  digDepth(dir: THREE.Vector3) {
    let deepest = 0
    for (const d of this.digsB) {
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(d.dir), -1, 1)) * 96
      if (ang > d.radius) continue
      // Flat-bottomed bowl: full depth across the inner half, then a smooth
      // rim, so a deep shaft has a floor the player can actually stand in.
      const t = ang / d.radius
      const falloff = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45
      const depth = d.depth * Math.max(0, falloff)
      if (depth > deepest) deepest = depth
    }
    return deepest
  }

  digB(world: Faction, point: THREE.Vector3, aim: THREE.Vector3) {
    if (world !== 'B') return
    const dir = _a.copy(point).sub(this.specs.B.center).normalize().clone()
    // Re-shovelling the same shaft deepens it instead of making a fresh dent.
    // Merge when the new bite lands within ~40% of an existing hole's radius.
    let target: Dig | undefined
    let bestAng = Infinity
    for (const d of this.digsB) {
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(d.dir), -1, 1)) * 96
      if (ang < d.radius * 0.4 && ang < bestAng) { bestAng = ang; target = d }
    }
    if (target) {
      target.depth = Math.min(WAR.digMaxB, target.depth + WAR.digStepB)
      target.dir.lerp(dir, 0.25).normalize()  // follow the aim as the shaft grows
    } else {
      if (this.digsB.length >= 24) this.digsB.shift()
      this.digsB.push({ dir, depth: WAR.digStepB, radius: WAR.digRadiusB })
    }
    this.fx.burst(point, 16, { colors: ['#8A5A44', '#B48BD8', COLORS.lemon], speed: 3.4, size: 0.11, life: 0.5, up: dir })
    this.fx.ring(point, dir, COLORS.lemon, 1.4)
    // Reshape the B mesh around the fresh hole.
    this.reshapeB()
    void aim
  }

  private reshapeB() {
    const mesh = this.terrains[1] as THREE.Mesh
    const geo = mesh.geometry as THREE.BufferGeometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colAttr = geo.attributes.color as THREE.BufferAttribute
    const dir = new THREE.Vector3()
    // Dirt layers exposed as the shaft deepens: topsoil -> packed earth ->
    // bedrock right above the core floor.
    const topsoil = new THREE.Color('#B9825C')
    const deep = new THREE.Color('#8A5A44')
    const bedrock = new THREE.Color('#54412E')
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(this.specs.B.center).normalize()
      const base = surfaceFor(this.specs.B, dir) - this.digDepth(dir)
      const depth = this.digDepth(dir)
      pos.setXYZ(i, this.specs.B.center.x + dir.x * base, this.specs.B.center.y + dir.y * base, this.specs.B.center.z + dir.z * base)
      if (depth > 0.12) {
        // Colour the pit wall by how deep the player has dug here.
        const t = THREE.MathUtils.clamp(depth / WAR.digMaxB, 0, 1)
        tmp.copy(topsoil).lerp(deep, Math.min(1, t * 2))
        if (t > 0.5) tmp.lerp(bedrock, (t - 0.5) * 2)
        colAttr.setXYZ(i, tmp.r, tmp.g, tmp.b)
      } else if (this.bBaseColors) {
        // Healed/untouched ground keeps its pristine grass or sea colour.
        colAttr.setXYZ(i, this.bBaseColors[i * 3], this.bBaseColors[i * 3 + 1], this.bBaseColors[i * 3 + 2])
      }
    }
    pos.needsUpdate = true
    colAttr.needsUpdate = true
    geo.computeVertexNormals()
  }

  surfaceAt(world: Faction, dir: THREE.Vector3) {
    return surfaceFor(this.specs[world], dir, world === 'B' ? (d) => this.digDepth(d) : undefined)
  }

  // ------------------------------------------------------------------- main

  update(dt: number, ctx: WarCtx) {
    this.lastCtx = ctx
    this.time += dt
    this.updateShip(dt, ctx)
    this.updateRockets(dt, ctx)
    this.updateHearts(dt, ctx)
    this.updateTurrets(dt, ctx)
    this.updateSoldiers(dt, ctx)
    this.updateBullets(dt, ctx)
    this.updateSupplies(dt, ctx)
    this.syncRide()
    this.syncBars()
    void this.time
  }

  /**
   * Keep every health bar in world space above its unit. Bars live in their
   * own group so they never inherit a unit's scale or facing; the fill is
   * anchored on its left edge via a per-frame position nudge.
   */
  private syncBars() {
    const place = (grp: THREE.Group | undefined, fill: THREE.Sprite | undefined, hp: number, maxHp: number,
                   pos: THREE.Vector3, center: THREE.Vector3, height: number, width: number, visible: boolean) => {
      if (!grp || !fill) return
      grp.visible = visible
      if (!visible) return
      const up = _a.copy(pos).sub(center).normalize()
      grp.position.copy(pos).addScaledVector(up, height)
      const ratio = THREE.MathUtils.clamp(hp / maxHp, 0, 1)
      fill.scale.x = Math.max(0.001, width * ratio)
      fill.position.x = -(width - fill.scale.x) * 0.5
    }
    for (const t of this.turrets) {
      const width = t.barGroup?.userData.barWidth as number | undefined ?? 4.2
      place(t.barGroup, t.barFill, t.hp, t.maxHp, t.group.position, this.specs[t.world].center,
        t.barHeight, width, !t.dead)
    }
    for (const s of this.soldiers) {
      const width = s.barGroup?.userData.barWidth as number | undefined ?? 2.6
      place(s.barGroup, s.barFill, s.hp, s.maxHp, s.group.position, this.specs[s.world].center,
        s.barHeight, width, s.state !== 'dead' && s.state !== 'transit')
    }
  }

  /** Crates glow while charged, dim on cooldown, and auto-refill close by. */
  private updateSupplies(dt: number, ctx: WarCtx) {
    for (const supply of this.supplies) {
      if (supply.cooldown > 0) {
        supply.cooldown = Math.max(0, supply.cooldown - dt)
        supply.ringMat.color.set('#6B6B78')
        supply.ringMat.opacity = 0.35
        supply.core.visible = false
        continue
      }
      supply.ringMat.color.set('#FFD75E')
      supply.ringMat.opacity = 0.85
      supply.core.visible = true
      supply.core.rotation.y += dt * 2
      // Auto-refill a nearby foot soldier on the same world.
      if (ctx.playerAlive && !ctx.playerInRide && ctx.playerWorld === supply.world
          && ctx.playerPos.distanceTo(supply.pos) < WAR.supplyRadius) {
        supply.cooldown = WAR.supplyCooldown
        ctx.refillAmmo(WAR.supplyAmmo)
        ctx.toast('弹药补给完成 · 备弹已补满！', 'good')
        this.fx.ring(supply.pos, _a.copy(supply.pos).sub(this.specs[supply.world].center).normalize(), '#FFD75E', 2.4)
        this.audio.capture()
      }
    }
  }

  /** Whether a charged supply crate is within reach of the player right now. */
  nearbySupply(pos: THREE.Vector3, world: Faction): boolean {
    return this.supplies.some((s) => s.world === world && s.cooldown <= 0 && pos.distanceTo(s.pos) < WAR.supplyRadius + 3)
  }

  private updateShip(dt: number, ctx: WarCtx) {
    for (const s of this.ships) {
      if (s.cannonCd > 0) s.cannonCd -= dt
      if (s.state === 'docked') {
        s.dockTimer -= dt
        if (s.dockTimer <= 0) this.launchShip(s, s.fromWorld === 'A' ? 'B' : 'A')
        continue
      }
      if (s.autopilot) {
        s.t = Math.min(1, s.t + dt / s.dur)
        bezier(s.from, s.ctrl, s.to, s.t, s.group.position)
        _a.copy(s.ctrl).sub(s.from).multiplyScalar(2 * (1 - s.t))
          .add(_b.copy(s.to).sub(s.ctrl).multiplyScalar(2 * s.t))
        if (_a.lengthSq() > 1e-6) s.group.quaternion.setFromUnitVectors(FWD, _a.normalize())
        // Cruise speed is a fixed sane number: the chord between two worlds is
        // hundreds of metres, so dividing world displacement by t would give a
        // bogus thousands-of-m/s figure that detonates manual mode on takeover.
        s.speed = s.from.distanceTo(s.to) / s.dur
      }
      if (s.t >= 1 && s.autopilot) {
        const world = s.toWorld
        this.parkShip(s, world)
        if (s.rider) {
          this.audio.capture()
          ctx.toast(world === 'B' ? '抵达敌方星球 · 站上紫环唤醒星球之心' : '回到糖果星球', 'gold')
        }
      }
      // Shot down: respawn the hull on the pad it was heading to.
      if (s.hp <= 0 && s.state === 'flying') {
        if (s.rider) {
          ctx.toast('飞船被击落！', 'bad')
          this.bailRider(ctx)
        }
        s.hp = WAR.shipHp
        this.parkShip(s, s.toWorld)
      }
    }
  }

  private updateRockets(dt: number, ctx: WarCtx) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]
      if (r.cannonCd > 0) r.cannonCd -= dt
      if (!r.active) continue
      r.age += dt
      // Gravity from both worlds always applies — a stalled rocket falls to
      // whichever planet is closer, exactly as the brief describes.
      gravityAt(r.pos, [this.specs.A, this.specs.B], _a)
      r.vel.addScaledVector(_a, dt)
      r.pos.addScaledVector(r.vel, dt)
      r.group.position.copy(r.pos)

      let landed: Faction | null = null
      let impact = 0
      for (const world of ['A', 'B'] as const) {
        const spec = this.specs[world]
        const toCenter = _b.copy(r.pos).sub(spec.center)
        const dist = toCenter.length()
        const ground = surfaceFor(spec, toCenter.normalize()) + 0.9
        if (dist <= ground) {
          landed = world
          impact = Math.abs(r.vel.dot(toCenter))
          break
        }
      }
      if (landed) {
        r.active = false
        if (impact > WAR.safeLanding) {
          this.fx.burst(r.pos, 28, { colors: [COLORS.gold, '#FF7A5C'], speed: 8, size: 0.14, life: 0.6, up: _c.copy(r.pos).normalize() })
          ctx.toast('火箭坠毁！在己方星球重生…', 'bad')
          if (r.rider) this.bailRider(ctx)
        } else {
          this.fx.burst(r.pos, 12, { colors: [COLORS.lemon, COLORS.white], speed: 4, size: 0.09, life: 0.4, up: _c.copy(r.pos).normalize() })
          if (r.rider) ctx.toast(landed === 'B' ? '成功降落敌方星球 · 摧毁防御塔夺取星球之心' : '安全返航', 'good')
        }
        this.group.remove(r.group)
        this.rockets.splice(i, 1)
        if (r.rider) this.carried = null
      }
    }
  }

  private bailRider(ctx: WarCtx) {
    if (this.carried) {
      const carried = this.carried
      if (carried.kind === 'ship') (carried.ref as Ship).rider = false
      else (carried.ref as Rocket).rider = false
      this.carried = null
      this.ride = null
    }
    ctx.hurtPlayer(99, _a.copy(PLANET_B.center))
  }

  private updateHearts(dt: number, ctx: WarCtx) {
    const bBig = this.bigTurret('B')
    const aBig = this.bigTurret('A')
    // Our heart stolen by enemy soldiers standing on it.
    if (aBig.dead && this.soldiers.some((s) => s.faction === 'B' && s.state === 'capture' && s.world === 'A')) {
      this.progressA = Math.min(1, this.progressA + dt / WAR.heartCaptureTime)
    } else {
      this.progressA = Math.max(0, this.progressA - dt * 0.06)
    }
    // Enemy heart: shielded by the big turret; once it falls, stand on it.
    if (bBig.dead) {
      if (!this.bigDownWarned) {
        this.bigDownWarned = true
        ctx.toast('敌方主塔已摧毁 · 星球之心暴露！', 'gold')
      }
      const captured = ctx.playerAlive && !ctx.playerInRide && ctx.playerWorld === 'B'
        && ctx.playerPos.distanceTo(this.heartMesh.B.position) < 4.2
      const allyOn = this.soldiers.some((s) => s.faction === 'A' && s.state === 'capture' && s.world === 'B')
      if (captured || allyOn) {
        this.progressB = Math.min(1, this.progressB + dt / WAR.heartCaptureTime)
        if (this.bHeartState === 'hidden') {
          this.bHeartState = 'risen'
          this.heartBeam.B.color.set(COLORS.gold)
        }
      } else {
        this.progressB = Math.max(0, this.progressB - dt * 0.06)
      }
    }
    this.heartMesh.A.rotation.y += dt * 0.7
    this.heartMesh.B.rotation.y += dt * 1.1
    const pulse = 1 + Math.sin(this.time * 3) * 0.07
    this.heartMesh[ctx.playerWorld].scale.set(pulse, pulse * 1.45, pulse)
    if (this.progressA > 0.5 && !this.enemyWarned) {
      this.enemyWarned = true
      ctx.toast('警告：我方星球之心正在被夺走！', 'bad')
    }
    if (this.progressA >= 1 && !this.endLock) {
      this.endLock = true
      ctx.onEnd(false)
    }
    if (this.progressB >= 1 && !this.endLock) {
      this.endLock = true
      this.bHeartState = 'taken'
      this.heartMesh.B.visible = false
      this.fx.burst(this.heartMesh.B.position, 40, { colors: [COLORS.gold, COLORS.lemon, COLORS.white], speed: 8, size: 0.14, life: 0.8, up: this.capitalDir('B') })
      ctx.onEnd(true)
    }
  }

  /** Launch a projectile toward where the target is *now*. No homing: a target
   *  that moves after the shot is fired will dodge it. */
  private spawnBullet(from: THREE.Vector3, to: THREE.Vector3, world: Faction, owner: Faction,
                      kind: WarBullet['kind'], ref: unknown, speed: number, dmg: number) {
    const b = this.bullets.find((x) => x.life <= 0)
    if (!b) return
    _a.copy(to).sub(from)
    const dist = _a.length()
    if (dist < 0.4) return
    _a.divideScalar(dist)
    b.pos.copy(from)
    b.vel.copy(_a).multiplyScalar(speed)
    b.life = Math.min(3.2, dist / speed + 0.15)
    b.world = world
    b.owner = owner
    b.kind = kind
    b.ref = ref
    b.dmg = dmg
    b.mesh.position.copy(from)
    b.mesh.visible = true
  }

  /** Integrate projectiles; apply damage only on an actual proximity hit. */
  private updateBullets(dt: number, ctx: WarCtx) {
    for (const b of this.bullets) {
      if (b.life <= 0) continue
      b.life -= dt
      if (b.life <= 0) { b.mesh.visible = false; continue }
      b.pos.addScaledVector(b.vel, dt)
      b.mesh.position.copy(b.pos)

      // Skim along the planet's curve instead of cutting a chord through the
      // ground: on a small sphere a straight shot at a surface target would
      // otherwise bury itself mid-flight and never connect.
      const spec = this.specs[b.world]
      _dirB.copy(b.pos).sub(spec.center)
      const r = _dirB.length()
      if (r > 1) {
        _dirB.divideScalar(r)
        const minR = surfaceFor(spec, _dirB, b.world === 'B' ? (d) => this.digDepth(d) : undefined) + 1.3
        if (r < minR) {
          b.pos.copy(spec.center).addScaledVector(_dirB, minR)
          b.mesh.position.copy(b.pos)
        }
      }

      // Proximity to the intended target only — other entities are not hit.
      let struck = false
      if (b.kind === 'player') {
        const eligible = ctx.playerAlive && !ctx.playerInRide && ctx.playerWorld === b.world && b.owner !== 'A'
        if (eligible && b.pos.distanceTo(ctx.playerPos) < 1.5) {
          // War rounds are balanced against 110-HP soldiers, but the player
          // only has a 3-heart pool: scale a hit to heart units (small/mid
          // turret + soldier rounds = 1 heart, big turret / hero = 2) so a
          // single graze wounds instead of deleting the player outright.
          ctx.hurtPlayer(Math.max(1, Math.round(b.dmg / 10)), b.pos)
          struck = true
        }
      } else if (b.kind === 'soldier') {
        const s = b.ref as Soldier | null
        if (s && s.state !== 'dead' && s.faction !== b.owner && b.pos.distanceTo(s.group.position) < 1.4) {
          this.damageSoldier(s, b.dmg)
          struck = true
        }
      } else if (b.kind === 'ship') {
        const sh = b.ref as Ship | null
        if (sh && sh.state === 'flying' && sh.faction !== b.owner && b.pos.distanceTo(sh.group.position) < 2.6) {
          this.damageShip(sh, b.dmg)
          struck = true
        }
      } else if (b.kind === 'rocket') {
        const r = b.ref as Rocket | null
        if (r && r.active && r.faction !== b.owner && b.pos.distanceTo(r.pos) < 1.6) {
          this.damageRocket(r, b.dmg)
          struck = true
        }
      } else if (b.kind === 'turret') {
        const t = b.ref as Turret | null
        if (t && !t.dead && b.pos.distanceTo(t.group.position) < 2.0) {
          // attacker = the bullet's owner, so B rounds can destroy A turrets.
          this.hitTarget('turret', t, b.dmg, b.pos, false, b.owner)
          struck = true
        }
      }
      if (struck) {
        b.life = 0
        b.mesh.visible = false
        this.fx.burst(b.pos, 5, { colors: ['#FFD98A', COLORS.white], speed: 3, size: 0.07, life: 0.28 })
      }
    }
  }

  private updateTurrets(dt: number, ctx: WarCtx) {
    for (const t of this.turrets) {
      if (t.dead) continue
      t.cooldown -= dt
      const spec = this.specs[t.world]
      const origin = t.group.position
      let target: THREE.Vector3 | null = null
      let targetKind: 'player' | 'soldier' | 'ship' | 'rocket' | null = null
      let targetRef: unknown = null
      let best = Infinity

      const consider = (point: THREE.Vector3, kind: typeof targetKind, ref: unknown, bonus = 0) => {
        const d = point.distanceTo(origin)
        if (d < best && d < WAR.turret[t.tier].range + bonus) { best = d; target = point; targetKind = kind; targetRef = ref }
      }
      // A turret belongs to the faction of the planet it sits on. The player,
      // their ship and their rockets all fight for A: only enemy (B) turrets
      // may target them, and only while they are on/near that same world.
      if (ctx.playerAlive && !ctx.playerInRide && t.world === 'B' && ctx.playerWorld === t.world)
        consider(ctx.playerPos, 'player', null)
      for (const s of this.soldiers) {
        if (s.faction === t.world || s.state === 'dead') continue
        if (s.world === t.world) consider(s.group.position, 'soldier', s)
      }
      for (const sh of this.ships) {
        if (sh.state === 'flying' && sh.faction !== t.world && sh.group.position.distanceTo(spec.center) < 220)
          consider(sh.group.position, 'ship', sh, 40)
      }
      for (const r of this.rockets) if (r.active && r.faction !== t.world) consider(r.pos, 'rocket', r, 20)

      if (!target) continue
      const tp = target as THREE.Vector3
      // Track with the head.
      _a.copy(tp).sub(origin)
      const local = t.group.worldToLocal(_a.clone())
      _b.copy(local).sub(t.head.position)
      const yaw = Math.atan2(-_b.x, -_b.z)
      t.head.rotation.y += THREE.MathUtils.clamp(yaw - t.head.rotation.y, -3 * dt, 3 * dt)
      const pitch = Math.atan2(_b.y, Math.hypot(_b.x, _b.z))
      t.head.rotation.x = THREE.MathUtils.clamp(-pitch, -0.65, 0.65)
      if (t.cooldown <= 0 && targetKind) {
        t.cooldown = WAR.turret[t.tier].period
        t.tip.getWorldPosition(_c)
        const col = t.world === 'B' ? '#FF7A5C' : '#8ED8FF'
        this.fx.flash(_c.clone(), col, 0.55)
        // Fire a travelling round, not an instant hit. The target can move
        // out of the way during the bullet's flight.
        this.spawnBullet(_c, tp, t.world, t.world, targetKind, targetRef,
          BULLET_TIER_SPEED[t.tier], WAR.turret[t.tier].damage)
      }
    }
  }

  private soldierFire(s: Soldier, ctx: WarCtx) {
    if (s.cooldown > 0) return
    const cfg = s.isHero ? WAR.hero : WAR.soldier
    let hit: { point: THREE.Vector3; ref: unknown; kind: string } | null = null
    let best: number = cfg.range
    for (const t of this.turrets) {
      if (t.dead || t.world !== s.world) continue
      // A-planet turrets belong to faction A; never shoot your own.
      if ((t.world === 'A') === (s.faction === 'A')) continue
      const d = s.group.position.distanceTo(t.group.position)
      if (d < best) { best = d; hit = { point: t.group.position.clone(), ref: t, kind: 'turret' } }
    }
    if (!hit && ctx.playerAlive && !ctx.playerInRide && ctx.playerWorld === s.world && s.faction === 'B') {
      const d = s.group.position.distanceTo(ctx.playerPos)
      if (d < best) { best = d; hit = { point: ctx.playerPos.clone(), ref: null, kind: 'player' } }
    }
    if (hit) {
      s.cooldown = cfg.period
      const col = s.faction === 'A' ? '#8ED8FF' : '#FF7A5C'
      const muzzle = s.group.position.clone().addScaledVector(s.dir, 1.2)
      this.fx.flash(muzzle, col, s.isHero ? 0.7 : 0.4)
      // Soldiers fire dodgeable projectiles too. Turret hits are applied on
      // arrival via a tiny sentinel bullet kind handled in updateBullets.
      if (hit.kind === 'turret') {
        // AI chip damage is scaled down so the player has time to defend;
        // the player's own gunfire (via hitTarget) stays at full strength.
        this.spawnBullet(muzzle, hit.point, s.world, s.faction, 'turret', hit.ref, BULLET_SPEED,
          cfg.damage * WAR.aiStructureDamageScale)
      } else {
        // Hero rounds actually hurt the player; grunt sentinel rounds are weak.
        this.spawnBullet(muzzle, hit.point, s.world, s.faction, 'player', null, BULLET_SPEED, s.isHero ? cfg.damage : 1)
      }
    }
  }

  private updateSoldiers(dt: number, ctx: WarCtx) {
    for (const s of this.soldiers) {
      s.bob += dt * 9
      if (s.cooldown > 0) s.cooldown -= dt

      if (s.state === 'dead') {
        s.timer -= dt
        if (s.timer <= 0) {
          s.state = 'guard'
          s.world = s.faction
          const rally = s.isHero ? LAYOUT.heroRally : LAYOUT.rally
          // s.dir is a WORLD direction; convert the local rally through frame.
          s.dir.copy(rally).applyQuaternion(this.specs[s.world].frame).normalize()
          s.hp = s.maxHp
          s.group.visible = true
          // Regroup before the next invasion instead of charging straight back.
          s.timer = WAR.aiWaveInterval + iRand() * 8
          this.walkSoldier(s, rally, 0)
        }
        continue
      }
      if (s.state === 'transit') {
        s.timer -= dt
        s.group.visible = false
        if (s.timer <= 0) {
          s.world = s.faction === 'A' ? 'B' : 'A'
          // Re-enter on the destination world, so rotate pad into THAT frame.
          s.dir.copy(LAYOUT.pad).applyQuaternion(this.specs[s.world].frame).normalize()
          s.state = 'assault'
          s.group.visible = true
          this.walkSoldier(s, LAYOUT.pad, 0)
          this.fx.ring(s.group.position, s.dir, s.faction === 'A' ? '#8FE4C2' : '#C86BFA', s.isHero ? 3 : 2)
        }
        continue
      }
      if (s.state === 'board') {
        this.walkSoldier(s, LAYOUT.pad, dt)
        // Compare two WORLD directions: s.dir is world, LAYOUT.pad is local.
        const padWorld = _dirB.copy(LAYOUT.pad).applyQuaternion(this.specs[s.world].frame).normalize()
        if (s.dir.angleTo(padWorld) < 0.04) {
          s.state = 'transit'
          s.timer = s.isHero ? WAR.hero.commute : WAR.soldier.commute
        }
        continue
      }

      const enemyWorld: Faction = s.faction === 'A' ? 'B' : 'A'
      const bigDown = this.bigTurret(enemyWorld).dead

      if (s.state === 'guard') {
        // Hold near the rally point, then board the shuttle to invade.
        this.walkSoldier(s, s.isHero ? LAYOUT.heroRally : LAYOUT.rally, dt)
        s.timer -= dt
        if (s.timer <= 0) { s.state = 'board'; s.timer = 0 }
        continue
      }

      // On enemy soil: cut down turrets, then take the heart.
      if (bigDown) {
        this.walkSoldier(s, LAYOUT.capital, dt)
        s.state = 'capture'
      } else {
        const target = this.turrets
          .filter((t) => t.world === enemyWorld && !t.dead)
          .sort((x, y) => x.group.position.distanceTo(s.group.position) - y.group.position.distanceTo(s.group.position))[0]
        if (target) this.walkSoldier(s, target.group.userData.local as THREE.Vector3, dt)
        s.state = 'assault'
        this.soldierFire(s, ctx)
      }
    }
  }

  private walkSoldier(s: Soldier, localTarget: THREE.Vector3, dt: number) {
    const spec = this.specs[s.world]
    const goal = _a.copy(localTarget).applyQuaternion(spec.frame).normalize()
    const tangent = _b.copy(goal).addScaledVector(s.dir, -goal.dot(s.dir))
    if (tangent.lengthSq() < 1e-5) return
    tangent.normalize()
    const speed = s.isHero ? WAR.hero.speed : WAR.soldier.speed
    s.dir.addScaledVector(tangent, (speed * dt) / 96).normalize()
    const r = this.surfaceAt(s.world, s.dir)
    s.group.position.copy(s.dir).multiplyScalar(r).add(spec.center)
    s.group.quaternion.setFromUnitVectors(UP, s.dir)
    s.group.position.addScaledVector(s.dir, Math.sin(s.bob) * 0.03)
  }

  private damageSoldier(s: Soldier, dmg: number, byPlayer = false) {
    if (s.state === 'dead') return
    s.hp -= dmg
    if (byPlayer) s.lastPlayerHit = this.time
    this.fx.burst(s.group.position.clone().addScaledVector(s.dir, 1), s.isHero ? 9 : 6, { colors: [COLORS.lemon, COLORS.white], speed: 4, size: 0.07, life: 0.3, up: s.dir })
    if (s.hp <= 0) {
      s.state = 'dead'
      s.timer = s.isHero ? WAR.hero.respawn : WAR.soldier.respawn
      s.group.visible = false
      this.fx.burst(s.group.position, s.isHero ? 30 : 16, { colors: [COLORS.gold, COLORS.candy, COLORS.white], speed: 6, size: 0.12, life: 0.6, up: s.dir })
      if (byPlayer) {
        // Any player kill gets the full fanfare (confetti, KO sticker, KDA).
        if (s.faction === 'B') this.lastCtx?.onWarKill(s.isHero ? 'hero' : 'soldier', s.group.position.clone(), s.dir.clone())
      } else if (this.time - s.lastPlayerHit < 5) {
        this.lastCtx?.onAssist()
      }
    }
  }

  private damageShip(ship: Ship, dmg: number) {
    if (ship.state !== 'flying') return
    ship.hp -= dmg
    this.fx.burst(ship.group.position, 5, { colors: [COLORS.lemon, COLORS.white], speed: 3, size: 0.07, life: 0.3, up: _a.copy(ship.group.position).normalize() })
  }

  private damageRocket(r: Rocket, dmg: number) {
    r.hp -= dmg
    if (r.hp <= 0 && r.active) {
      r.active = false
      this.fx.burst(r.pos, 24, { colors: [COLORS.gold, '#FF7A5C'], speed: 7, size: 0.13, life: 0.6, up: _a.copy(r.pos).normalize() })
      if (r.rider) this.carried = null
      this.group.remove(r.group)
      const i = this.rockets.indexOf(r)
      if (i >= 0) this.rockets.splice(i, 1)
    }
  }

  /**
   * War-tagged hits. `attacker` is the shooter's faction: you can never damage
   * a turret on your own world, but B-side AI landing on A must be able to
   * destroy A's turrets and steal the heart. Defaults to the player (A).
   */
  hitTarget(kind: string, ref: unknown, dmg: number, point: THREE.Vector3, byPlayer = true, attacker: Faction = 'A'): 'dead' | 'hit' | null {
    if (kind === 'turret') {
      const t = ref as Turret
      if (!t || t.dead || t.world === attacker) return null
      t.hp -= dmg
      if (byPlayer) t.lastPlayerHit = this.time
      const upT = _a.copy(t.group.position).sub(this.specs[t.world].center).normalize()
      this.fx.burst(point, 6, { colors: [COLORS.lemon, COLORS.white], speed: 4, size: 0.07, life: 0.3, up: upT })
      if (t.hp <= 0) {
        t.dead = true
        t.group.visible = false
        this.audio.shoot('boom')
        this.fx.burst(t.group.position, 22, { colors: [COLORS.gold, '#FF7A5C'], speed: 7, size: 0.12, life: 0.5, up: upT.clone() })
        if (byPlayer) this.lastCtx?.onWarKill('turret', t.group.position.clone(), upT.clone())
        else if (this.time - t.lastPlayerHit < 5) this.lastCtx?.onAssist()
        return 'dead'
      }
      return 'hit'
    }
    if (kind === 'soldier' || kind === 'hero') {
      const s = ref as Soldier
      if (!s || s.faction === attacker) return null
      this.damageSoldier(s, dmg, byPlayer)
      return 'hit'
    }
    if (kind === 'rocket' || kind === 'ship') return null
    return null
  }

  /** Turret counts remaining on the enemy world, for the HUD. */
  turretCounts() {
    const counts = { big: 0, mid: 0, small: 0 }
    for (const t of this.turrets) if (t.world === 'B' && !t.dead) counts[t.tier]++
    return counts
  }

  allyCounts() {
    let friendly = 0
    let hostile = 0
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.state === 'transit') continue
      if (s.faction === 'A') friendly++
      else hostile++
    }
    return { friendly, hostile }
  }

  /** Live status of both heroes, plus how many shuttles are in the sky. */
  heroStatus() {
    let friendly = 0
    let hostile = 0
    let hostileHp = 0
    for (const s of this.soldiers) {
      if (!s.isHero) continue
      if (s.faction === 'A') { if (s.state !== 'dead') friendly = 1 }
      else {
        if (s.state !== 'dead') { hostile = 1; hostileHp = Math.max(0, s.hp / s.maxHp) }
      }
    }
    return { friendly, hostile, hostileHp }
  }

  shipsInFlight() { return this.ships.filter((s) => s.state === 'flying').length }

  private toast(text: string, tone: 'good' | 'bad' | 'gold') {
    // Routed through the context at update time; buffered here for one frame.
    this.pendingToasts.push({ text, tone })
  }
  private pendingToasts: { text: string; tone: 'good' | 'bad' | 'gold' }[] = []

  drainToasts() {
    const out = this.pendingToasts
    this.pendingToasts = []
    return out
  }

  get terrain() { return this.terrains[1] }
}

function bezier(from: THREE.Vector3, ctrl: THREE.Vector3, to: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t
  return out.set(
    u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
    u * u * from.z + 2 * u * t * ctrl.z + t * t * to.z,
  )
}

let seed = 12345
function iRand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return (seed / 0xffffffff - 0.5) * 2
}
