import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS, PHYSICS } from '../config'
import { flagTexture, gradientMap, outlined, radialTexture, signTexture, softGradientMap, toon } from './toon'
import { seeded, type Obstacle } from './props'
import { buildCoverSet, type CoverAsset, type CoverKind } from './cover'
import { buildHouseSet, lampPost, plaza, type HouseAsset } from './houses'
import { ENEMY_SPAWNS, PAD_SPAWNS, SPAWN_LATLON } from './landmarks'

const R = PHYSICS.radius
const Y = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)
const _n = new THREE.Vector3()
const _jitter = new THREE.Vector3()
const _dig = new THREE.Vector3()
const _col = new THREE.Color()
const _aimN = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _aim = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _vA = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _vC = new THREE.Vector3()
const _vD = new THREE.Vector3()
const SOIL = new THREE.Color('#B07C55')
const SOIL_DEEP = new THREE.Color('#7C5138')

export function dirFromLatLon(latDeg: number, lonDeg: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const c = Math.cos(lat)
  return new THREE.Vector3(Math.cos(lon) * c, Math.sin(lat), Math.sin(lon) * c)
}

/** Rolling planet surface before anyone has touched a shovel. */
export function plainRadius(dir: THREE.Vector3): number {
  _n.copy(dir).normalize()
  const n =
    Math.sin(_n.x * 8 + _n.z * 5.2) * 3.0 +
    Math.sin(_n.y * 11 + _n.x * 3.4) * 1.5 +
    Math.sin((_n.x + _n.z) * 19 + _n.y * 7) * 0.62 +
    Math.sin((_n.x + _n.y + _n.z) * 38) * 0.2 +
    Math.sin(_n.z * 61 - _n.y * 43) * 0.07
  return R + 3.4 + n
}

/* --------------------------------------------------------------- digging */

export type DigHole = {
  /** Unit direction of the pit centre. */
  dir: THREE.Vector3
  /** Cup radius in metres measured along the surface. */
  radius: number
  /** How far the floor sits below the untouched surface. */
  depth: number
}

/** One scoop of the shovel, in metres. */
export const DIG_STEP = 0.62
/** Past this the planet would be a shell, not a ball. */
export const DIG_MAX = 11

const DIGS: DigHole[] = []
/** Pits beyond this are forgotten so the analytic surface stays cheap. */
const DIG_LIMIT = 32

export function digHoles(): readonly DigHole[] {
  return DIGS
}

export function clearDigs() {
  DIGS.length = 0
}

const smoothstep = (t: number) => {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Depth removed at `dir` by every pit, deepest wins so overlaps stay flat. */
export function digDrop(dir: THREE.Vector3): number {
  let drop = 0
  for (const hole of DIGS) {
    if (hole.depth <= drop) continue
    const dot = THREE.MathUtils.clamp(dir.dot(hole.dir), -1, 1)
    if (dot < 0.2) continue
    const arc = Math.acos(dot) * R
    if (arc >= hole.radius) continue
    const t = 1 - arc / hole.radius
    const f = smoothstep((t - 0.08) / 0.42)
    const d = f * hole.depth
    if (d > drop) drop = d
  }
  return drop
}

/**
 * Soil thrown out of the pit. Digging is not subtractive on its own: every
 * shovelful has to go somewhere, so the spoil piles up in a ring just outside
 * the rim. Tallest allowed is capped, because the mound is decoration — the
 * pit is the part that matters for gameplay.
 */
const MOUND_MAX = 1.15
export function digMound(dir: THREE.Vector3): number {
  let rise = 0
  for (const hole of DIGS) {
    const dot = THREE.MathUtils.clamp(dir.dot(hole.dir), -1, 1)
    if (dot < 0.2) continue
    const k = (Math.acos(dot) * R) / Math.max(0.5, hole.radius)
    if (k < 0.84 || k > 2.05) continue
    // Starts inside the lip so the spoil covers it, crests at 1.35, and is back
    // down to grass by 2.3.
    const up = smoothstep((k - 0.84) / 0.26)
    const down = 1 - smoothstep((k - 1.3) / 0.75)
    const h = up * down * Math.min(MOUND_MAX, hole.depth * 0.17)
    if (h > rise) rise = h
  }
  return rise
}

/** Analytic walking surface — the same function used to displace the mesh. */
export function surfaceRadius(dir: THREE.Vector3): number {
  const base = plainRadius(dir)
  return DIGS.length === 0 ? base : base - digDrop(dir) + digMound(dir)
}

/**
 * Shovel at `dir`. Returns the pit that now owns that spot, so the world can
 * resculpt the mesh around it.
 */
export function digAt(dir: THREE.Vector3): DigHole {
  const target = dir.clone().normalize()
  // Grow the crater you are already standing in. Stamping a second bowl on top
  // of the first leaves a lumpy double-rim that reads as a bug, not a hole.
  let host: DigHole | null = null
  let bestArc = Infinity
  for (const hole of DIGS) {
    const arc = hole.dir.angleTo(target) * R
    if (arc > hole.radius * 1.05 || arc >= bestArc) continue
    bestArc = arc
    host = hole
  }
  if (host) {
    host.dir.lerp(target, 0.22).normalize()
    host.depth = Math.min(DIG_MAX, Math.max(host.depth, digDrop(target)) + DIG_STEP)
    host.radius = Math.min(5.2, 1.7 + host.depth * 0.26)
    return host
  }
  const depth = Math.min(DIG_MAX, digDrop(target) + DIG_STEP)
  const hole: DigHole = { dir: target, radius: Math.min(5.2, 1.7 + depth * 0.26), depth }
  DIGS.push(hole)
  while (DIGS.length > DIG_LIMIT) DIGS.shift()
  return hole
}

/** Analytic surface normal, so props stand flat on hills instead of the radial. */
export function surfaceNormal(dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : Y
  const t1 = new THREE.Vector3().crossVectors(up, dir).normalize()
  const t2 = new THREE.Vector3().crossVectors(dir, t1).normalize()
  const eps = 0.0025
  const p0 = dir.clone().multiplyScalar(surfaceRadius(dir))
  const d1 = dir.clone().addScaledVector(t1, eps).normalize()
  const d2 = dir.clone().addScaledVector(t2, eps).normalize()
  const p1 = d1.clone().multiplyScalar(surfaceRadius(d1))
  const p2 = d2.clone().multiplyScalar(surfaceRadius(d2))
  out.crossVectors(p1.clone().sub(p0), p2.clone().sub(p0)).normalize()
  if (out.dot(dir) < 0) out.negate()
  return out
}

// Pastel by design: the toon ramp already multiplies these down, so saturated
// hues read as neon soup on the far side of the planet.
const MEADOW = new THREE.Color('#8FE4C2')
const ICE = new THREE.Color('#D6EEFF')
const SAND = new THREE.Color('#FFEBC2')
const JELLY = new THREE.Color('#F5CBE8')
const CREAM = new THREE.Color('#FFF3DC')

/** Biomes are round seas, not latitude bands — bands made it look like a gas giant. */
type Sea = { dir: THREE.Vector3; color: THREE.Color; radius: number; weight: number; sign: 1 | -1 }
const SEAS: Sea[] = [
  { dir: dirFromLatLon(-18, 104), color: JELLY, radius: 0.78, weight: 0.9, sign: -1 },
  { dir: dirFromLatLon(26, -132), color: JELLY, radius: 0.62, weight: 0.8, sign: -1 },
  { dir: dirFromLatLon(-34, -46), color: SAND, radius: 0.86, weight: 0.85, sign: -1 },
  { dir: dirFromLatLon(18, 34), color: SAND, radius: 0.6, weight: 0.7, sign: -1 },
  { dir: dirFromLatLon(-6, 176), color: CREAM, radius: 0.55, weight: 0.6, sign: -1 },
]

/**
 * How deep to bed a prop so a tilted base does not hang in the air on a slope.
 * Uses less than the full downhill drop so the uphill edge stays visible.
 */
export function bedding(up: THREE.Vector3, dir: THREE.Vector3, footprint: number): number {
  const tilt = Math.acos(THREE.MathUtils.clamp(up.dot(dir), -1, 1))
  return Math.min(footprint * Math.tan(Math.min(tilt, 0.62)) * 0.55, footprint * 0.9)
}

const smooth = (t: number) => {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

const _hslA = { h: 0, s: 0, l: 0 }
const _hslB = { h: 0, s: 0, l: 0 }
const _mix = new THREE.Color()

/**
 * Blend two colours in HSL while choosing which way around the hue wheel to
 * travel. `THREE.Color.lerpHSL` always takes the shortest arc, which for
 * mint -> pink dives through cyan and blue and turns the whole meadow navy.
 * Candy biomes read much better taking the long, warm way round.
 */
function blendHue(a: THREE.Color, b: THREE.Color, t: number, dir: 1 | -1, out: THREE.Color) {
  if (t <= 0) return out.copy(a)
  if (t >= 1) return out.copy(b)
  a.getHSL(_hslA, THREE.SRGBColorSpace)
  b.getHSL(_hslB, THREE.SRGBColorSpace)
  let d = _hslB.h - _hslA.h
  if (dir > 0) {
    while (d < 0) d += 1
    while (d > 1) d -= 1
  } else {
    while (d > 0) d -= 1
    while (d < -1) d += 1
  }
  const h = ((_hslA.h + d * t) % 1 + 1) % 1
  return out.setHSL(h, _hslA.s + (_hslB.s - _hslA.s) * t, _hslA.l + (_hslB.l - _hslA.l) * t, THREE.SRGBColorSpace)
}

function zoneColor(dir: THREE.Vector3, out: THREE.Color) {
  const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
  const lon = Math.atan2(dir.z, dir.x)
  // Wobble every biome edge so the seas look painted on, not stencilled.
  const wob =
    Math.sin(lon * 3.1 + lat * 4.7) * 0.5 +
    Math.sin(lon * 6.3 - lat * 3.9) * 0.3 +
    Math.sin(lat * 9.7) * 0.2
  const relief = plainRadius(dir) - (R + 3.4)

  out.copy(MEADOW)
  for (const sea of SEAS) {
    const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(sea.dir), -1, 1))
    const w = smooth((sea.radius + wob * 0.14 - ang) / 0.34) * sea.weight
    if (w <= 0.001) continue
    blendHue(out, sea.color, w, sea.sign, _mix)
    out.copy(_mix)
  }

  // Snow: polar caps plus anything high enough to be a hilltop.
  const polar = smooth((Math.abs(lat) - 0.58) / 0.3)
  const peaks = smooth((relief - 3.2) / 2.2)
  const snow = Math.max(polar * 0.8, peaks * 0.9)
  if (snow > 0.002) {
    blendHue(out, ICE, snow, 1, _mix)
    out.copy(_mix)
    out.offsetHSL(0, -snow * 0.25, snow * 0.04)
  }

  // Basins pick up a sandy tint so hollows read as hollows.
  const basin = smooth((-relief - 3.4) / 2.2) * 0.4
  if (basin > 0.002) {
    blendHue(out, SAND, basin, -1, _mix)
    out.copy(_mix)
  }

  const blotch = Math.sin(lon * 9.5 + lat * 12.3) * Math.cos(lat * 8.5 - lon * 5.1)
  // A second, ~15 m band gives the ground a hand-painted patchwork instead of
  // one continuous wash at walking distance.
  const patch = Math.sin(lon * 26 + lat * 31) * Math.cos(lat * 23 - lon * 17)
  out.offsetHSL(
    blotch * 0.02 + patch * 0.016,
    0.02 + blotch * 0.07 + patch * 0.05,
    relief * 0.016 + blotch * 0.022 + patch * 0.02,
  )
}

export type CapturePad = {
  dir: THREE.Vector3
  group: THREE.Group
  ringMat: THREE.MeshBasicMaterial
  flagMat: THREE.MeshToonMaterial
  beam: THREE.Mesh
  beamMat: THREE.MeshBasicMaterial
  progress: number
  captured: boolean
}

/** A dug pit: the hole data plus the high-res shell drawn over the coarse planet. */
type PIT = { hole: DigHole; mesh: THREE.Mesh }

type Spinner = { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }
type Floater = { obj: THREE.Object3D; base: THREE.Vector3; axis: THREE.Vector3; amp: number; speed: number; phase: number }

export class World {
  planet: THREE.Mesh
  pads: CapturePad[] = []
  /** Solid props the player bumps into and bullets stop on. */
  obstacles: Obstacle[] = []
  solids: THREE.Object3D[] = []
  propsReady = false
  /** One high-res patch per pit, riding on top of the coarse planet shell. */
  pits: PIT[] = []
  private scene: THREE.Scene
  private propLoad: Promise<void> | null = null
  private spinners: Spinner[] = []
  private floaters: Floater[] = []
  private sky: THREE.Group
  private time = 0
  /** Unit direction of every planet vertex, kept for resculpting after a dig. */
  private groundDirs = new Float32Array(0)
  private detail: { mesh: THREE.InstancedMesh; dirs: Float32Array; used: number; original: Float32Array }[] = []
  private mats: Record<string, THREE.MeshToonMaterial>
  private pitMat: THREE.MeshToonMaterial | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.mats = {
      mint: toon(COLORS.mint),
      candy: toon(COLORS.candy),
      lemon: toon(COLORS.lemon),
      sky: toon(COLORS.sky),
      white: toon(COLORS.white),
      purple: toon(COLORS.shadow),
      wood: toon('#C98B6B'),
      choco: toon('#9A5B62'),
      leaf: toon('#63C99B'),
      gold: toon(COLORS.gold),
      plum: toon(COLORS.plum),
    }

    this.planet = this.buildPlanet()
    scene.add(this.planet)

    const props = new THREE.Group()
    this.addMeadow(props)
    this.addDesert(props)
    this.addIce(props)
    this.addJelly(props)
    this.addLandmarks(props)
    scene.add(props)
    this.addGroundDetail(scene)

    this.addPads(scene)

    this.sky = this.buildSky()
    scene.add(this.sky)
  }

  /** Scatter CC0 Kenney props for cover. Keeps spawn, pads and enemies clear. */
  loadProps() {
    if (this.propLoad) return this.propLoad
    this.propLoad = (async () => {
      const rng = seeded(20260601)
      const assets = buildCoverSet(rng)
      const spawn = dirFromLatLon(SPAWN_LATLON[0], SPAWN_LATLON[1])
      const pads = PAD_SPAWNS.map(([lat, lon]) => dirFromLatLon(lat, lon))
      const enemies = ENEMY_SPAWNS.map(([lat, lon]) => dirFromLatLon(lat, lon))
      const t1 = new THREE.Vector3().crossVectors(Y, spawn).normalize()
      const t2 = new THREE.Vector3().crossVectors(spawn, t1).normalize()
      const group = new THREE.Group()
      group.name = 'cover'
      const placed: { dir: THREE.Vector3; radius: number }[] = []
      const normal = new THREE.Vector3()

      // Deliberate cover near the landing site: real wall lines, crate stacks and columns.
      // Everything is laid out in metres on the local tangent plane around the spawn.
      const east = new THREE.Vector3().crossVectors(spawn, Y).normalize()
      const north = new THREE.Vector3().crossVectors(east, spawn).normalize()
      const at = (e: number, n: number) =>
        spawn.clone().addScaledVector(east, e / R).addScaledVector(north, n / R).normalize()

      const attach = (
        asset: CoverAsset,
        kind: CoverKind | 'house',
        dir: THREE.Vector3,
        scale: number,
        along?: THREE.Vector3,
        longAxis: 'x' | 'z' = 'z',
        lift = 0,
        collide = true,
      ) => {
        const outer = new THREE.Group()
        outer.position.copy(dir).multiplyScalar(surfaceRadius(dir))
        const up = surfaceNormal(dir, new THREE.Vector3())
        const forward = (along ?? east).clone().projectOnPlane(up)
        if (forward.lengthSq() < 1e-5) forward.copy(north)
        forward.normalize()
        if (longAxis === 'z') {
          const side = new THREE.Vector3().crossVectors(up, forward).normalize()
          outer.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, forward))
        } else {
          const side = new THREE.Vector3().crossVectors(forward, up).normalize()
          outer.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, side))
        }
        const model = asset.scene.clone(true)
        model.scale.setScalar(scale)
        model.position.y += lift - 0.03 - bedding(up, dir, asset.footprint * scale)
        outer.add(model)
        group.add(outer)
        if (!collide) return outer
        this.solids.push(outer)

        const height = asset.height * scale * 0.9
        if (kind === 'wall' || kind === 'barricade') {
          // Long thin walls get three circles so you cannot walk through the ends.
          const half = asset.footprint * scale * 0.85
          const axis = (longAxis === 'z' ? forward : forward).clone()
          for (const k of [-1, 0, 1]) {
            const a = (k * half) / R
            const cdir = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(axis, Math.sin(a)).normalize()
            this.obstacles.push({ dir: cdir, radius: 0.5, height })
          }
        } else {
          this.obstacles.push({ dir: dir.clone(), radius: asset.footprint * scale * 0.9 + 0.12, height })
        }
        return outer
      }

      // ---- village + farm houses ------------------------------------------
      const houses = buildHouseSet(rng)
      const clearOf = (dir: THREE.Vector3, radius: number) =>
        !pads.some((pad) => dir.angleTo(pad) * R < 9 + radius) &&
        !enemies.some((e) => dir.angleTo(e) * R < 5 + radius)

      const facingCentre = (dir: THREE.Vector3, centre: THREE.Vector3, up: THREE.Vector3) => {
        const out = centre.clone().multiplyScalar(R).sub(dir.clone().multiplyScalar(R))
        out.projectOnPlane(up)
        return out.lengthSq() > 1e-4 ? out.normalize() : east.clone()
      }

      const centre = at(31, -2)
      const centreUp = surfaceNormal(centre, new THREE.Vector3())

      // the little cobbled square, laid flat on the surface at its centre
      const squareAsset = plaza(rng, 3.7)
      const squareOuter = new THREE.Group()
      squareOuter.position.copy(centre).multiplyScalar(surfaceRadius(centre))
      squareOuter.quaternion.setFromUnitVectors(Y, centreUp)
      const squareModel = squareAsset.scene.clone(true)
      squareModel.position.y += 0.01
      squareOuter.add(squareModel)
      squareOuter.name = 'plaza'
      group.add(squareOuter)

      const lamp = attach(lampPost(), 'house', centre, 1, east, 'z', 0, true)
      lamp.name = 'lamp'

      // ring of houses around the square, doors facing in
      const ring: [number, number, number][] = [
        [14.6, 205, 1],
        [15.4, 250, 2],
        [14.4, 300, 0],
        [15.6, 345, 3],
        [14.8, 40, 5],
        [15.8, 95, 4],
      ]
      const houseScale = 1.08
      ring.forEach(([dist, deg, variant], i) => {
        const a = (deg * Math.PI) / 180
        const dir = centre
          .clone()
          .multiplyScalar(Math.cos(dist / R))
          .addScaledVector(east, Math.sin(dist / R) * Math.cos(a))
          .addScaledVector(north, Math.sin(dist / R) * Math.sin(a))
          .normalize()
        const asset = houses[variant % houses.length]
        const radius = asset.footprint * houseScale + 1.6
        if (!clearOf(dir, radius)) return
        if (placed.some((p) => dir.angleTo(p.dir) * R < p.radius + radius + 0.8)) return
        const up = surfaceNormal(dir, new THREE.Vector3())
        attach(asset, 'house', dir, houseScale, facingCentre(dir, centre, up), 'z').name = 'house'
        placed.push({ dir: dir.clone(), radius })
      })

      // a couple of outlying cottages + farms so the planet is not empty
      const scattered: [number, number, number][] = [
        [18, -74, 1],
        [58, -22, 0],
        [-34, -64, 3],
        [-52, 24, 2],
        [12, 62, 5],
        [72, 44, 6],
        [-14, 108, 4],
      ]
      for (const [lat, lon, variant] of scattered) {
        const dir = dirFromLatLon(lat, lon)
        const asset = houses[variant % houses.length]
        const radius = asset.footprint * 1.1 + 1.6
        if (!clearOf(dir, radius)) continue
        const up = surfaceNormal(dir, new THREE.Vector3())
        const face = new THREE.Vector3().crossVectors(dir, Y).normalize()
        attach(asset, 'house', dir, 1.1, face, 'z').name = 'house'
        placed.push({ dir: dir.clone(), radius })
        if (rng() < 0.7) {
          const off = face.clone().multiplyScalar((radius + 4) / R)
          const barn = dir.clone().multiplyScalar(Math.cos(off.length())).addScaledVector(off.clone().normalize(), Math.sin(off.length())).normalize()
          if (clearOf(barn, 3)) attach(houses[6 + (variant % 3)], 'house', barn, 0.9, face, 'z').name = 'house'
        }
      }


      const kinds: [CoverKind, number, number, number][] = [
        ['tree', 26, 0.9, 1.4],
        ['rock', 34, 1.0, 1.7],
        ['block', 12, 0.9, 1.3],
        ['wall', 16, 1.1, 1.5],
        ['column', 8, 0.9, 1.3],
        ['barricade', 14, 1.0, 1.4],
        ['bush', 24, 0.8, 1.3],
      ]

      const place = (kind: CoverKind, count: number, minScale: number, maxScale: number, near: boolean) => {
        const list = assets.get(kind) ?? []
        if (list.length === 0) return
        for (let i = 0; i < count; i++) {
          let dir = new THREE.Vector3()
          let asset = list[0]
          let scale = minScale
          let radius = 0.5
          let ok = false
          for (let attempt = 0; attempt < 48 && !ok; attempt++) {
            const angle = rng() * Math.PI * 2
            const distance = near ? 0.08 + 0.11 * Math.sqrt(rng()) : 0.03 + 0.56 * Math.sqrt(rng())
            dir.copy(spawn).multiplyScalar(Math.cos(distance))
              .addScaledVector(t1, Math.cos(angle) * Math.sin(distance))
              .addScaledVector(t2, Math.sin(angle) * Math.sin(distance))
              .normalize()
            scale = minScale + (maxScale - minScale) * rng()
            asset = list[(rng() * list.length) | 0]
            radius = asset.footprint * scale * 0.75
            if (dir.angleTo(spawn) * R < 4.2 + radius) continue
            if (pads.some((pad) => dir.angleTo(pad) * R < 5 + radius)) continue
            if (enemies.some((e) => dir.angleTo(e) * R < 3.5 + radius)) continue
            if (placed.some((p) => dir.angleTo(p.dir) * R < p.radius + radius + 0.9)) continue
            ok = true
          }
          if (!ok) continue

          const outer = new THREE.Group()
          outer.position.copy(dir).multiplyScalar(surfaceRadius(dir))
          surfaceNormal(dir, normal)
          outer.quaternion.setFromUnitVectors(Y, normal)
          const model = asset.scene.clone(true)
          model.scale.setScalar(scale)
          model.rotation.y = rng() * Math.PI * 2
          model.position.y -= 0.05 + bedding(normal, dir, asset.footprint * scale)
          outer.add(model)
          group.add(outer)
          placed.push({ dir: dir.clone(), radius })
          if (kind !== 'bush') {
            this.obstacles.push({ dir: dir.clone(), radius, height: asset.height * scale * 0.9 })
            this.solids.push(outer)
          }
        }
      }

      for (const [kind, count, minScale, maxScale] of kinds) place(kind, count, minScale, maxScale, false)
      // A tighter ring around the landing site: without it the opening shot is a
      // bare field because the wide scatter biases towards the far planet.
      const nearRing: [CoverKind, number, number, number][] = [
        ['tree', 2, 0.85, 1.15],
        ['rock', 3, 0.9, 1.4],
        ['block', 2, 0.85, 1.1],
        ['wall', 2, 1.0, 1.2],
        ['column', 1, 0.85, 1.0],
        ['barricade', 2, 0.95, 1.2],
        ['bush', 3, 0.8, 1.1],
      ]
      for (const [kind, count, minScale, maxScale] of nearRing) place(kind, count, minScale, maxScale, true)

      const wallLine = (e0: number, n0: number, e1: number, n1: number, scale: number) => {
        const wallAssets = assets.get('wall') ?? []
        if (wallAssets.length === 0) return
        const asset = wallAssets[0]
        const a = at(e0, n0)
        const b = at(e1, n1)
        const along = new THREE.Vector3().subVectors(b, a).normalize()
        const length = Math.hypot(e1 - e0, n1 - n0)
        const count = Math.max(1, Math.round(length / (asset.footprint * 2 * scale * 0.9)))
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count
          attach(asset, 'wall', at(e0 + (e1 - e0) * t, n0 + (n1 - n0) * t), scale, along, 'x')
        }
      }

      // Two chunky wall lines screen the landing site without blocking the arch view.
      wallLine(13, -18, 13, -2, 1.25)
      wallLine(-13, -13, -13, 5, 1.25)
      wallLine(-4, 21, 9, 21, 1.25)

      // Crate stacks to hop on and shoot over.
      const blocks = assets.get('block') ?? []
      if (blocks.length) {
        attach(blocks[0], 'block', at(7.4, 3.5), 1.15)
        attach(blocks[0], 'block', at(7.4, 4.5), 1.15)
        attach(blocks[1] ?? blocks[0], 'block', at(7.4, 4.0), 1.15, undefined, 'z', 0.99)
        attach(blocks[1] ?? blocks[0], 'block', at(-7, 10), 1.05)
        attach(blocks[0], 'block', at(-8.0, 10.9), 0.9)
      }

      // Columns flanking the rainbow arch.
      const columns = assets.get('column') ?? []
      if (columns.length) {
        attach(columns[0], 'column', at(3, 14), 1.15)
        attach(columns[1] ?? columns[0], 'column', at(15.5, 13), 1.05)
        attach(columns[0], 'column', at(-4, -20), 1.0)
      }

      const wallArc = (center: THREE.Vector3, radiusM: number, from: number, to: number, scale: number) => {
        const wallAssets = assets.get('wall') ?? []
        if (wallAssets.length === 0) return
        const asset = wallAssets[0]
        const te = new THREE.Vector3().crossVectors(center, Y).normalize()
        const tn = new THREE.Vector3().crossVectors(te, center).normalize()
        const span = (to - from) * (Math.PI / 180)
        const step = (asset.footprint * 2 * scale * 0.9) / radiusM
        const count = Math.max(2, Math.round(Math.abs(span) / step))
        for (let i = 0; i < count; i++) {
          const a = from * (Math.PI / 180) + (span * (i + 0.5)) / count
          const dir = center
            .clone()
            .multiplyScalar(Math.cos(radiusM / R))
            .addScaledVector(te, Math.sin(radiusM / R) * Math.cos(a))
            .addScaledVector(tn, Math.sin(radiusM / R) * Math.sin(a))
            .normalize()
          const along = new THREE.Vector3().crossVectors(te, tn).normalize()
          const tangent = tn.clone().multiplyScalar(-Math.sin(a)).addScaledVector(te, Math.cos(a)).normalize()
          attach(asset, 'wall', dir, scale, tangent.lengthSq() > 0.1 ? tangent : along, 'x')
        }
      }

      // Each capture point gets a low ruined wall on one side, so fights have cover.
      PAD_SPAWNS.forEach(([lat, lon], i) => {
        const center = dirFromLatLon(lat, lon)
        wallArc(center, 8.5, 215 + i * 45, 292 + i * 45, 1.1)
        const blocks2 = assets.get('block') ?? []
        if (blocks2.length) {
          const te = new THREE.Vector3().crossVectors(center, Y).normalize()
          const tn = new THREE.Vector3().crossVectors(te, center).normalize()
          for (let k = 0; k < 2; k++) {
            const a = (i * 1.7 + k * 0.5 + 0.4) * Math.PI
            const dir = center
              .clone()
              .multiplyScalar(Math.cos(5.6 / R))
              .addScaledVector(te, Math.sin(5.6 / R) * Math.cos(a))
              .addScaledVector(tn, Math.sin(5.6 / R) * Math.sin(a))
              .normalize()
            attach(blocks2[k % blocks2.length], 'block', dir, 0.95 + k * 0.15)
          }
        }
      })

      // Barricade row on the north approach to capture pad A.
      const barricades = assets.get('barricade') ?? []
      if (barricades.length) {
        for (let i = 0; i < 4; i++) {
          const dir = at(-16 + i * 3.1, 36)
          attach(barricades[i % barricades.length], 'barricade', dir, 1.1, east, 'x')
        }
      }

      this.scene.add(group)
      this.propsReady = true
    })()
    return this.propLoad
  }

  resetPads() {
    for (const pad of this.pads) {
      pad.progress = 0
      pad.captured = false
      pad.ringMat.color.set(COLORS.gold)
      pad.flagMat.color.set(COLORS.candy)
    }
  }

  private buildPlanet() {
    const geo = new THREE.IcosahedronGeometry(1, 64)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    this.groundDirs = new Float32Array(pos.count * 3)
    const dir = new THREE.Vector3()
    const color = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize()
      this.groundDirs[i * 3] = dir.x
      this.groundDirs[i * 3 + 1] = dir.y
      this.groundDirs[i * 3 + 2] = dir.z
      const radius = surfaceRadius(dir)
      pos.setXYZ(i, dir.x * radius, dir.y * radius, dir.z * radius)
      zoneColor(dir, color)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: gradientMap(),
    })
    const mesh = new THREE.Mesh(geo, material)
    mesh.name = 'planet'
    mesh.receiveShadow = true

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(R + 11, 32, 20),
      new THREE.MeshBasicMaterial({ color: COLORS.candy, transparent: true, opacity: 0.055, side: THREE.BackSide, depthWrite: false }),
    )
    mesh.add(glow)
    return mesh
  }

  /* ------------------------------------------------------------ digging */

  /** The pit whose floor contains `dir`, deepest first. */
  pitAt(dir: THREE.Vector3): DigHole | null {
    let best: DigHole | null = null
    for (const hole of digHoles()) {
      if (dir.angleTo(hole.dir) * R > hole.radius * 0.92) continue
      if (!best || hole.depth > best.depth) best = hole
    }
    return best
  }

  /** How much dirt sits in the pit at `dir` (0 = untouched grass). */
  depthAt(dir: THREE.Vector3): number {
    return digDrop(dir)
  }

  /**
   * Shovel one scoop at `dir`. The coarse sphere shell is pushed under the pit
   * and a high-res patch is laid on the analytic surface, so the hole keeps the
   * toy-clean low-poly look of the planet while still being metres deep.
   */
  dig(dir: THREE.Vector3): { depth: number; radius: number } {
    const hole = digAt(dir)
    this.sinkGround(hole)
    this.dropDetail(hole)
    this.pits = this.pits.filter((pit) => {
      if (digHoles().includes(pit.hole)) return true
      this.scene.remove(pit.mesh)
      pit.mesh.geometry.dispose()
      ;(pit.mesh.material as THREE.Material).dispose()
      return false
    })
    this.pushPit(hole)
    return { depth: hole.depth, radius: hole.radius }
  }

  /**
   * Flatten the coarse shell under the pit footprint. It is a fixed-detail
   * icosahedron, so it cannot follow a 5 m bowl: its long chords would rise
   * back up through the liner. Instead every vertex inside the liner gets
   * pushed well below the deepest point, and the liner alone is visible.
   */
  private sinkGround(hole: DigHole) {
    const geo = this.planet.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const dirs = this.groundDirs
    if (dirs.length !== pos.count * 3) return
    const cos = Math.cos((hole.radius * 1.45 + 0.6) / R)
    const floor = surfaceRadius(hole.dir) - 1.1
    const { x: hx, y: hy, z: hz } = hole.dir
    let touched = false
    for (let i = 0, n = pos.count; i < n; i++) {
      const x = dirs[i * 3]
      const y = dirs[i * 3 + 1]
      const z = dirs[i * 3 + 2]
      if (x * hx + y * hy + z * hz < cos) continue
      _dig.set(x, y, z)
      const r = Math.min(surfaceRadius(_dig) - 0.8, floor)
      arr[i * 3] = x * r
      arr[i * 3 + 1] = y * r
      arr[i * 3 + 2] = z * r
      touched = true
    }
    if (touched) pos.needsUpdate = true
  }

  /** Grass, flowers and pebbles that were standing where the pit now is. */
  private dropDetail(hole: DigHole) {
    const cos = Math.cos((hole.radius * 1.05) / R)
    const { x: hx, y: hy, z: hz } = hole.dir
    const zero = _dig.set(0, 0, 0)
    for (const entry of this.detail) {
      let touched = false
      for (let i = 0; i < entry.used; i++) {
        if (entry.dirs[i * 3] * hx + entry.dirs[i * 3 + 1] * hy + entry.dirs[i * 3 + 2] * hz < cos) continue
        entry.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0).setPosition(zero))
        touched = true
      }
      if (touched) entry.mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Build (or rebuild) the high-res patch that lines the pit. */
  private pushPit(hole: DigHole) {
    const existing = this.pits.find((pit) => pit.hole === hole)
    const lift = 0.04 + this.pits.length * 0.006
    const mesh = this.buildPitMesh(hole, lift)
    if (existing) {
      existing.mesh.geometry.dispose()
      existing.mesh.geometry = mesh.geometry
      return
    }
    this.scene.add(mesh)
    this.pits.push({ hole, mesh })
  }

  /**
   * The planet shell is a fixed-detail icosahedron, so a deep scoop is drawn as
   * its own patch riding just above it. Normals come straight from the analytic
   * height field: the mesh is far too coarse around the wall for
   * `computeVertexNormals` to read as a bowl.
   */
  private buildPitMesh(hole: DigHole, lift: number) {
    const rings = 30
    const segs = 56
    // Must reach past the spoil ring, or the mound's outer skirt is drawn by the
    // coarse shell and cuts a hard circle into the grass.
    const outer = Math.min(R * 0.5, hole.radius * 2.1 + 0.15)
    const inner = hole.radius * 0.5
    const rim = hole.radius
    const up = hole.dir
    const e1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? X : Y).normalize()
    const e2 = new THREE.Vector3().crossVectors(up, e1).normalize()
    // Rings: a few across the flat floor, most of them down the wall, a few on
    // the apron that hides the shell's coarse chord.
    const arcAt = (t: number) => {
      if (t < 0.12) return (t / 0.12) * inner
      if (t < 0.58) return inner + ((t - 0.12) / 0.46) * (rim - inner)
      return rim + ((t - 0.58) / 0.42) * (outer - rim)
    }
    const count = (rings + 1) * segs
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const nrm = new Float32Array(count * 3)
    const dir = new THREE.Vector3()
    const q1 = new THREE.Vector3()
    const q2 = new THREE.Vector3()
    const q3 = new THREE.Vector3()
    const q4 = new THREE.Vector3()
    const eps = 0.35 / R
    for (let i = 0; i <= rings; i++) {
      const arc = arcAt(i / rings)
      const sin = Math.sin(arc / R)
      const cos = Math.cos(arc / R)
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2
        dir.copy(up).multiplyScalar(cos)
          .addScaledVector(e1, Math.sin(a) * sin)
          .addScaledVector(e2, Math.cos(a) * sin)
          .normalize()
        const k = (i * segs + j) * 3
        const r = surfaceRadius(dir) + lift
        pos[k] = dir.x * r
        pos[k + 1] = dir.y * r
        pos[k + 2] = dir.z * r
        const s1 = (surfaceRadius(q1.copy(dir).addScaledVector(e1, eps).normalize())
          - surfaceRadius(q2.copy(dir).addScaledVector(e1, -eps).normalize())) / (2 * eps * R)
        const s2 = (surfaceRadius(q3.copy(dir).addScaledVector(e2, eps).normalize())
          - surfaceRadius(q4.copy(dir).addScaledVector(e2, -eps).normalize())) / (2 * eps * R)
        _vA.copy(dir).addScaledVector(e1, -s1).addScaledVector(e2, -s2).normalize()
        nrm[k] = _vA.x
        nrm[k + 1] = _vA.y
        nrm[k + 2] = _vA.z
        const drop = digDrop(dir)
        // Spoil is soil too, so the mound darkens by its own height, not by the
        // depth of the hole it came out of.
        const dirt = Math.max(drop / 0.4, smoothstep(digMound(dir) / 0.3))
        zoneColor(dir, _col)
        _col.lerp(SOIL, Math.min(1, dirt))
        _col.lerp(SOIL_DEEP, THREE.MathUtils.clamp(drop / (DIG_MAX * 1.4), 0, 0.55))
        col[k] = _col.r
        col[k + 1] = _col.g
        col[k + 2] = _col.b
      }
    }
    const index: number[] = []
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * segs + j
        const b = i * segs + ((j + 1) % segs)
        const c = (i + 1) * segs + j
        const d = (i + 1) * segs + ((j + 1) % segs)
        index.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    geo.setIndex(index)
    // Winding: test the first triangle on the flat floor against its analytic
    // normal (the ring-0 fan is degenerate, so start further out).
    const t0 = (rings >> 1) * segs
    _vB.fromArray(pos, t0 * 3)
    _vC.subVectors(_vC.fromArray(pos, (t0 + segs) * 3), _vB)
    _vD.subVectors(_vD.fromArray(pos, (t0 + 1) * 3), _vB)
    if (_vC.cross(_vD).dot(_vA.fromArray(nrm, t0 * 3)) < 0) {
      for (let i = 0; i < index.length; i += 3) {
        const tmp = index[i + 1]
        index[i + 1] = index[i + 2]
        index[i + 2] = tmp
      }
      geo.setIndex(index)
    }
    const mesh = new THREE.Mesh(geo, this.pitMaterial())
    mesh.name = 'pit'
    mesh.receiveShadow = true
    return mesh
  }

  private pitMaterial() {
    if (!this.pitMat) this.pitMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softGradientMap() })
    return this.pitMat
  }

  /** Undo every pit — used when a match restarts. */
  resetDigs() {
    if (this.pits.length === 0 && digHoles().length === 0) return
    clearDigs()
    for (const pit of this.pits) {
      this.scene.remove(pit.mesh)
      pit.mesh.geometry.dispose()
    }
    this.pits.length = 0
    for (const entry of this.detail) {
      ;(entry.mesh.instanceMatrix.array as Float32Array).set(entry.original, 0)
      entry.mesh.instanceMatrix.needsUpdate = true
    }
    const geo = this.planet.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const dirs = this.groundDirs
    for (let i = 0, n = pos.count; i < n; i++) {
      _dig.set(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])
      const r = plainRadius(_dig)
      arr[i * 3] = _dig.x * r
      arr[i * 3 + 1] = _dig.y * r
      arr[i * 3 + 2] = _dig.z * r
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
  }

  /** Where the crosshair meets the ground, for digging and ladder placement. */
  aimGround(origin: THREE.Vector3, forward: THREE.Vector3, maxDist: number): THREE.Vector3 | null {
    // `surfaceRadius` takes a unit direction, so every sample is normalised
    // first — an un-normalised probe reads as "dead centre of the pit" and the
    // whole march silently misses.
    const blocked = (t: number) => {
      _aim.copy(origin).addScaledVector(forward, t)
      const len = _aim.length() || 1
      return len <= surfaceRadius(_aimN.copy(_aim).divideScalar(len)) ? len : 0
    }
    let prev = 0
    for (let t = 0.35; t <= maxDist; t += 0.3) {
      if (blocked(t)) {
        let lo = prev
        let hi = t
        for (let k = 0; k < 7; k++) {
          const mid = (lo + hi) * 0.5
          if (blocked(mid)) hi = mid
          else lo = mid
        }
        _aim.copy(origin).addScaledVector(forward, hi)
        return _hit.copy(_aim)
      }
      prev = t
    }
    return null
  }

  private place(obj: THREE.Object3D, dir: THREE.Vector3, lift = 0, scale = 1) {
    const up = dir.clone().normalize()
    obj.position.copy(up).multiplyScalar(surfaceRadius(up) + lift)
    obj.quaternion.setFromUnitVectors(Y, up)
    obj.scale.setScalar(scale)
    return obj
  }

  private shadowUnder(group: THREE.Group, radius = 0.8) {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.outline, transparent: true, opacity: 0.14, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.03
    shadow.raycast = () => {}
    group.add(shadow)
  }

  private tree(dir: THREE.Vector3, scale = 1) {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.1, 8), this.mats.wood)
    trunk.position.y = 1.05
    g.add(outlined(trunk))
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), this.mats.candy)
    head.position.y = 2.75
    g.add(outlined(head))
    const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.075, 6, 22), this.mats.white)
    swirl.position.set(0, 2.75, -0.82)
    swirl.rotation.x = 0.25
    g.add(swirl)
    this.shadowUnder(g, 0.75)
    return this.place(g, dir, 0, scale)
  }

  private strawberry(dir: THREE.Vector3, scale = 1) {
    const g = new THREE.Group()
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.56, 14, 10), this.mats.leaf)
    leaves.scale.set(1.2, 0.66, 1.15)
    leaves.position.y = 0.32
    g.add(outlined(leaves))
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), this.mats.candy)
      berry.scale.set(1, 1.25, 1)
      berry.position.set(Math.cos(a) * 0.42, 0.42, Math.sin(a) * 0.42)
      g.add(outlined(berry, 1.06))
    }
    this.shadowUnder(g, 0.6)
    return this.place(g, dir, 0, scale)
  }

  private mushroom(dir: THREE.Vector3, scale = 1) {
    const g = new THREE.Group()
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.1, 10), this.mats.white)
    stem.position.y = 0.55
    g.add(outlined(stem))
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.candy)
    cap.position.y = 1.14
    cap.scale.y = 0.82
    g.add(outlined(cap))
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), this.mats.white)
      dot.position.set(Math.cos(a) * 0.45, 1.42, Math.sin(a) * 0.45)
      g.add(dot)
    }
    this.shadowUnder(g, 0.65)
    return this.place(g, dir, 0, scale)
  }

  private crystal(dir: THREE.Vector3, scale = 1) {
    const g = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 1.2 + i * 0.28, 5),
        toon(COLORS.sky, { transparent: true, opacity: 0.78 }),
      )
      c.position.set((i - 1) * 0.32, 0.62 + i * 0.1, (i % 2) * 0.18)
      c.rotation.z = (i - 1) * 0.16
      g.add(outlined(c, 1.035))
    }
    this.shadowUnder(g, 0.55)
    return this.place(g, dir, 0, scale)
  }

  private rock(dir: THREE.Vector3, scale = 1) {
    const g = new THREE.Group()
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 0), this.mats.choco)
    rock.scale.set(1.25, 0.72, 1)
    rock.position.y = 0.36
    g.add(outlined(rock))
    const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), this.mats.choco)
    small.position.set(0.62, 0.2, 0.2)
    g.add(outlined(small))
    this.shadowUnder(g, 0.7)
    return this.place(g, dir, 0, scale)
  }

  private sign(dir: THREE.Vector3, text: string) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.62, 8), this.mats.plum)
    pole.position.y = 0.81
    g.add(pole)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.16, 10), this.mats.candy)
    foot.position.y = 0.08
    g.add(outlined(foot))
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.62, 0.09),
      new THREE.MeshBasicMaterial({ map: signTexture(text) }),
    )
    board.position.set(0, 1.35, -0.04)
    g.add(board)
    this.shadowUnder(g, 0.35)
    return this.place(g, dir, 0, 0.95)
  }

  private lamp(dir: THREE.Vector3) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.35, 8), this.mats.plum)
    pole.position.y = 0.68
    g.add(pole)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: COLORS.lemon }))
    bulb.position.y = 1.45
    g.add(bulb)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(64, 'rgba(255,227,138,0.95)', 'rgba(255,227,138,0.25)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.setScalar(1.3)
    halo.position.y = 1.45
    g.add(halo)
    this.shadowUnder(g, 0.35)
    return this.place(g, dir, 0, 0.9)
  }

  private candyPile(dir: THREE.Vector3) {
    const g = new THREE.Group()
    const colors = [COLORS.candy, COLORS.mint, COLORS.lemon, COLORS.sky, COLORS.candy]
    for (let i = 0; i < 5; i++) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), toon(colors[i]))
      const a = (i / 5) * Math.PI * 2
      ball.position.set(Math.cos(a) * 0.3, 0.22 + (i % 2) * 0.2, Math.sin(a) * 0.3)
      g.add(outlined(ball, 1.07))
    }
    this.shadowUnder(g, 0.5)
    return this.place(g, dir)
  }

  private balloon(dir: THREE.Vector3) {
    const g = new THREE.Group()
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), this.mats.candy)
    balloon.scale.set(1, 1.18, 1)
    balloon.position.y = 3.4
    g.add(outlined(balloon))
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.6, 4), this.mats.plum)
    string.position.y = 1.9
    g.add(string)
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.24, 8), this.mats.wood)
    basket.position.y = 0.55
    g.add(outlined(basket))
    const placed = this.place(g, dir, 0.05)
    const up = dir.clone().normalize()
    this.floaters.push({ obj: g, base: g.position.clone(), axis: up, amp: 0.35, speed: 0.7 + Math.random() * 0.3, phase: Math.random() * 6 })
    return placed
  }

  private cloud(dir: THREE.Vector3, scale = 1) {
    const g = new THREE.Group()
    const positions = [
      [-0.8, 0, 0, 0.72],
      [0, 0.28, 0, 0.95],
      [0.85, -0.02, 0, 0.66],
    ]
    for (const [x, y, z, r] of positions) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), this.mats.white)
      puff.position.set(x, y, z)
      puff.scale.y = 0.72
      g.add(puff)
    }
    const placed = this.place(g, dir, 10 + Math.random() * 2, scale * 1.4)
    const up = dir.clone().normalize()
    this.floaters.push({ obj: g, base: g.position.clone(), axis: up, amp: 0.5, speed: 0.25, phase: Math.random() * 6 })
    return placed
  }

  private island(dir: THREE.Vector3) {
    const g = new THREE.Group()
    const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5, 0), this.mats.purple)
    chunk.scale.set(1.4, 0.7, 1.2)
    chunk.rotation.y = 0.4
    g.add(outlined(chunk))
    const grass = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 10), this.mats.mint)
    grass.scale.set(1.34, 0.34, 1.12)
    grass.position.y = 0.66
    g.add(grass)
    const tree = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), this.mats.candy)
    tree.position.set(0.4, 1.35, 0.1)
    g.add(outlined(tree))
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.7, 6), this.mats.wood)
    trunk.position.set(0.4, 0.88, 0.1)
    g.add(trunk)
    const placed = this.place(g, dir, 7 + Math.random() * 3)
    const up = dir.clone().normalize()
    this.floaters.push({ obj: g, base: g.position.clone(), axis: up, amp: 0.5, speed: 0.4, phase: Math.random() * 6 })
    this.spinners.push({ obj: g, axis: 'y', speed: 0.12 })
    return placed
  }

  private birds(dir: THREE.Vector3) {
    const g = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      const bird = new THREE.Group()
      const mat = i % 2 ? this.mats.white : this.mats.lemon
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.1), mat)
      l.position.x = -0.2
      l.rotation.z = 0.4
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.1), mat)
      r.position.x = 0.2
      r.rotation.z = -0.4
      bird.add(l, r)
      bird.position.set(Math.cos(a) * 2.4, Math.sin(a * 1.7) * 0.4, Math.sin(a) * 2.4)
      g.add(bird)
    }
    const placed = this.place(g, dir, 14, 0.8)
    const up = dir.clone().normalize()
    this.floaters.push({ obj: g, base: g.position.clone(), axis: up, amp: 0.6, speed: 0.5, phase: Math.random() * 6 })
    this.spinners.push({ obj: g, axis: 'y', speed: 0.35 })
    return placed
  }

  private jellyPuddle(dir: THREE.Vector3, scale = 1) {
    const puddle = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 20, 12),
      toon(COLORS.candy, { transparent: true, opacity: 0.38 }),
    )
    puddle.scale.set(1.45, 0.15, 1.05)
    puddle.position.y = 0.12
    const g = new THREE.Group()
    g.add(puddle)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.05, 5, 30), this.mats.white)
    rim.rotation.x = -Math.PI / 2
    rim.position.y = 0.2
    g.add(rim)
    return this.place(g, dir, 0.02, scale)
  }

  /** Cheap instanced candy grass, flowers and pebbles — sells motion in first person. */
  /** One instanced blade cluster instead of a lone spike: reads as turf, not weeds. */
  private grassTuft(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4
      const blade = new THREE.ConeGeometry(i % 2 ? 0.042 : 0.05, i % 2 ? 0.24 : 0.32, 3, 1, true)
      const m = new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(Math.cos(a) * 0.22, a, Math.sin(a) * 0.22))
        .setPosition(Math.cos(a) * 0.055, 0.13, Math.sin(a) * 0.055)
      blade.applyMatrix4(m)
      parts.push(blade)
    }
    const merged = mergeGeometries(parts, false)!
    for (const part of parts) part.dispose()
    return merged
  }

  private addGroundDetail(scene: THREE.Scene) {
    const dummy = new THREE.Object3D()
    const dir = new THREE.Vector3()
    const color = new THREE.Color()
    const grassTones = ['#7FD9AE', '#8FE4C2', '#A8EEC8', '#6ECFA6', '#C8F7DE']
    const flowerTones = ['#FF7FA8', '#FFE38A', '#9EDCFF', '#FFFDF8', '#C9A4F2']
    const pebbleTones = ['#FFE2A8', '#FFFDF8', '#F2ACE0', '#C9A4F2']

    const scatter = (
      count: number,
      geometry: THREE.BufferGeometry,
      lift: number,
      yStretch: [number, number],
      scale: [number, number],
      tones: string[],
      center?: THREE.Vector3,
    ) => {
      const mat = toon(COLORS.white)
      const mesh = new THREE.InstancedMesh(geometry, mat, count)
      mesh.frustumCulled = false
      const dirs = new Float32Array(count * 3)
      let n = 0
      for (let i = 0; i < count; i++) {
        if (center) dir.copy(center).add(_jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.42)).normalize()
        else dir.randomDirection()
        // Clumping: low-frequency noise masks whole areas out so the ground
        // reads as patches instead of an even sprinkle.
        const patch = Math.sin(dir.x * 23 + dir.y * 17) * Math.cos(dir.z * 19)
        if (Math.random() > 0.3 + patch * 0.55) continue
        const radius = surfaceRadius(dir)
        const s = THREE.MathUtils.lerp(scale[0], scale[1], Math.random())
        surfaceNormal(dir, _jitter)
        dummy.position.copy(dir).multiplyScalar(radius).addScaledVector(_jitter, lift * s - 0.012)
        dummy.quaternion.setFromUnitVectors(Y, _jitter)
        dummy.rotateY(Math.random() * Math.PI * 2)
        dummy.scale.set(s, s * THREE.MathUtils.lerp(yStretch[0], yStretch[1], Math.random()), s)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
        dirs[n * 3] = dir.x
        dirs[n * 3 + 1] = dir.y
        dirs[n * 3 + 2] = dir.z
        color.set(tones[(Math.random() * tones.length) | 0])
        if (Math.random() < 0.18) color.offsetHSL(0, 0, 0.06)
        mesh.setColorAt(n, color)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      scene.add(mesh)
      this.detail.push({
        mesh,
        dirs,
        used: n,
        original: (mesh.instanceMatrix.array as Float32Array).slice(0, n * 16),
      })
    }

    scatter(14000, this.grassTuft(), 0.1, [0.8, 1.3], [0.55, 1.15], grassTones)
    scatter(1800, new THREE.IcosahedronGeometry(0.055, 0), 0.05, [0.6, 1], [0.7, 1.3], flowerTones)
    scatter(1000, new THREE.DodecahedronGeometry(0.085, 0), 0.045, [0.35, 0.6], [0.5, 1], pebbleTones)

    // Extra density around the landing site so the opening shot has readable ground detail.
    const landing = dirFromLatLon(6, -40)
    scatter(6000, this.grassTuft(), 0.11, [0.8, 1.3], [0.55, 1.15], grassTones, landing)
    scatter(1500, new THREE.IcosahedronGeometry(0.055, 0), 0.05, [0.6, 1], [0.7, 1.3], flowerTones, landing)
    scatter(800, new THREE.DodecahedronGeometry(0.09, 0), 0.05, [0.35, 0.6], [0.6, 1.2], pebbleTones, landing)
  }

  private addMeadow(parent: THREE.Group) {
    const spots: [number, number, number][] = [
      [-24, -64, 1], [-6, -88, .85], [21, -70, .94], [-38, -48, .8],
      [-30, 18, .9], [6, 8, .78], [36, -30, .86],
    ]
    for (const [lat, lon, s] of spots) {
      parent.add(this.tree(dirFromLatLon(lat, lon), s))
      if (lat < -10) parent.add(this.strawberry(dirFromLatLon(lat + 3, lon + 7), .9))
    }
    parent.add(this.strawberry(dirFromLatLon(-14, -76), 1))
    parent.add(this.strawberry(dirFromLatLon(10, -92), .9))
    parent.add(this.mushroom(dirFromLatLon(-20, -52), 1.1))
    parent.add(this.sign(dirFromLatLon(8, -52), 'PLANET'))
    parent.add(this.lamp(dirFromLatLon(12, -70)))
    parent.add(this.lamp(dirFromLatLon(-18, -58)))
    parent.add(this.candyPile(dirFromLatLon(3, -66)))
    parent.add(this.balloon(dirFromLatLon(16, -87)))
    // Near-spawn framing so the first view has scale and colour.
    parent.add(this.candyPile(dirFromLatLon(20, -40)))
    parent.add(this.lamp(dirFromLatLon(-8, -29)))
    parent.add(this.rock(dirFromLatLon(-2, -26), 0.9))
  }

  private addDesert(parent: THREE.Group) {
    const rocks: [number, number, number][] = [
      [-56, -20, 1.2], [-48, 14, .9], [-64, 44, 1.1], [-38, 62, .8], [-72, -48, 1],
    ]
    for (const [lat, lon, s] of rocks) parent.add(this.rock(dirFromLatLon(lat, lon), s))
    parent.add(this.mushroom(dirFromLatLon(-46, 28), 1.25))
    parent.add(this.sign(dirFromLatLon(-42, 6), 'CANDY'))
    parent.add(this.lamp(dirFromLatLon(-54, 36)))
    parent.add(this.candyPile(dirFromLatLon(-60, -6)))
  }

  private addIce(parent: THREE.Group) {
    const spots: [number, number, number][] = [
      [58, -8, 1.1], [46, 22, 1], [64, 48, 1.2], [38, -46, .9], [70, 20, .9],
    ]
    for (const [lat, lon, s] of spots) parent.add(this.crystal(dirFromLatLon(lat, lon), s))
    parent.add(this.island(dirFromLatLon(38, 4)))
    parent.add(this.island(dirFromLatLon(52, 66)))
    parent.add(this.lamp(dirFromLatLon(52, 12)))
    parent.add(this.cloud(dirFromLatLon(62, -20), 1.2))
    parent.add(this.cloud(dirFromLatLon(44, 40), 1))
  }

  private addJelly(parent: THREE.Group) {
    parent.add(this.jellyPuddle(dirFromLatLon(8, 26), 1.1))
    parent.add(this.jellyPuddle(dirFromLatLon(-6, 54), .9))
    parent.add(this.jellyPuddle(dirFromLatLon(20, 46), 1.25))
    parent.add(this.mushroom(dirFromLatLon(4, 64), 1.3))
    parent.add(this.strawberry(dirFromLatLon(16, 74), 1.1))
    parent.add(this.sign(dirFromLatLon(2, 40), 'JELLY'))
    parent.add(this.birds(dirFromLatLon(-16, 40)))
    parent.add(this.cloud(dirFromLatLon(8, 10), 1.2))
    parent.add(this.cloud(dirFromLatLon(-28, 70), 1.1))
  }

  private addLandmarks(parent: THREE.Group) {
    const arch = new THREE.Group()
    for (const x of [-2.1, 2.1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 3, 12), this.mats.candy)
      pillar.position.set(x, 1.5, 0)
      arch.add(outlined(pillar))
    }
    const arcColors = [COLORS.candy, COLORS.lemon, COLORS.mint]
    arcColors.forEach((color, i) => {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(2.05 + i * 0.22, 0.14, 6, 28, Math.PI), toon(color))
      arc.position.y = 3
      arch.add(arc)
    })
    this.shadowUnder(arch, 2.4)
    parent.add(this.place(arch, dirFromLatLon(14, -34)))

    const mill = new THREE.Group()
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.98, 3.2, 12), this.mats.white)
    tower.position.y = 1.6
    mill.add(outlined(tower))
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.92, 0.9, 12), this.mats.candy)
    roof.position.y = 3.55
    mill.add(outlined(roof))
    const blades = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2, 0.09), this.mats.lemon)
      arm.position.y = 0.95
      const pivot = new THREE.Group()
      pivot.rotation.z = (i / 4) * Math.PI * 2
      pivot.add(arm)
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.11), this.mats.mint)
      tip.position.y = 2
      pivot.add(tip)
      blades.add(pivot)
    }
    blades.position.set(0, 3.1, -0.9)
    mill.add(blades)
    this.spinners.push({ obj: blades, axis: 'z', speed: 1.1 })
    this.shadowUnder(mill, 1)
    parent.add(this.place(mill, dirFromLatLon(6, 26)))

    const giant = this.mushroom(dirFromLatLon(-34, -8), 2.4)
    parent.add(giant)

    parent.add(this.cloud(dirFromLatLon(-8, -18), 1.3))
    parent.add(this.cloud(dirFromLatLon(26, 78), 1.1))
    parent.add(this.birds(dirFromLatLon(30, -8)))
  }

  private addPads(scene: THREE.Scene) {
    const padDirs = PAD_SPAWNS.map(([lat, lon]) => dirFromLatLon(lat, lon))
    for (const dir of padDirs) {
      const g = new THREE.Group()
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.9, 0.5, 32), this.mats.purple)
      base.position.y = 0.25
      g.add(outlined(base))

      const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.85 })
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.1, 8, 40), ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.55
      g.add(ring)

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 3.4, 8), this.mats.plum)
      pole.position.y = 2
      g.add(pole)

      const flagMat = toon(COLORS.candy, { side: THREE.DoubleSide })
      flagMat.map = flagTexture()
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.72), flagMat)
      flag.position.set(0.7, 3.2, 0)
      g.add(flag)

      const beamMat = new THREE.MeshBasicMaterial({
        color: COLORS.gold,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const beamGeo = new THREE.CylinderGeometry(0.95, 1.55, 6, 18, 1, true)
      beamGeo.translate(0, 3, 0)
      const beam = new THREE.Mesh(beamGeo, beamMat)
      beam.visible = false
      g.add(beam)

      this.place(g, dir)
      scene.add(g)
      this.pads.push({ dir: dir.clone(), group: g, ringMat, flagMat, beam, beamMat, progress: 0, captured: false })
    }
  }

  private buildSky() {
    const sky = new THREE.Group()

    const starGeo = new THREE.BufferGeometry()
    const count = 900
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const palette = [new THREE.Color(COLORS.white), new THREE.Color(COLORS.lemon), new THREE.Color(COLORS.sky), new THREE.Color(COLORS.candy)]
    const v = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(160 + Math.random() * 170)
      positions.set([v.x, v.y, v.z], i * 3)
      const c = palette[i % palette.length]
      colors.set([c.r, c.g, c.b], i * 3)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.6, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }))
    sky.add(stars)

    const far = new THREE.Mesh(
      new THREE.SphereGeometry(30, 32, 24),
      new THREE.MeshToonMaterial({ color: '#C9A4F2', gradientMap: gradientMap(), emissive: new THREE.Color('#4A2A66'), emissiveIntensity: 0.35 }),
    )
    far.position.set(170, 52, -150)
    sky.add(far)
    const farRing = new THREE.Mesh(
      new THREE.TorusGeometry(45, 2.2, 6, 72),
      new THREE.MeshBasicMaterial({ color: '#FFE3B0', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    )
    farRing.position.copy(far.position)
    farRing.rotation.set(1.2, 0.3, 0.5)
    sky.add(farRing)

    const nebulaTex = radialTexture(256, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)')
    const nebulaColors = ['#FF9FC4', '#9FE8D4', '#B7A6FF', '#FFE3A0']
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: nebulaTex,
        color: nebulaColors[i],
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(260, 150), mat)
      const a = (i / 4) * Math.PI * 2 + 0.4
      plane.position.set(Math.cos(a) * 300, Math.sin(a * 2) * 80 + 20, Math.sin(a) * 300)
      plane.lookAt(0, 0, 0)
      plane.rotateZ(Math.random() * Math.PI)
      sky.add(plane)
      this.spinners.push({ obj: plane, axis: 'z', speed: 0.004 * (i % 2 ? 1 : -1) })
    }

    const ribbon = new THREE.Mesh(
      new THREE.TorusGeometry(150, 0.6, 5, 90, Math.PI * 0.9),
      new THREE.MeshBasicMaterial({ color: COLORS.candy, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    ribbon.rotation.set(1.1, 0.2, 0.7)
    sky.add(ribbon)

    // Push the whole backdrop outside the larger planet while keeping its apparent size.
    sky.scale.setScalar(2)
    return sky
  }

  update(dt: number) {
    this.time += dt
    for (const spinner of this.spinners) {
      spinner.obj.rotation[spinner.axis] += spinner.speed * dt
    }
    for (const f of this.floaters) {
      const offset = Math.sin(this.time * f.speed + f.phase) * f.amp
      f.obj.position.copy(f.base).addScaledVector(f.axis, offset)
    }
    for (const pad of this.pads) {
      const pulse = 1 + Math.sin(this.time * 3.2) * 0.035
      pad.ringMat.opacity = pad.captured ? 0.55 + Math.sin(this.time * 4) * 0.15 : 0.8
      if (!pad.captured) {
        pad.ringMat.color.set(COLORS.gold)
        pad.beam.visible = pad.progress > 0.02
        pad.beam.scale.y = Math.max(0.02, pad.progress)
        pad.beamMat.opacity = 0.12 + pad.progress * 0.18
      } else {
        pad.beam.visible = true
        pad.beam.scale.y = 1
        pad.beamMat.opacity = 0.1 + Math.sin(this.time * 2) * 0.04
      }
      const flag = pad.group.children[3]
      if (flag) flag.rotation.y = Math.sin(this.time * 1.8 + pad.dir.x * 4) * 0.18
      pad.group.children[1].scale.setScalar(pulse)
    }
    this.sky.rotation.y += dt * 0.0025
  }
}
