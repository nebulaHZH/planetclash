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
const _colB = new THREE.Color()
const _aimN = new THREE.Vector3()
const _f = new THREE.Vector3()
const _avg = new THREE.Vector3()
const _vE = new THREE.Vector3()
const _grad = new THREE.Vector3()
const SN_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3]
const SN_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7]
const _m = new THREE.Matrix4()
const _aim = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _vA = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _vC = new THREE.Vector3()
const _vD = new THREE.Vector3()
const SOIL_TOP = new THREE.Color('#8A5F3C')
const SOIL_LOAM = new THREE.Color('#C09055')
const SOIL_CLAY = new THREE.Color('#9A6238')
const SOIL_CORE = new THREE.Color('#6E4A44')

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

/**
 * One shovelful is a bite of terrain removed *in three dimensions*. It is not a
 * dent in a height field: aim at the wall beside you and it carves sideways,
 * aim at the roof above you and it carves upward, aim at the floor and it
 * deepens the pit. Everything else (walking surface, spoil, the shell that has
 * to get out of the way) is derived from these spheres.
 */
export type DigScoop = {
  /** Where the bite is centred, in world space. */
  c: THREE.Vector3
  /** How much dirt that bite removed. */
  r: number
}

export type DigHole = {
  /** Unit direction of the middle of the excavation. */
  dir: THREE.Vector3
  /** Footprint radius in metres, measured along the surface. */
  radius: number
  /** How far the deepest cut sits below the untouched surface. */
  depth: number
  /** Lowest radius the excavation reaches — the shell is pushed under this. */
  floor: number
  /** Cone test: any direction outside this can skip the hole entirely. */
  cosFar: number
  /** Bounding box of the bites, already padded for the mesh. */
  min: THREE.Vector3
  max: THREE.Vector3
  /** One entry per shovelful. */
  scoops: DigScoop[]
}

/** Digging stops at this depth below the local surface — the planet's floor. */
export const DIG_MAX = 6
/** How much dirt one scoop takes out, in metres of radius. */
export const SCOOP_R = 1.62

const DIGS: DigHole[] = []
/** Whole excavations beyond this are forgotten so the field stays cheap. */
const DIG_LIMIT = 24
/** Bites per excavation — a long tunnel keeps only its newest stretch. */
const SCOOPS_PER_HOLE = 34
/** Where the digging is happening: eviction recycles digs far from here. */
const digAnchor = new THREE.Vector3(0, 1, 0)
/** Set by digAt when it forgets a hole or a scoop; World.dig heals the shell. */
let forgottenHole: DigHole | null = null
let forgottenScoop: { c: THREE.Vector3; r: number } | null = null

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

/**
 * Signed distance to the dirt: positive inside the planet, negative in the air
 * of a dug cavity. The small `1e-5` shrugs off the exact-centre degenerate case.
 */
function fieldAt(x: number, y: number, z: number): number {
  const len = Math.sqrt(x * x + y * y + z * z)
  if (len < 1e-4) return R
  _f.set(x / len, y / len, z / len)
  // Spoil is dirt too, so a mound counts as solid ground.
  let s = plainRadius(_f) + (DIGS.length === 0 ? 0 : digMound(_f)) - len
  for (let h = 0; h < DIGS.length; h++) {
    const scoops = DIGS[h].scoops
    for (let i = 0; i < scoops.length; i++) {
      const sc = scoops[i]
      const dx = x - sc.c.x
      const dy = y - sc.c.y
      const dz = z - sc.c.z
      const k = Math.sqrt(dx * dx + dy * dy + dz * dz) - sc.r
      if (k < s) s = k
    }
  }
  return s
}

/** Is this world point inside the dirt? */
export function isDirt(point: THREE.Vector3): boolean {
  return fieldAt(point.x, point.y, point.z) > 0
}

/**
 * Depth removed along a radial ray. The air column starts at the sky and keeps
 * lowering while some bite connects to it — so an open shaft counts all the way
 * to its floor, while a bite that never reaches the column is roofed and leaves
 * the ground (the top of a tunnel) alone.
 */
function dropAlong(dir: THREE.Vector3, plain: number): number {
  let bottom = plain
  let changed = true
  while (changed) {
    changed = false
    for (let h = 0; h < DIGS.length; h++) {
      const hole = DIGS[h]
      if (dir.dot(hole.dir) < hole.cosFar) continue
      const scoops = hole.scoops
      for (let i = 0; i < scoops.length; i++) {
        const sc = scoops[i]
        const tc = dir.x * sc.c.x + dir.y * sc.c.y + dir.z * sc.c.z
        const cc = sc.c.lengthSq() - sc.r * sc.r
        const disc = tc * tc - cc
        if (disc <= 0) continue
        const half = Math.sqrt(disc)
        const enter = Math.max(0, tc - half)
        if (enter >= bottom) continue
        if (tc + half < bottom - 0.02) continue // still roofed, leave the ground alone
        bottom = enter
        changed = true
      }
    }
  }
  return Math.min(plain - bottom, plain - R * 0.45)
}

export function digDrop(dir: THREE.Vector3): number {
  return DIGS.length === 0 ? 0 : dropAlong(dir, plainRadius(dir))
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
  for (let h = 0; h < DIGS.length; h++) {
    const hole = DIGS[h]
    if (dir.dot(hole.dir) < hole.cosFar) continue
    const k = (Math.acos(THREE.MathUtils.clamp(dir.dot(hole.dir), -1, 1)) * R) / Math.max(0.5, hole.radius)
    if (k < 0.84 || k > 2.05) continue
    // Starts inside the lip so the spoil covers it, crests at 1.35, and is back
    // down to grass by 2.3.
    const up = smoothstep((k - 0.84) / 0.26)
    const down = 1 - smoothstep((k - 1.3) / 0.75)
    const height = up * down * Math.min(MOUND_MAX, hole.depth * 0.17)
    if (height > rise) rise = height
  }
  return rise
}

/** Analytic walking surface — the same function used to displace the mesh. */
export function surfaceRadius(dir: THREE.Vector3): number {
  if (DIGS.length === 0) return plainRadius(dir)
  const base = plainRadius(dir)
  return base - dropAlong(dir, base) + digMound(dir)
}

/**
 * Top of the dirt under a point at radius `from`, marching the same field the
 * meshes use — so the floor of a roofed tunnel counts even though the height
 * field still says "grass" there. `dir` must be unit length. Returns `from`
 * itself when the point already sits inside dirt.
 */
export function groundRadius(dir: THREE.Vector3, from: number): number {
  if (DIGS.length === 0) return surfaceRadius(dir)
  const top = Math.min(from, plainRadius(dir) + 2)
  if (fieldAt(dir.x * top, dir.y * top, dir.z * top) > 0) return top
  let prev = top
  for (let r = top - 0.3; r > R * 0.45; r -= 0.3) {
    if (fieldAt(dir.x * r, dir.y * r, dir.z * r) > 0) {
      let lo = r
      let hi = prev
      for (let k = 0; k < 9; k++) {
        const mid = (lo + hi) * 0.5
        if (fieldAt(dir.x * mid, dir.y * mid, dir.z * mid) > 0) lo = mid
        else hi = mid
      }
      return hi
    }
    prev = r
  }
  return surfaceRadius(dir)
}

/**
 * Push a world point out of dug dirt along the field gradient — the bit that
 * keeps a tunnel a tunnel: the height field only knows "down", walls live here.
 * Returns false when the point is already in open air.
 */
export function dirtPush(point: THREE.Vector3, out: THREE.Vector3): boolean {
  const f = fieldAt(point.x, point.y, point.z)
  if (f <= 0.03) return false
  const e = 0.09
  const gx = fieldAt(point.x + e, point.y, point.z) - fieldAt(point.x - e, point.y, point.z)
  const gy = fieldAt(point.x, point.y + e, point.z) - fieldAt(point.x, point.y - e, point.z)
  const gz = fieldAt(point.x, point.y, point.z + e) - fieldAt(point.x, point.y, point.z - e)
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz)
  if (l < 1e-5) return false
  const d = Math.min(f, 0.25)
  out.set((-gx / l) * d, (-gy / l) * d, (-gz / l) * d)
  return true
}

/** Recompute the summary numbers a hole is described by. */
function refresh(hole: DigHole) {
  const scoops = hole.scoops
  _avg.set(0, 0, 0)
  hole.min.set(Infinity, Infinity, Infinity)
  hole.max.set(-Infinity, -Infinity, -Infinity)
  let floor = Infinity
  for (let i = 0; i < scoops.length; i++) {
    const sc = scoops[i]
    _avg.add(sc.c)
    if (sc.c.length() - sc.r < floor) floor = sc.c.length() - sc.r
    hole.min.min(_vE.copy(sc.c).subScalar(sc.r))
    hole.max.max(_vE.copy(sc.c).addScalar(sc.r))
  }
  _avg.divideScalar(scoops.length)
  hole.dir.copy(_avg).normalize()
  hole.floor = floor
  const plain = plainRadius(hole.dir)
  let arc = SCOOP_R
  for (let i = 0; i < scoops.length; i++) {
    const sc = scoops[i]
    const a = hole.dir.angleTo(_vE.copy(sc.c).normalize()) * R + sc.r
    if (a > arc) arc = a
  }
  hole.radius = Math.min(8.5, arc)
  hole.depth = Math.max(0, Math.min(DIG_MAX, plain - floor))
  hole.cosFar = Math.cos(Math.min(Math.PI, (hole.radius * 1.35 + 1.4) / R))
}

/**
 * Shovel at a world point, swinging along `aim`. Returns the excavation that
 * now owns the spot so the world can resculpt around it.
 *
 * The bite is centred well short of the surface along the swing: each sphere
 * still overlaps the last bite, but only sinks ~1m per swing, so a shaft is
 * dug swing by swing instead of swallowing you in two.
 */
export function digAt(point: THREE.Vector3, aim: THREE.Vector3): DigHole {
  const centre = _vE.copy(point).addScaledVector(aim, SCOOP_R * -0.4).clone()
  // The core is off limits: no bite may remove dirt deeper than DIG_MAX below
  // the local surface. Rides the centre up until the sphere bottoms out right
  // on the boundary, so deep digging turns sideways instead of down.
  _f.copy(centre).normalize()
  const minLen = plainRadius(_f) - DIG_MAX + SCOOP_R
  if (centre.length() < minLen) centre.copy(_f).multiplyScalar(minLen)
  let host: DigHole | null = null
  let best = 2.2
  for (let h = 0; h < DIGS.length; h++) {
    const hole = DIGS[h]
    let near = Infinity
    for (let i = 0; i < hole.scoops.length; i++) {
      const sc = hole.scoops[i]
      const d = centre.distanceTo(sc.c) - sc.r - SCOOP_R
      if (d < near) near = d
    }
    if (near < best) {
      best = near
      host = hole
    }
  }
  if (!host) {
    host = {
      dir: centre.clone().normalize(),
      radius: SCOOP_R,
      depth: 0,
      floor: R,
      cosFar: 1,
      min: new THREE.Vector3(),
      max: new THREE.Vector3(),
      scoops: [],
    }
    DIGS.push(host)
    if (DIGS.length > DIG_LIMIT) {
      // Recycle the excavation farthest from where the player digs, never the
      // oldest: the oldest may be the very tunnel they are standing in, and a
      // forgotten hole would refill around them.
      let worst = -1
      let far = -1
      for (let h = 0; h < DIGS.length - 1; h++) {
        const hole = DIGS[h]
        _vE.copy(hole.min).add(hole.max).multiplyScalar(0.5)
        const d = _vE.distanceTo(centre)
        if (d > far) { far = d; worst = h }
      }
      forgottenHole = worst >= 0 ? DIGS.splice(worst, 1)[0] : null
    }
  }
  host.scoops.push({ c: centre, r: SCOOP_R })
  if (host.scoops.length > SCOOPS_PER_HOLE) forgottenScoop = host.scoops.shift() ?? null
  refresh(host)
  return host
}

/**
 * Is a world point inside a hole's bounding box? Cheap reject for the mesh
 * builders, which ask this thousands of times per scoop.
 */
function inBox(hole: DigHole, p: THREE.Vector3, pad: number): boolean {
  return (
    p.x > hole.min.x - pad && p.x < hole.max.x + pad &&
    p.y > hole.min.y - pad && p.y < hole.max.y + pad &&
    p.z > hole.min.z - pad && p.z < hole.max.z + pad
  )
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

/**
 * Soil strata: four depth bands with wobbly edges — a gradient never reads as
 * "underground", stripes do. Shared by the pit lining and the sunken shell so
 * a dug surface is one continuous material.
 */
function soilColor(pos: THREE.Vector3, dir: THREE.Vector3, below: number, out: THREE.Color) {
  const j = Math.sin(pos.x * 12.9898 + pos.y * 78.233 + pos.z * 37.719) * 43758.5453
  const d = below + (j - Math.floor(j) - 0.5) * 0.5
  zoneColor(dir, out)
  out.lerp(SOIL_TOP, smoothstep(d / 0.5))
  out.lerp(SOIL_LOAM, smoothstep((d - 0.7) / 0.35))
  out.lerp(SOIL_CLAY, smoothstep((d - 2.2) / 0.35))
  out.lerp(SOIL_CORE, smoothstep((d - 4.3) / 0.35))
  return out
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
  /** Where the player stands; digs far from here are recycled first. */
  playerDir = new THREE.Vector3(0, 1, 0)
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

  /** Shootable dirt: the coarse planet plus every patch that lines a dig. */
  digColliders(): THREE.Object3D[] {
    return this.pits.length === 0 ? [this.planet] : [this.planet, ...this.pits.map((pit) => pit.mesh)]
  }

  /** How much dirt sits in the pit at `dir` (0 = untouched grass). */
  depthAt(dir: THREE.Vector3): number {
    return digDrop(dir)
  }

  /**
   * Shovel one scoop at a world point, swinging along `aim`. The coarse sphere
   * shell is pushed out of the way and a surface-nets patch is laid over the
   * bitten field, so the cavity can have a roof and a wall, not just a floor.
   */
  dig(point: THREE.Vector3, aim: THREE.Vector3): { depth: number; radius: number } {
    digAnchor.copy(this.playerDir.lengthSq() > 0 ? this.playerDir : digAnchor)
    const hole = digAt(point, aim)
    this.sinkGround(hole)
    this.dropDetail(hole)
    // A forgotten dig refills: raise the shell it had pushed aside, or its
    // phantom crater stays in the world as holes in the ground.
    if (forgottenHole) {
      this.healShell(forgottenHole.scoops)
      forgottenHole = null
    }
    if (forgottenScoop) {
      this.healShell([forgottenScoop])
      forgottenScoop = null
    }
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

  /** Is this plain-surface point still claimed by a live excavation? */
  private heldByLiveDigs(p: THREE.Vector3): boolean {
    for (const hole of digHoles()) {
      if (inBox(hole, p, 1.2)) return true
    }
    return false
  }

  /**
   * Raise shell vertices near the forgotten scoops that no live dig still
   * needs sunk, and give them their meadow colour back — the fill-in of a
   * forgotten hole. One pass over the shell, whatever the scoop count.
   */
  private healShell(scoops: readonly { c: THREE.Vector3; r: number }[]) {
    const geo = this.planet.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const colAttr = geo.attributes.color as THREE.BufferAttribute | undefined
    const cols = colAttr ? (colAttr.array as Float32Array) : null
    const dirs = this.groundDirs
    let touched = false
    for (let i = 0, n = pos.count; i < n; i++) {
      const x = dirs[i * 3]
      const y = dirs[i * 3 + 1]
      const z = dirs[i * 3 + 2]
      _dig.set(x, y, z)
      const plain = plainRadius(_dig)
      _vA.copy(_dig).multiplyScalar(plain)
      let near = false
      for (const sc of scoops) {
        if (_vA.distanceTo(sc.c) <= sc.r + 1.2) { near = true; break }
      }
      if (!near) continue
      const cur = arr[i * 3] * x + arr[i * 3 + 1] * y + arr[i * 3 + 2] * z
      if (cur >= plain - 0.01) continue
      if (this.heldByLiveDigs(_vA)) continue
      arr[i * 3] = x * plain
      arr[i * 3 + 1] = y * plain
      arr[i * 3 + 2] = z * plain
      if (cols) {
        zoneColor(_dig, _colB)
        cols[i * 3] = _colB.r
        cols[i * 3 + 1] = _colB.g
        cols[i * 3 + 2] = _colB.b
      }
      touched = true
    }
    if (touched) {
      pos.needsUpdate = true
      if (colAttr) colAttr.needsUpdate = true
    }
  }

  /**
   * Get the coarse shell out from under the cavity. It is a fixed-detail
   * icosahedron, so it cannot follow a bite: inside the core of the excavation
   * its vertices are dropped to the deepest point, and across the apron they
   * only duck far enough that the patch wins the depth test.
   */
  private sinkGround(hole: DigHole) {
    const geo = this.planet.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const colAttr = geo.attributes.color as THREE.BufferAttribute | undefined
    const cols = colAttr ? (colAttr.array as Float32Array) : null
    const dirs = this.groundDirs
    if (dirs.length !== pos.count * 3) return
    const deep = Math.max(R * 0.45, hole.floor - 1.0)
    let touched = false
    let colored = false
    for (let i = 0, n = pos.count; i < n; i++) {
      const x = dirs[i * 3]
      const y = dirs[i * 3 + 1]
      const z = dirs[i * 3 + 2]
      _dig.set(x, y, z)
      _vA.copy(_dig).multiplyScalar(plainRadius(_dig))
      if (!inBox(hole, _vA, 1.2)) continue
      const cur = arr[i * 3] * x + arr[i * 3 + 1] * y + arr[i * 3 + 2] * z
      let target: number
      if (inBox(hole, _vA, 0.5)) target = deep
      else target = Math.max(deep, surfaceRadius(_dig) - 0.55)
      const r = Math.min(cur, target)
      arr[i * 3] = x * r
      arr[i * 3 + 1] = y * r
      arr[i * 3 + 2] = z * r
      touched = true
      // A sunk vertex is underground now: dress it in the same soil strata as
      // the pit lining, or it keeps its meadow green and glares out of every
      // tunnel mouth.
      if (cols && r < cur - 0.01) {
        _vB.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
        soilColor(_vB, _dig, _vA.dot(_dig) - r, _colB)
        cols[i * 3] = _colB.r
        cols[i * 3 + 1] = _colB.g
        cols[i * 3 + 2] = _colB.b
        colored = true
      }
    }
    if (touched) pos.needsUpdate = true
    if (colored && colAttr) colAttr.needsUpdate = true
  }

  /** Grass, flowers and pebbles that were standing where the pit now is. */
  private dropDetail(hole: DigHole) {
    const scoops = hole.scoops
    for (const entry of this.detail) {
      let touched = false
      for (let i = 0; i < entry.used; i++) {
        const r = plainRadius(_dig.set(entry.dirs[i * 3], entry.dirs[i * 3 + 1], entry.dirs[i * 3 + 2]))
        _vA.copy(_dig).multiplyScalar(r)
        if (!inBox(hole, _vA, 0.4)) continue
        let inside = false
        for (let s = 0; s < scoops.length; s++) {
          if (_vA.distanceTo(scoops[s].c) < scoops[s].r - 0.02) {
            inside = true
            break
          }
        }
        if (!inside) continue
        entry.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0).setPosition(_vE.set(0, 0, 0)))
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
   * The planet shell is a fixed-detail icosahedron and the cavity is not a
   * height field — it can have a roof — so the patch that lines a hole is a
   * surface-nets iso-surface of the very field the aim probe and the shell
   * agree on. Sampling a cell grid (rather than a radial fan) is what lets the
   * shovel work upward and sideways: a cavity that turns a corner is just
   * another shape in the same field.
   */
  private buildPitMesh(hole: DigHole, lift: number) {
    const pad = 2.1
    const lo = _vA.copy(hole.min).subScalar(pad)
    const hi = _vB.copy(hole.max).addScalar(pad)
    let res = 0.26
    const span = Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    if (span / res > 40) res = span / 40
    const nx = Math.ceil((hi.x - lo.x) / res) + 1
    const ny = Math.ceil((hi.y - lo.y) / res) + 1
    const nz = Math.ceil((hi.z - lo.z) / res) + 1
    const nxny = nx * ny
    const grid = new Float32Array(nx * ny * nz)
    for (let k = 0; k < nz; k++) {
      const z = lo.z + k * res
      for (let j = 0; j < ny; j++) {
        const y = lo.y + j * res
        for (let i = 0; i < nx; i++) {
          grid[i + j * nx + k * nxny] = fieldAt(lo.x + i * res, y, z)
        }
      }
    }

    // One vertex per mixed-sign cell, sitting on the average of its edge
    // crossings. That is the whole of surface nets, and it is table-free.
    const cnx = nx - 1
    const cny = ny - 1
    const cnz = nz - 1
    const cnxny = cnx * cny
    const cellV = new Int32Array(cnx * cny * cnz).fill(-1)
    const vpos: number[] = []
    const corner = new Float32Array(8)
    for (let k = 0; k < cnz; k++) {
      for (let j = 0; j < cny; j++) {
        for (let i = 0; i < cnx; i++) {
          let mask = 0
          for (let c = 0; c < 8; c++) {
            const v = grid[(i + (c & 1)) + (j + ((c >> 1) & 1)) * nx + (k + ((c >> 2) & 1)) * nxny]
            corner[c] = v
            if (v > 0) mask |= 1 << c
          }
          if (mask === 0 || mask === 255) continue
          let sx = 0
          let sy = 0
          let sz = 0
          let hits = 0
          for (let e = 0; e < 12; e++) {
            const a = SN_A[e]
            const b = SN_B[e]
            const va = corner[a]
            const vb = corner[b]
            if (va > 0 === vb > 0) continue
            const t = va / (va - vb)
            sx += (a & 1) + ((b & 1) - (a & 1)) * t
            sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t
            sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t
            hits++
          }
          cellV[i + j * cnx + k * cnxny] = vpos.length / 3
          vpos.push(
            lo.x + (i + sx / hits) * res,
            lo.y + (j + sy / hits) * res,
            lo.z + (k + sz / hits) * res,
          )
        }
      }
    }
    if (vpos.length === 0) {
      const empty = new THREE.BufferGeometry()
      const blank = new THREE.Mesh(empty, this.pitMaterial())
      blank.name = 'pit'
      return blank
    }

    const index: number[] = []
    const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return
      if (flip) index.push(a, c, b, a, d, c)
      else index.push(a, b, c, a, c, d)
    }
    const at = (i: number, j: number, k: number) => grid[i + j * nx + k * nxny] > 0
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const here = at(i, j, k)
          // x edge: the four cells around it share the x index
          if (i < cnx && j > 0 && j < cny && k > 0 && k < cnz && here !== at(i + 1, j, k)) {
            quad(
              cellV[i + (j - 1) * cnx + (k - 1) * cnxny],
              cellV[i + j * cnx + (k - 1) * cnxny],
              cellV[i + j * cnx + k * cnxny],
              cellV[i + (j - 1) * cnx + k * cnxny],
              here,
            )
          }
          // y edge
          if (j < cny && i > 0 && i < cnx && k > 0 && k < cnz && here !== at(i, j + 1, k)) {
            quad(
              cellV[i - 1 + j * cnx + (k - 1) * cnxny],
              cellV[i - 1 + j * cnx + k * cnxny],
              cellV[i + j * cnx + k * cnxny],
              cellV[i + j * cnx + (k - 1) * cnxny],
              here,
            )
          }
          // z edge
          if (k < cnz && i > 0 && i < cnx && j > 0 && j < cny && here !== at(i, j, k + 1)) {
            quad(
              cellV[i - 1 + (j - 1) * cnx + k * cnxny],
              cellV[i + (j - 1) * cnx + k * cnxny],
              cellV[i + j * cnx + k * cnxny],
              cellV[i - 1 + j * cnx + k * cnxny],
              here,
            )
          }
        }
      }
    }
    if (index.length === 0) {
      const blank = new THREE.BufferGeometry()
      const mesh = new THREE.Mesh(blank, this.pitMaterial())
      mesh.name = 'pit'
      return mesh
    }

    const count = vpos.length / 3
    const pos = new Float32Array(vpos)
    // Lift the patch a hair along the field so it wins the depth test against
    // the terrain it is duplicating at the rim, then push it out along its own
    // normal once the normals exist.
    const nrm = new Float32Array(count * 3)
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3
      const b = index[t + 1] * 3
      const c = index[t + 2] * 3
      _vC.set(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2])
      _vD.set(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])
      _vC.cross(_vD)
      for (const v of [a, b, c]) {
        nrm[v] += _vC.x
        nrm[v + 1] += _vC.y
        nrm[v + 2] += _vC.z
      }
    }
    for (let i = 0; i < count; i++) {
      _vC.fromArray(nrm, i * 3)
      const l = _vC.length() || 1
      nrm[i * 3] = _vC.x / l
      nrm[i * 3 + 1] = _vC.y / l
      nrm[i * 3 + 2] = _vC.z / l
    }

    // Which way round is "out"? The field is positive inside the dirt, so the
    // visible face of the cavity points down the gradient. Vote over a handful
    // of triangles instead of trusting the quad order.
    let votes = 0
    for (let t = 0; t < index.length && t < 90; t += 9) {
      const a = index[t] * 3
      _vC.fromArray(pos, a)
      _vC.add(_vE.fromArray(pos, index[t + 1] * 3)).add(_vE.fromArray(pos, index[t + 2] * 3)).divideScalar(3)
      const e = res * 0.5
      const gx = fieldAt(_vC.x + e, _vC.y, _vC.z) - fieldAt(_vC.x - e, _vC.y, _vC.z)
      const gy = fieldAt(_vC.x, _vC.y + e, _vC.z) - fieldAt(_vC.x, _vC.y - e, _vC.z)
      const gz = fieldAt(_vC.x, _vC.y, _vC.z + e) - fieldAt(_vC.x, _vC.y, _vC.z - e)
      votes += nrm[a] * gx + nrm[a + 1] * gy + nrm[a + 2] * gz > 0 ? 1 : -1
    }
    if (votes > 0) {
      for (let t = 0; t < index.length; t += 3) {
        const tmp = index[t + 1]
        index[t + 1] = index[t + 2]
        index[t + 2] = tmp
      }
      for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i]
    }

    const col = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      _vC.fromArray(pos, i * 3)
      const len = _vC.length() || 1
      _vD.copy(_vC).divideScalar(len)
      const plain = plainRadius(_vD)
      const below = plain - len
      soilColor(_vC, _vD, below, _col)
      col[i * 3] = _col.r
      col[i * 3 + 1] = _col.g
      col[i * 3 + 2] = _col.b
      pos[i * 3] += nrm[i * 3] * lift
      pos[i * 3 + 1] += nrm[i * 3 + 1] * lift
      pos[i * 3 + 2] += nrm[i * 3 + 2] * lift
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    geo.setIndex(index)
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
    const colAttr = geo.attributes.color as THREE.BufferAttribute | undefined
    const cols = colAttr ? (colAttr.array as Float32Array) : null
    const dirs = this.groundDirs
    for (let i = 0, n = pos.count; i < n; i++) {
      _dig.set(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])
      const r = plainRadius(_dig)
      arr[i * 3] = _dig.x * r
      arr[i * 3 + 1] = _dig.y * r
      arr[i * 3 + 2] = _dig.z * r
      if (cols) {
        zoneColor(_dig, _colB)
        cols[i * 3] = _colB.r
        cols[i * 3 + 1] = _colB.g
        cols[i * 3 + 2] = _colB.b
      }
    }
    pos.needsUpdate = true
    if (colAttr) colAttr.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
  }

  /** Where the crosshair meets the dirt, for digging and ladder placement. */
  aimGround(origin: THREE.Vector3, forward: THREE.Vector3, maxDist: number): THREE.Vector3 | null {
    // The volumetric field, not the radial surface: a cavity with a roof can
    // only be found by asking what is dirt, and a radial probe would sail
    // straight through the roof of a tunnel.
    const blocked = (t: number) => {
      _aim.copy(origin).addScaledVector(forward, t)
      return fieldAt(_aim.x, _aim.y, _aim.z) > 0
    }
    let prev = 0.1
    for (let t = 0.3; t <= maxDist; t += 0.28) {
      if (blocked(t)) {
        let lo = prev
        let hi = t
        for (let k = 0; k < 7; k++) {
          const mid = (lo + hi) * 0.5
          if (blocked(mid)) hi = mid
          else lo = mid
        }
        return _hit.copy(_aim.copy(origin).addScaledVector(forward, hi))
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
