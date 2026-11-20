import * as THREE from 'three'
import { COLORS, PHYSICS } from '../config'
import { gradientMap, toon } from './toon'
import { groundRadius } from './world'
import type { Fx } from './fx'
import type { GameAudio } from './audio'

/**
 * The war across two worlds: the candy planet we defend and the lavender
 * planet we invade. Owns the enemy world mesh, both sides' turrets, the
 * rocket shuttle that ferries the player, enemy transports that drop sappers,
 * and the two planet hearts the factions fight over.
 */

const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _up = new THREE.Vector3()

export const PLANET_B = {
  center: new THREE.Vector3(0.42, 0.62, 0.66).normalize().multiplyScalar(430),
  radius: 62,
}

export type ShipState = 'dockedA' | 'flying' | 'dockedB'

type Ship = {
  group: THREE.Group
  enemy: boolean
  hp: number
  from: THREE.Vector3
  to: THREE.Vector3
  ctrl: THREE.Vector3
  t: number
  dur: number
  released: boolean
  dead: boolean
  deadT: number
}

type Turret = {
  group: THREE.Group
  head: THREE.Group
  barrelTip: THREE.Object3D
  hp: number
  maxHp: number
  cooldown: number
  range: number
  damage: number
  period: number
  dead: boolean
  onB: boolean
}

type Sapper = {
  group: THREE.Group
  hp: number
  dir: THREE.Vector3
  r: number
  phase: number
  capturing: boolean
  /** Attacking the home turret first, per the invasion plan. */
  sieging: boolean
  swing: number
}

export type WarCtx = {
  playerPos: THREE.Vector3
  playerAlive: boolean
  /** Sappers standing in the home ring push this; 1.0 loses the game. */
  enemyCapture: (dp: number) => void
  hurtPlayer: (amount: number, from: THREE.Vector3) => void
}

const SHUTTLE_SPEED = 34
const TRANSPORT_SPEED = 27
const SAPPER_SPEED = 3.0
const SAPPER_HP = 140
const TRANSPORT_HP = 200
const TURRET_HP = 130
const ENEMY_CAPTURE_TIME = 42

function bezier(from: THREE.Vector3, ctrl: THREE.Vector3, to: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t
  return out.set(
    u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
    u * u * from.z + 2 * u * t * ctrl.z + t * t * to.z,
  )
}

function buildRocket(hostile: boolean) {
  const shell = toon(hostile ? '#6B4E8F' : '#FFF3E0')
  const trim = toon(hostile ? '#3A2A50' : '#FF6B8F')
  const finMat = toon(hostile ? '#8FE4C2' : '#8ED8FF')
  const glass = toon('#BFEFFF')
  const parts = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 2.1, 8, 14), shell)
  body.rotation.x = Math.PI / 2
  parts.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.5, 14), trim)
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -2.15
  parts.add(nose)
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 1.15), finMat)
    const a = (i / 3) * Math.PI * 2
    fin.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 1.5)
    fin.rotation.z = a + Math.PI / 2
    parts.add(fin)
  }
  const win = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), glass)
  win.position.set(0, 0.55, -0.75)
  parts.add(win)
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.72, 0.6, 12), trim)
  nozzle.rotation.x = Math.PI / 2
  nozzle.position.z = 2.15
  parts.add(nozzle)
  return parts
}

function buildTurret(hostile: boolean) {
  const baseMat = toon(hostile ? '#4A3654' : '#8A6FBE')
  const headMat = toon(hostile ? '#6B4E8F' : '#C9B6F0')
  const barrelMat = toon(COLORS.outline)
  const group = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.45, 2.1, 10), baseMat)
  base.position.y = 1.05
  group.add(base)
  const head = new THREE.Group()
  head.position.y = 2.35
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), headMat)
  head.add(dome)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.7, 8), barrelMat)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.12, -0.95)
  head.add(barrel)
  const tip = new THREE.Object3D()
  tip.position.set(0, 0.12, -1.85)
  head.add(tip)
  group.add(head)
  return { group, head, tip }
}

export class Warzone {
  readonly group = new THREE.Group()
  /** Everything the player's bullets can hit: transports, turrets, sappers. */
  readonly hostiles = new THREE.Group()
  readonly center = PLANET_B.center.clone()
  readonly radius = PLANET_B.radius
  private readonly planetMesh: THREE.Mesh
  private readonly bRing!: THREE.Group
  private readonly bBeamMat!: THREE.MeshBasicMaterial
  private readonly aHeart: THREE.Mesh
  private readonly bHeartMesh: THREE.Mesh
  private readonly fx: Fx
  private readonly audio: GameAudio

  /** The shuttle the player rides, parked beside the home ring. */
  private shuttle: Ship
  private transports: Ship[] = []
  private sappers: Sapper[] = []
  private turretA: Turret
  private turretsB: Turret[] = []
  private spawnTimer = 42
  private time = 0
  private padADir = new THREE.Vector3(0, 1, 0)
  private ringBDir = new THREE.Vector3()
  private heartRise = 0
  /** Where the shuttle rests on each world (unit dirs from that world's centre). */
  private aParkDir = new THREE.Vector3(0, 1, 0)
  private bParkDir = new THREE.Vector3()
  shuttleToB = true

  shipState: ShipState = 'dockedA'
  /** 0..1 — sappers on the home ring stealing our heart. */
  enemyProgress = 0
  bHeartState: 'hidden' | 'risen' | 'taken' = 'hidden'
  /** Unit up of the enemy ring, for approaching it on foot. */
  get ringDir() {
    return this.ringBDir
  }

  /** Sappers blew up the home turret. */
  get homeTurretDead() {
    return this.turretA.dead
  }

  constructor(scene: THREE.Scene, fx: Fx, audio: GameAudio) {
    this.fx = fx
    this.audio = audio
    scene.add(this.group)
    scene.add(this.hostiles)

    // ---- the lavender world ----
    const geo = new THREE.IcosahedronGeometry(1, 44)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const col = new THREE.Color()
    const dir = new THREE.Vector3()
    const rock = new THREE.Color('#544070')
    const meadow = new THREE.Color('#B48BD8')
    const sea = new THREE.Color('#3EC8C8')
    const cap = new THREE.Color('#EDE4FF')
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize()
      const r = this.surfaceRadius(dir)
      pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r)
      const wob = Math.sin(dir.x * 6.3 + dir.z * 4.1) * 0.5 + Math.sin(dir.y * 8.2 - dir.x * 3.7) * 0.5
      const land = 2.1 + wob * 1.4
      if (r - this.radius < land - 0.9) col.copy(sea)
      else if (r - this.radius > land + 2.6) col.copy(rock).lerp(meadow, 0.35)
      else col.copy(meadow)
      const polar = THREE.MathUtils.smoothstep(Math.abs(dir.y), 0.72, 0.95)
      col.lerp(cap, polar)
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.translate(this.center.x, this.center.y, this.center.z)
    geo.computeVertexNormals()
    this.planetMesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() }))
    this.planetMesh.name = 'planetB'
    this.group.add(this.planetMesh)

    // Up direction on B that faces home.
    this.ringBDir.copy(this.center).multiplyScalar(-1).normalize()

    this.buildRingB()
    this.aHeart = this.buildHeart('#FF5FA2')
    this.bHeartMesh = this.buildHeart('#FFD75E')
    this.group.add(this.aHeart)
    this.group.add(this.bHeartMesh)

    this.shuttle = {
      group: buildRocket(false), enemy: false, hp: 999,
      from: new THREE.Vector3(), to: new THREE.Vector3(), ctrl: new THREE.Vector3(),
      t: 0, dur: 1, released: true, dead: false, deadT: 0,
    }
    // The player's own shuttle is scenery, not a target: keep it out of the raycast set.
    this.group.add(this.shuttle.group)

    this.turretA = this.spawnTurret(false)
    this.turretsB.push(this.spawnTurret(true), this.spawnTurret(true))
    this.placeStructures()
  }

  /** Terrain height on the lavender world, dir measured from B's centre. */
  surfaceRadius(dir: THREE.Vector3) {
    return this.radius
      + 1.6 * Math.sin(dir.x * 5.1 + dir.z * 3.3) * Math.cos(dir.y * 4.2 - dir.x * 2.1)
      + 0.8 * Math.sin(dir.y * 9.1 + dir.z * 7.7)
  }

  private buildHeart(colorHex: string) {
    const mat = new THREE.MeshToonMaterial({ color: colorHex, emissive: new THREE.Color(colorHex).multiplyScalar(0.35) })
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), mat)
    crystal.scale.set(1, 1.5, 1)
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 0.5, 8), toon('#8A6FBE'))
    pedestal.position.y = -1.2
    crystal.add(pedestal)
    return crystal
  }

  private buildRingB() {
    const ring = new THREE.Group()
    const ringMat = new THREE.MeshBasicMaterial({ color: '#C86BFA', transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    const disc = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.3, 40), ringMat)
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.06
    ring.add(disc)
    this.bBeamMat = new THREE.MeshBasicMaterial({ color: '#C86BFA', transparent: true, opacity: 0.16, depthWrite: false })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.2, 26, 20, 1, true), this.bBeamMat)
    beam.position.y = 13
    ring.add(beam)
    this.bRing = ring
    this.group.add(ring)
  }

  private spawnTurret(onB: boolean): Turret {
    const { group, head, tip } = buildTurret(onB)
    this.hostiles.add(group)
    const turret: Turret = {
      group, head, barrelTip: tip, hp: TURRET_HP, maxHp: TURRET_HP,
      cooldown: 0, range: onB ? 26 : 45, damage: onB ? 1 : 14, period: onB ? 1.3 : 0.8,
      dead: false, onB,
    }
    group.traverse((o) => {
      o.userData.war = 'turret'
      o.userData.ref = turret
    })
    if (onB) this.turretsB.push(turret)
    return turret
  }

  /** Pin every structure to its patch of ground. Called once at build. */
  private placeStructures() {
    // Ring on B, facing home.
    const upB = this.ringBDir
    const t1 = _v.set(0.31, 0.81, 0).cross(upB).normalize().clone()
    const t2 = _v.crossVectors(upB, t1).normalize().clone()
    const ringPos = this.center.clone().addScaledVector(upB, this.surfaceRadius(upB))
    this.bRing.position.copy(ringPos)
    this.bRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upB)
    // The enemy heart sleeps at the ring's centre until the ring is taken.
    this.bHeartMesh.position.copy(ringPos).addScaledVector(upB, -2.4)
    this.bHeartMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upB)
    this.bHeartMesh.scale.setScalar(0.01)
    for (let i = 0; i < this.turretsB.length; i++) {
      const side = i === 0 ? 1 : -1
      const dir = ringPos.clone().sub(this.center).normalize()
        .addScaledVector(t1, side * 0.19).addScaledVector(t2, -0.05 * side).normalize()
      const t = this.turretsB[i]
      t.group.position.copy(this.center).addScaledVector(dir, this.surfaceRadius(dir))
      t.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    }
  }

  /** Wire up home-side structures once Game knows the capture pad dirs. */
  init(padADir: THREE.Vector3) {
    this.padADir.copy(padADir).normalize()
    const up = this.padADir
    const t1 = _v2.set(0.2, 0.4, 0.9).cross(up).normalize().clone()
    const t2 = _v2.crossVectors(up, t1).normalize().clone()
    const heartDir = up.clone().addScaledVector(t1, 0.09).addScaledVector(t2, 0.05).normalize()
    this.aHeart.position.copy(heartDir).multiplyScalar(groundRadius(heartDir, PHYSICS.radius + 4))
    this.aHeart.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), heartDir)
    const turretDir = up.clone().addScaledVector(t1, -0.11).addScaledVector(t2, 0.07).normalize()
    this.turretA.group.position.copy(turretDir).multiplyScalar(groundRadius(turretDir, PHYSICS.radius + 4))
    this.turretA.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), turretDir)
    this.aParkDir.copy(up).addScaledVector(t1, 0.14).addScaledVector(t2, -0.1).normalize()
    this.shuttle.group.position.copy(this.aParkDir).multiplyScalar(groundRadius(this.aParkDir, PHYSICS.radius + 4) + 0.1)
    this.shuttle.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.aParkDir)
    // Park spot on B, a hop from the ring.
    this.bParkDir.copy(this.ringBDir).addScaledVector(_v.set(0.31, 0.81, 0).cross(this.ringBDir).normalize(), 0.12).normalize()
    this.shipState = 'dockedA'
  }

  /** Fresh round: clear the skies and put everything back. */
  reset() {
    for (const s of this.transports) this.hostiles.remove(s.group)
    this.transports.length = 0
    for (const s of this.sappers) this.hostiles.remove(s.group)
    this.sappers.length = 0
    this.spawnTimer = 42
    this.enemyProgress = 0
    this.shipState = 'dockedA'
    this.shuttleToB = true
    this.bHeartState = 'hidden'
    this.heartRise = 0
    this.bHeartMesh.visible = true
    this.bHeartMesh.scale.setScalar(0.01)
    this.bHeartMesh.position.copy(this.center).addScaledVector(this.ringBDir, this.surfaceRadius(this.ringBDir) - 2.4)
    this.bBeamMat.color.set('#C86BFA')
    for (const t of [this.turretA, ...this.turretsB]) {
      t.dead = false
      t.hp = t.maxHp
      t.group.scale.setScalar(1)
      t.cooldown = 0
    }
    for (const s of this.sappers) s.sieging = true
  }

  /** Unit up at the shuttle's park spot on whichever world it sits. */
  parkUp(out: THREE.Vector3) {
    out.copy(this.shipState === 'dockedB' ? this.bParkDir : this.aParkDir)
    return out
  }

  /** Where the shuttle sits right now (its group position). */
  get shuttlePos() {
    return this.shuttle.group.position
  }

  /** Lift off toward the other world. Returns the flight duration. */
  launch(): number {
    if (this.shipState !== 'dockedA' && this.shipState !== 'dockedB') return 0
    const toB = this.shipState === 'dockedA'
    this.shuttleToB = toB
    const from = this.shuttle.group.position.clone()
    const upFrom = from.clone().sub(toB ? new THREE.Vector3() : this.center).normalize()
    const to = toB
      ? this.center.clone().addScaledVector(this.bParkDir, this.surfaceRadius(this.bParkDir))
      : this.aParkDir.clone().multiplyScalar(groundRadius(this.aParkDir, PHYSICS.radius + 4))
    const upTo = to.clone().sub(toB ? this.center : new THREE.Vector3()).normalize()
    const mid = from.clone().add(to).multiplyScalar(0.5)
    const lift = from.distanceTo(to) * 0.14 + 18
    const ctrl = mid.addScaledVector(upFrom, lift).addScaledVector(upTo, lift)
    this.shuttle.from = from
    this.shuttle.to = to
    this.shuttle.ctrl = ctrl
    this.shuttle.t = 0
    this.shuttle.dur = from.distanceTo(to) / SHUTTLE_SPEED
    this.shuttle.released = true
    this.shipState = 'flying'
    this.audio.equip()
    return this.shuttle.dur
  }

  /** Aim the frozen player's seat: call each frame while flying. */
  seatUp(out: THREE.Vector3) {
    // The rocket flies nose-first along -Z, so the seat's up is its -Z.
    this.shuttle.group.getWorldDirection(out).multiplyScalar(-1)
  }

  update(dt: number, ctx: WarCtx) {
    this.time += dt
    this.updateShuttle(dt)
    this.updateTransports(dt, ctx)
    this.updateSappers(dt, ctx)
    this.updateTurrets(dt, ctx)
    this.updateHearts(dt)
  }

  private updateShuttle(dt: number) {
    const s = this.shuttle
    if (this.shipState !== 'flying') return
    s.t = Math.min(1, s.t + dt / s.dur)
    bezier(s.from, s.ctrl, s.to, s.t, s.group.position)
    _v.copy(s.ctrl).sub(s.from).multiplyScalar(2 * (1 - s.t))
      .add(_v2.copy(s.to).sub(s.ctrl).multiplyScalar(2 * s.t))
    if (_v.lengthSq() > 1e-6) {
      _v.normalize()
      s.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _v)
    }
    if (s.t >= 1) {
      this.shipState = s.to.distanceTo(this.center) < this.radius * 2 ? 'dockedB' : 'dockedA'
      const up = s.group.position.clone().sub(this.shipState === 'dockedB' ? this.center : new THREE.Vector3()).normalize()
      s.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
      this.audio.capture()
    }
  }

  private updateTransports(dt: number, ctx: WarCtx) {
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0 && this.transports.filter((s) => !s.dead).length < 2) {
      this.spawnTimer = 38
      this.launchTransport()
    }
    for (let i = this.transports.length - 1; i >= 0; i--) {
      const s = this.transports[i]
      if (s.dead) {
        s.deadT += dt
        s.group.position.y -= 9 * dt
        s.group.rotation.z += dt * 2.4
        if (s.deadT > 2.2) {
          this.hostiles.remove(s.group)
          this.transports.splice(i, 1)
        }
        continue
      }
      s.t = Math.min(1, s.t + dt / s.dur)
      bezier(s.from, s.ctrl, s.to, s.t, s.group.position)
      _v.copy(s.ctrl).sub(s.from).multiplyScalar(2 * (1 - s.t))
        .add(_v2.copy(s.to).sub(s.ctrl).multiplyScalar(2 * s.t))
      if (_v.lengthSq() > 1e-6) s.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _v.normalize())
      if (!s.released && s.t >= 1) {
        s.released = true
        this.dropSapper(s.to)
        // Turn around: head home along the same arc, reversed.
        const from = s.to
        const to = s.from
        s.from = from
        s.to = to
        s.ctrl.copy(from).add(to).multiplyScalar(0.5).setLength(from.distanceTo(to) * 0.3 + 24)
        s.t = 0
      } else if (s.released && s.t >= 1) {
        this.hostiles.remove(s.group)
        this.transports.splice(i, 1)
      }
    }
    void ctx
  }

  private launchTransport() {
    const parkLocal = this.ringBDir.clone().addScaledVector(_v.set(0.31, 0.81, 0).cross(this.ringBDir).normalize(), -0.14).normalize()
    const from = this.center.clone().addScaledVector(parkLocal, this.surfaceRadius(parkLocal) + 2)
    const landLocal = this.padADir.clone().addScaledVector(_v2.set(0.2, 0.4, 0.9).cross(this.padADir).normalize(), -0.1).normalize()
    const to = landLocal.multiplyScalar(groundRadius(landLocal, PHYSICS.radius + 6) + 0.4)
    const mid = from.clone().add(to).multiplyScalar(0.5)
    const lift = from.distanceTo(to) * 0.12 + 16
    const ctrl = mid.addScaledVector(from.clone().sub(this.center).normalize(), lift)
      .addScaledVector(to.clone().normalize(), lift)
    const ship: Ship = {
      group: buildRocket(true), enemy: true, hp: TRANSPORT_HP,
      from, to, ctrl, t: 0, dur: from.distanceTo(to) / TRANSPORT_SPEED,
      released: false, dead: false, deadT: 0,
    }
    ship.group.traverse((o) => {
      o.userData.war = 'ship'
      o.userData.ref = ship
    })
    this.hostiles.add(ship.group)
    this.transports.push(ship)
  }

  private dropSapper(at: THREE.Vector3) {
    if (this.sappers.length >= 3) return
    const group = new THREE.Group()
    const bodyMat = toon('#6B4E8F')
    const visor = toon('#8FE4C2')
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 6, 10), bodyMat)
    body.position.y = 0.62
    group.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), bodyMat)
    head.position.y = 1.22
    group.add(head)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), visor)
    eye.position.set(0, 1.24, -0.14)
    group.add(eye)
    group.traverse((o) => {
      o.userData.war = 'sapper'
      o.userData.ref = group
    })
    this.hostiles.add(group)
    const dir = at.clone().normalize()
    this.sappers.push({
      group, hp: SAPPER_HP, dir, r: at.length(),
      phase: Math.random() * 6, capturing: false, sieging: !this.turretA.dead, swing: 0,
    })
    this.fx.ring(at, dir, '#C86BFA', 2)
  }

  private updateSappers(dt: number, ctx: WarCtx) {
    for (let i = this.sappers.length - 1; i >= 0; i--) {
      const s = this.sappers[i]
      // Invasion plan: kill the home turret first, then stand in the ring.
      const sieging = s.sieging && !this.turretA.dead
      const turretEuclid = sieging ? s.group.position.distanceTo(this.turretA.group.position) : Infinity
      const atTurret = turretEuclid < 3.2
      let faceDir: THREE.Vector3
      if (atTurret) {
        // Whack the turret; when it falls, march on to the ring.
        s.swing += dt
        s.capturing = false
        this.turretA.hp -= 14 * dt
        faceDir = this.turretA.group.position.clone().sub(s.group.position)
        if (s.swing > 0.9) {
          s.swing = 0
          this.fx.burst(this.turretA.group.position.clone().addScaledVector(faceDir.clone().normalize(), -1.2), 4, { colors: [COLORS.lemon, COLORS.white], speed: 3, size: 0.06, life: 0.25, up: s.dir })
        }
        if (this.turretA.hp <= 0) {
          this.turretA.dead = true
          this.turretA.group.scale.setScalar(0.25)
          this.audio.shoot('boom')
          this.fx.burst(this.turretA.group.position, 22, { colors: [COLORS.gold, '#FF7A5C'], speed: 7, size: 0.12, life: 0.5, up: this.turretA.group.position.clone().normalize() })
        }
      } else {
        const goalDir = sieging ? this.turretA.group.position.clone().normalize() : this.padADir
        const ringDist = s.dir.angleTo(this.padADir) * PHYSICS.radius
        if (!sieging && ringDist < 3) {
          s.capturing = true
          ctx.enemyCapture(dt / ENEMY_CAPTURE_TIME)
          faceDir = this.padADir.clone().addScaledVector(s.dir, -this.padADir.dot(s.dir))
        } else {
          // Waddle toward the goal along the great circle.
          s.capturing = false
          _v.copy(goalDir).addScaledVector(s.dir, -s.dir.dot(goalDir))
          if (_v.lengthSq() > 1e-8) {
            _v.normalize()
            s.dir.addScaledVector(_v, (SAPPER_SPEED * dt) / PHYSICS.radius).normalize()
          }
          s.r = groundRadius(s.dir, s.r + 1)
          faceDir = _v.clone()
          void goalDir
        }
      }
      s.group.position.copy(s.dir).multiplyScalar(s.r)
      if (faceDir && faceDir.lengthSq() > 1e-6) s.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), faceDir.normalize())
      s.phase += dt * 9
      s.group.rotation.x = Math.sin(s.phase) * 0.09
      s.group.position.addScaledVector(s.dir, 0.02)
    }
  }

  private updateTurrets(dt: number, ctx: WarCtx) {
    this.updateTurret(this.turretA, dt, () => {
      // Home turret: shoot transports first, sappers second.
      let best: THREE.Vector3 | null = null
      let bestScore = Infinity
      for (const s of this.transports) {
        if (s.dead) continue
        const d = s.group.position.distanceTo(this.turretA.group.position)
        if (d < this.turretA.range && d < bestScore) { bestScore = d; best = s.group.position }
      }
      if (!best) {
        for (const sap of this.sappers) {
          const d = sap.group.position.distanceTo(this.turretA.group.position)
          if (d < this.turretA.range && d < bestScore) { bestScore = d; best = sap.group.position.clone().addScaledVector(sap.dir, 0.7) }
        }
      }
      return best
    }, (target) => {
      // 26 damage chunks: apply to whatever is at that point.
      for (const s of this.transports) {
        if (!s.dead && s.group.position.distanceTo(target) < 3.5) { this.damageShip(s, this.turretA.damage); return }
      }
      for (const sap of this.sappers) {
        if (sap.group.position.distanceTo(target) < 2) { this.damageSapper(sap, this.turretA.damage); return }
      }
    })

    const playerClose = ctx.playerAlive && ctx.playerPos.distanceTo(this.center) < this.radius + 34
    for (const t of this.turretsB) {
      this.updateTurret(t, dt, () => {
        if (!playerClose) return null
        const d = ctx.playerPos.distanceTo(t.group.position)
        return d < t.range ? ctx.playerPos : null
      }, (target) => {
        ctx.hurtPlayer(1, target)
      })
    }
  }

  private updateTurret(t: Turret, dt: number, findTarget: () => THREE.Vector3 | null, fire: (target: THREE.Vector3) => void) {
    if (t.dead) return
    t.cooldown -= dt
    const target = findTarget()
    if (!target) return
    // Track the target with the head, then fire on the beat.
    _v.copy(target).sub(t.group.position)
    const local = t.group.worldToLocal(_v.clone())
    _v2.copy(local).sub(t.head.position)
    const yaw = Math.atan2(-_v2.x, -_v2.z)
    t.head.rotation.y += THREE.MathUtils.clamp(yaw - t.head.rotation.y, -3 * dt, 3 * dt)
    const pitch = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z))
    t.head.rotation.x = THREE.MathUtils.clamp(-pitch, -0.5, 0.5)
    if (t.cooldown <= 0) {
      t.cooldown = t.period
      t.barrelTip.getWorldPosition(_v)
      this.fx.tracer(_v.clone(), target.clone(), t.onB ? '#FF7A5C' : '#8ED8FF')
      this.fx.flash(_v.clone(), t.onB ? '#FF7A5C' : '#8ED8FF', 0.6)
      fire(target)
    }
  }

  private toastDestroyedTurret() {
    // Game shows the toast; the burst here is the celebration.
  }

  hitTarget(kind: string, ref: unknown, dmg: number, point: THREE.Vector3): 'dead' | 'hit' | null {
    if (kind === 'ship') {
      const s = ref as Ship
      if (s.dead) return null
      this.fx.burst(point, 6, { colors: [COLORS.lemon, COLORS.white], speed: 4, size: 0.07, life: 0.3, up: point.clone().normalize() })
      s.hp -= dmg
      if (s.hp <= 0) {
        s.dead = true
        s.deadT = 0
        this.audio.shoot('boom')
        this.fx.burst(s.group.position, 26, { colors: [COLORS.gold, '#FF7A5C', COLORS.white], speed: 8, size: 0.14, life: 0.6, up: s.group.position.clone().normalize() })
        this.fx.flash(s.group.position, COLORS.gold, 1.6)
        return 'dead'
      }
      return 'hit'
    }
    if (kind === 'sapper') {
      const sap = this.sappers.find((s) => s.group === ref)
      if (!sap) return null
      this.damageSapper(sap, dmg)
      return 'hit'
    }
    if (kind === 'turret') {
      const t = this.turretsB.find((tt) => tt === ref)
      if (!t || t.dead) return null
      t.hp -= dmg
      this.fx.burst(point, 5, { colors: [COLORS.lemon, COLORS.white], speed: 4, size: 0.07, life: 0.3, up: point.clone().sub(this.center).normalize() })
      if (t.hp <= 0) {
        t.dead = true
        t.group.scale.setScalar(0.25)
        this.audio.shoot('boom')
        this.fx.burst(t.group.position.clone().addScaledVector(point.clone().sub(this.center).normalize(), 2), 20, { colors: [COLORS.gold, '#FF7A5C'], speed: 7, size: 0.12, life: 0.5, up: point.clone().sub(this.center).normalize() })
        this.toastDestroyedTurret()
        return 'dead'
      }
      return 'hit'
    }
    return null
  }

  private toastDestroyedTurret() {
    // Game shows the toast through the audio sting; visual burst is enough.
  }

  private damageShip(s: Ship, dmg: number) {
    s.hp -= dmg
    if (s.hp <= 0 && !s.dead) {
      s.dead = true
      s.deadT = 0
      this.audio.shoot('boom')
      this.fx.burst(s.group.position, 26, { colors: [COLORS.gold, '#FF7A5C', COLORS.white], speed: 8, size: 0.14, life: 0.6, up: s.group.position.clone().normalize() })
    }
  }

  private damageSapper(sap: Sapper, dmg: number) {
    sap.hp -= dmg
    this.fx.burst(sap.group.position.clone().addScaledVector(sap.dir, 0.7), 6, { colors: [COLORS.lemon, COLORS.white], speed: 4, size: 0.07, life: 0.3, up: sap.dir })
    if (sap.hp <= 0) {
      this.hostiles.remove(sap.group)
      this.sappers.splice(this.sappers.indexOf(sap), 1)
      this.audio.hit(false)
    }
  }

  private updateHearts(dt: number) {
    this.aHeart.rotation.y += dt * 0.8
    // Enemy capture decay when no sapper is standing in the ring.
    if (this.sappers.length === 0 || !this.sappers.some((s) => s.capturing)) {
      this.enemyProgress = Math.max(0, this.enemyProgress - dt * 0.012)
    }
    if (this.bHeartState === 'risen') {
      this.heartRise = Math.min(1, this.heartRise + dt / 2)
      const up = this.ringBDir
      const ringPos = this.center.clone().addScaledVector(up, this.surfaceRadius(up))
      // Rise to a touchable height just above the ring floor.
      this.bHeartMesh.position.copy(ringPos).addScaledVector(up, -2.4 + this.heartRise * 3.4)
      this.bHeartMesh.rotation.y += dt * 1.1
      const s = 0.01 + this.heartRise * 0.99
      this.bHeartMesh.scale.setScalar(s)
    }
  }

  /** Stand in the enemy ring long enough and the heart rises. Returns progress. */
  captureB(dt: number, playerPos: THREE.Vector3): number {
    const ringPos = this.center.clone().addScaledVector(this.ringBDir, this.surfaceRadius(this.ringBDir))
    const inRing = playerPos.distanceTo(ringPos) < 3.6
    if (inRing && this.bHeartState === 'hidden') {
      this.heartRise = Math.min(1, this.heartRise + dt / 6)
      if (this.heartRise >= 1) {
        this.bHeartState = 'risen'
        this.bBeamMat.color.set(COLORS.gold)
        this.audio.capture()
      }
    } else if (this.bHeartState === 'hidden') {
      this.heartRise = Math.max(0, this.heartRise - dt * 0.1)
    }
    return this.heartRise
  }

  /** Take the risen heart: the winning touch. */
  tryTakeHeart(playerPos: THREE.Vector3): boolean {
    if (this.bHeartState !== 'risen') return false
    if (playerPos.distanceTo(this.bHeartMesh.position) < 1.9) {
      this.bHeartState = 'taken'
      this.bHeartMesh.visible = false
      this.fx.burst(this.bHeartMesh.position, 30, { colors: [COLORS.gold, COLORS.lemon, COLORS.white], speed: 7, size: 0.12, life: 0.7, up: this.ringBDir })
      return true
    }
    return false
  }

  /** The planet mesh, so bullets that miss everything still stop on B. */
  get terrain() {
    return this.planetMesh
  }
}
