import * as THREE from 'three'
import { COLORS } from '../config'
import { bakeGroup } from './bake'
import { toon } from './toon'

/**
 * Procedural toy houses for the village around the landing site, plus farm
 * houses on the far side of the planet.
 *
 * Same rule as the cover props: every house is authored as a pile of small
 * coloured meshes, then baked into one vertex-coloured geometry, so a house
 * with ~120 parts (shingle rows, window mullions, flower boxes, chimney
 * courses, door straps, barrel, yard stones) still costs exactly one draw call.
 *
 * Local axes: origin at the base centre, y = 0 on the ground, +Z is the front
 * of the house (door, porch, awning).
 */

export type HouseAsset = {
  scene: THREE.Object3D
  /** Half of the widest horizontal extent, in metres at scale 1. */
  footprint: number
  /** Total height, in metres at scale 1. */
  height: number
}

type Style = 'cottage' | 'tall' | 'shop' | 'hut'

const PAL = {
  wallA: '#FFF1D8',
  wallB: '#FFDCC4',
  wallC: '#D2EFE0',
  wallD: '#DCEBFB',
  wallE: '#FFF4C8',
  woodWarm: '#C98B6B',
  woodDeep: '#9A6B4F',
  woodLight: '#E3AE84',
  stone: '#EDE3F1',
  stoneDeep: '#CDBFD6',
  joint: '#8E7C9C',
  doorCandy: '#FF7FA8',
  doorPlum: '#7B5EA7',
  doorMint: '#7FD9B4',
  pane: '#C4ECFF',
  paneDeep: '#9EDCFF',
  roofCandyA: '#FF9BB8',
  roofCandyB: '#FFC4D4',
  roofPlumA: '#8C6BB8',
  roofPlumB: '#AE91D2',
  roofMintA: '#7FD9B4',
  roofMintB: '#A6EDD1',
  roofSkyA: '#8FCCF0',
  roofSkyB: '#B6E3FA',
  roofRoseA: '#B8677A',
  roofRoseB: '#D68C9B',
  leaf: '#7BDCA6',
  leafDeep: '#5FC98C',
  soil: '#B07C55',
  smoke: '#F7F1FF',
  white: COLORS.white,
  gold: COLORS.gold,
  candy: COLORS.candy,
  mint: COLORS.mint,
  lemon: COLORS.lemon,
  sky: COLORS.sky,
  plum: COLORS.plum,
  peach: '#FFB59E',
  lavender: '#C9A4F2',
}

type MatKey = keyof typeof PAL
type Mats = Record<MatKey, THREE.MeshToonMaterial>
let cache: Mats | null = null

function M(): Mats {
  if (cache) return cache
  const out = {} as Mats
  for (const key of Object.keys(PAL) as MatKey[]) out[key] = toon(PAL[key])
  cache = out
  return out
}

type Rnd = () => number
const rng = (r: Rnd, a: number, b: number) => a + (b - a) * r()
const pick = <T,>(r: Rnd, list: T[]): T => list[(r() * list.length) | 0]

type V3 = [number, number, number]

function part(
  g: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  p: V3,
  rot?: V3,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(p[0], p[1], p[2])
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2])
  g.add(mesh)
  return mesh
}

const B = (g: THREE.Object3D, mat: THREE.Material, s: V3, p: V3, rot?: V3) =>
  part(g, new THREE.BoxGeometry(s[0], s[1], s[2]), mat, p, rot)
const CYL = (g: THREE.Object3D, mat: THREE.Material, rt: number, rb: number, h: number, seg: number, p: V3) =>
  part(g, new THREE.CylinderGeometry(rt, rb, h, seg), mat, p)
const SPH = (g: THREE.Object3D, mat: THREE.Material, r: number, p: V3, sq?: V3) => {
  const mesh = part(g, new THREE.SphereGeometry(r, 10, 8), mat, p)
  if (sq) mesh.scale.set(sq[0], sq[1], sq[2])
  return mesh
}

const ROOFS: [MatKey, MatKey][] = [
  ['roofCandyA', 'roofCandyB'],
  ['roofPlumA', 'roofPlumB'],
  ['roofMintA', 'roofMintB'],
  ['roofSkyA', 'roofSkyB'],
  ['roofRoseA', 'roofRoseB'],
]

const WALLS: MatKey[] = ['wallA', 'wallB', 'wallC', 'wallD', 'wallE']
const DOORS: MatKey[] = ['doorCandy', 'doorPlum', 'doorMint']

/** Framed window with mullions, sill, shutters and a flower box. Faces +Z. */
function windowUnit(
  parent: THREE.Object3D,
  m: Mats,
  p: V3,
  yaw: number,
  ww: number,
  wh: number,
  shutter: THREE.Material,
) {
  const g = new THREE.Group()
  g.position.set(p[0], p[1], p[2])
  g.rotation.y = yaw
  parent.add(g)

  // chunky white casing, then a recessed pane so the glass sits inside it
  B(g, m.white, [ww + 0.22, wh + 0.22, 0.12], [0, 0, 0])
  B(g, m.woodDeep, [ww + 0.06, wh + 0.06, 0.06], [0, 0, 0.06])
  B(g, m.paneDeep, [ww, wh, 0.05], [0, 0, 0.075])
  B(g, m.pane, [ww * 0.92, wh * 0.9, 0.03], [0, 0.02, 0.085])
  // two slim sheen strokes across the glass
  for (const k of [-1, 1]) {
    B(g, m.white, [ww * 0.07, wh * 0.34, 0.012], [k * ww * 0.22, wh * 0.16, 0.1], [0, 0, 0.5])
  }
  // mullion cross
  B(g, m.white, [0.06, wh, 0.09], [0, 0, 0.09])
  B(g, m.white, [ww, 0.06, 0.09], [0, 0, 0.09])
  // sill + apron board
  B(g, m.woodWarm, [ww + 0.4, 0.1, 0.28], [0, -wh / 2 - 0.15, 0.06])
  B(g, m.woodDeep, [ww + 0.34, 0.12, 0.08], [0, -wh / 2 - 0.26, 0.04])
  // shutters, each with two painted slats
  for (const s of [-1, 1]) {
    B(g, m.woodDeep, [0.2, wh + 0.2, 0.05], [s * (ww / 2 + 0.2), 0, 0.02])
    B(g, shutter, [0.17, wh + 0.16, 0.05], [s * (ww / 2 + 0.2), 0, 0.05])
    for (const t of [0.24, -0.06, -0.32]) {
      B(g, m.white, [0.13, 0.04, 0.03], [s * (ww / 2 + 0.2), wh * t, 0.08])
    }
  }
  // flower box tucked under the sill
  B(g, m.woodDeep, [ww + 0.3, 0.2, 0.22], [0, -wh / 2 - 0.4, 0.12])
  B(g, m.woodWarm, [ww + 0.32, 0.06, 0.06], [0, -wh / 2 - 0.31, 0.22])
  for (let i = 0; i < 4; i++) {
    const x = -ww * 0.36 + i * ww * 0.24
    SPH(g, m.leaf, 0.085, [x, -wh / 2 - 0.31, 0.16], [1, 0.7, 1])
    SPH(g, i % 2 ? m.candy : m.lemon, 0.06, [x + 0.02, -wh / 2 - 0.22, 0.19])
  }
  return g
}

/** A chimneys worth of courses, cap and two candy puffs. */
function chimney(g: THREE.Object3D, m: Mats, x: number, z: number, base: number, top: number) {
  const h = top - base
  B(g, m.stone, [0.38, h, 0.38], [x, base + h / 2, z])
  for (let i = 1; i <= 3; i++) {
    B(g, m.stoneDeep, [0.44, 0.055, 0.44], [x, base + (h * i) / 4, z])
  }
  B(g, m.stoneDeep, [0.5, 0.1, 0.5], [x, top + 0.02, z])
  B(g, m.plum, [0.24, 0.09, 0.24], [x, top + 0.09, z])
  SPH(g, m.smoke, 0.13, [x + 0.02, top + 0.26, z], [1, 0.9, 1])
  SPH(g, m.smoke, 0.09, [x + 0.1, top + 0.42, z + 0.04], [1, 0.9, 1])
}

/** Door group: stone step, strap hinges, knob, lamp and a little porch roof. */
function doorUnit(
  g: THREE.Object3D,
  m: Mats,
  x: number,
  y0: number,
  z: number,
  door: THREE.Material,
  roof: THREE.Material,
  wide = false,
) {
  const dw = wide ? 1.2 : 0.82
  const dh = wide ? 1.62 : 1.3
  const base = y0 + 0.05

  // stone threshold, then the casing, then two planks
  B(g, m.stone, [dw + 0.42, 0.15, 0.44], [x, y0 + 0.02, z + 0.18])
  B(g, m.stoneDeep, [dw + 0.56, 0.07, 0.56], [x, 0.03, z + 0.24])
  B(g, m.white, [dw + 0.22, dh + 0.16, 0.13], [x, base + (dh + 0.16) / 2, z + 0.04])
  const half = dw / 2 - 0.02
  for (const s of [-1, 1]) {
    B(g, door, [half, dh, 0.1], [x + s * (half / 2 + 0.01), base + dh / 2, z + 0.1])
  }
  B(g, m.woodDeep, [0.05, dh, 0.06], [x, base + dh / 2, z + 0.14])
  for (const t of [0.22, 0.74]) {
    B(g, m.woodDeep, [dw, 0.08, 0.04], [x, base + dh * t, z + 0.16])
  }
  for (const s of [-1, 1]) {
    B(g, m.gold, [0.06, 0.06, 0.05], [x + s * dw * 0.34, base + dh * 0.46, z + 0.16])
  }
  SPH(g, m.gold, 0.055, [x - dw * 0.3, base + dh * 0.44, z + 0.19])
  // tiny window in the door
  B(g, m.white, [0.3, 0.3, 0.06], [x, base + dh * 0.82, z + 0.15])
  B(g, m.pane, [0.22, 0.22, 0.04], [x, base + dh * 0.82, z + 0.18])

  // porch roof, propped on two brackets
  const pw = dw + 0.8
  B(g, roof, [pw, 0.1, 0.66], [x, base + dh + 0.32, z + 0.3], [-0.32, 0, 0])
  B(g, m.white, [pw, 0.09, 0.1], [x, base + dh + 0.22, z + 0.6], [-0.32, 0, 0])
  for (const s of [-1, 1]) {
    B(g, m.woodDeep, [0.09, 0.09, 0.5], [x + s * pw * 0.4, base + dh + 0.18, z + 0.22], [-0.42, 0, 0])
  }
  // wall lamp beside the door
  const lx = x + (dw / 2 + 0.26)
  B(g, m.plum, [0.16, 0.05, 0.05], [lx - 0.07, base + dh + 0.02, z + 0.09])
  B(g, m.gold, [0.2, 0.24, 0.2], [lx, base + dh - 0.1, z + 0.13])
  B(g, m.lemon, [0.14, 0.17, 0.14], [lx, base + dh - 0.1, z + 0.16])
  B(g, m.plum, [0.24, 0.05, 0.24], [lx, base + dh + 0.03, z + 0.13])
}

/** Low picket fence, long axis on X, running from x0 to x1 at z. */
function fence(g: THREE.Object3D, m: Mats, x0: number, x1: number, z: number, y0 = 0) {
  const len = Math.abs(x1 - x0)
  const posts = Math.max(2, Math.round(len / 0.42))
  for (let i = 0; i < posts; i++) {
    const x = x0 + ((x1 - x0) * i) / (posts - 1)
    B(g, m.white, [0.09, 0.72, 0.09], [x, y0 + 0.36, z])
    const tip = part(g, new THREE.ConeGeometry(0.075, 0.14, 4), m.white, [x, y0 + 0.79, z], [0, 0.78, 0])
    tip.scale.setScalar(1)
  }
  for (const y of [0.28, 0.56]) {
    B(g, m.woodWarm, [len, 0.07, 0.05], [(x0 + x1) / 2, y0 + y, z - 0.06])
  }
}

/** Barrel, crate and a couple of stepping stones to dress the yard. */
function yard(g: THREE.Object3D, m: Mats, r: Rnd, cx: number, cz: number, fenceSide = 0) {
  const bx = cx + rng(r, -0.9, 0.9)
  const bz = cz + rng(r, -0.5, 0.6)
  CYL(g, m.woodWarm, 0.27, 0.25, 0.62, 12, [bx, 0.31, bz])
  for (const y of [0.16, 0.46]) CYL(g, m.woodDeep, 0.285, 0.285, 0.06, 12, [bx, y, bz])
  CYL(g, m.woodLight, 0.24, 0.24, 0.03, 12, [bx, 0.62, bz])

  const cx2 = bx + rng(r, 0.7, 1.1)
  const s = rng(r, 0.42, 0.52)
  B(g, m.lemon, [s, s, s], [cx2, s / 2, bz + rng(r, -0.2, 0.2)])
  B(g, m.white, [s * 1.03, s * 1.03, 0.08], [cx2, s / 2, bz])

  for (let i = 0; i < 3; i++) {
    const a = rng(r, 0, Math.PI * 2)
    const d = rng(r, 0.5, 1.3)
    const stone = part(
      g,
      new THREE.DodecahedronGeometry(rng(r, 0.14, 0.26), 0),
      m.stoneDeep,
      [cx + Math.cos(a) * d, 0.05, cz + Math.sin(a) * d],
    )
    stone.scale.y = 0.45
    stone.rotation.y = rng(r, 0, 6.28)
  }
  // stepping stones from the door out towards the square
  for (let i = 0; i < 5; i++) {
    const step = part(
      g,
      new THREE.CylinderGeometry(rng(r, 0.24, 0.32), rng(r, 0.26, 0.34), 0.17, 7),
      i % 2 ? m.stone : m.stoneDeep,
      [cx + rng(r, -0.12, 0.12), 0.09, cz + 0.6 + i * 0.66],
      [0, rng(r, 0, 2), 0],
    )
    step.scale.z = 0.8
  }

  // two bushes hugging the wall
  for (const s of [-1, 1]) {
    SPH(g, m.leafDeep, 0.3, [cx + s * rng(r, 0.8, 1.4), 0.24, cz - 0.4], [1, 0.85, 1])
    SPH(g, m.leaf, 0.22, [cx + s * rng(r, 1.1, 1.7), 0.3, cz - 0.2], [1, 0.8, 1])
  }
  if (fenceSide) fence(g, m, cx + fenceSide * 0.7, cx + fenceSide * 2.8, cz + 1.5)
}

function house(r: Rnd, style: Style, variant = -1): HouseAsset {
  const m = M()
  const g = new THREE.Group()

  const w = style === 'tall' ? rng(r, 3.3, 4.0) : style === 'hut' ? rng(r, 2.7, 3.2) : rng(r, 3.8, 4.8)
  const d = style === 'hut' ? rng(r, 2.5, 3.0) : rng(r, 3.4, 4.3)
  const twoFloors = style === 'tall'
  const h = twoFloors ? rng(r, 4.3, 4.9) : style === 'hut' ? rng(r, 2.1, 2.5) : rng(r, 2.7, 3.2)
  const rise = style === 'hut' ? rng(r, 0.9, 1.15) : rng(r, 1.15, 1.6)
  const ov = 0.36
  const y0 = 0.26

  const wallKey = style === 'hut' ? pick(r, ['woodWarm', 'woodLight'] as MatKey[]) : pick(r, WALLS)
  const wall = m[wallKey]
  // explicit variant keeps a street's worth of houses from sharing one roof colour
  const roofKeys = variant >= 0 ? ROOFS[variant % ROOFS.length] : pick(r, ROOFS)
  const roofA = m[roofKeys[0]]
  const roofB = m[roofKeys[1]]
  const doorMat = m[pick(r, DOORS)]
  const shutterMat = pick(r, [m.doorMint, m.doorPlum, m.sky, m.candy])

  // ---- foundation + walls -------------------------------------------------
  B(g, m.stoneDeep, [w + 0.34, y0, d + 0.34], [0, y0 / 2, 0])
  B(g, m.stone, [w + 0.2, 0.12, d + 0.2], [0, y0 + 0.02, 0])
  B(g, wall, [w, h, d], [0, y0 + h / 2, 0])
  // timber base band + top plate + corner posts
  B(g, m.woodWarm, [w + 0.07, 0.56, d + 0.07], [0, y0 + 0.28, 0])
  B(g, m.woodDeep, [w + 0.16, 0.17, d + 0.16], [0, y0 + h - 0.07, 0])
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B(g, m.woodWarm, [0.19, h, 0.19], [sx * (w / 2 - 0.02), y0 + h / 2, sz * (d / 2 - 0.02)])
    }
  }
  if (twoFloors) {
    // mid-floor belt so the tall house reads as two storeys
    B(g, m.woodDeep, [w + 0.1, 0.14, d + 0.1], [0, y0 + h * 0.52, 0])
  }

  // ---- gable ends (ridge runs along X, slopes face +/-Z) ------------------
  const gableShape = new THREE.Shape()
  gableShape.moveTo(-d / 2, 0)
  gableShape.lineTo(d / 2, 0)
  gableShape.lineTo(0, rise)
  gableShape.lineTo(-d / 2, 0)
  for (const sx of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.16, bevelEnabled: false })
    geo.translate(0, 0, -0.08)
    part(g, geo, wall, [sx * (w / 2), y0 + h, 0], [0, Math.PI / 2, 0])
    // round attic window in the gable
    const gy = y0 + h + rise * 0.44
    part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12), m.white, [sx * (w / 2 + 0.02), gy, 0], [0, 0, Math.PI / 2])
    part(g, new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12), m.pane, [sx * (w / 2 + 0.05), gy, 0], [0, 0, Math.PI / 2])
    B(g, m.white, [0.05, 0.46, 0.06], [sx * (w / 2 + 0.07), gy, 0])
    B(g, m.white, [0.05, 0.06, 0.46], [sx * (w / 2 + 0.07), gy, 0])
    // gable trim beam following the two roof edges
    for (const s2 of [-1, 1]) {
      const len = Math.hypot(d / 2, rise) + 0.12
      const a = Math.atan2(rise, d / 2) * s2
      B(g, m.woodDeep, [0.08, 0.09, len], [sx * (w / 2 + 0.09), y0 + h + rise / 2 + 0.02, s2 * d * 0.25], [a, 0, 0])
    }
  }

  // ---- roof: stepped shingle rows ----------------------------------------
  const eaveY = y0 + h + 0.02
  const ridgeY = y0 + h + rise
  const eaveZ = d / 2 + ov
  const slant = Math.hypot(rise, eaveZ)
  const ang = Math.atan2(rise, eaveZ)
  const rows = style === 'hut' ? 7 : 10
  for (const s of [-1, 1]) {
    for (let i = 0; i < rows; i++) {
      const t = (i + 0.5) / rows
      const z = s * eaveZ * t
      const y = ridgeY - rise * t
      const len = (slant / rows) * 1.42
      const mat = i % 2 === 0 ? roofA : roofB
      B(g, mat, [w + ov * 2, 0.1, len], [0, y + 0.05, z], [s * ang, 0, 0])
    }
  }
  B(g, roofA, [w + ov * 2 + 0.12, 0.17, 0.36], [0, ridgeY + 0.03, 0])
  for (const s of [-1, 1]) {
    // eave board
    B(g, m.woodDeep, [w + ov * 2, 0.1, 0.12], [0, eaveY - 0.02, s * (eaveZ - 0.02)])
  }

  // ---- chimney ------------------------------------------------------------
  const chX = rng(r, -w * 0.3, w * 0.3)
  chimney(g, m, chX, rng(r, -d * 0.24, d * 0.1), ridgeY - rise * 0.35, ridgeY + 0.62)

  // ---- door + windows ----------------------------------------------------
  const doorX = style === 'shop' ? -w * 0.26 : rng(r, -w * 0.15, w * 0.15)
  doorUnit(g, m, doorX, y0, d / 2, doorMat, roofA, style === 'shop')
  const side = doorX >= 0 ? -1 : 1

  const frontY = y0 + 1.62
  if (style === 'cottage') {
    windowUnit(g, m, [side * w * 0.28, frontY, d / 2 + 0.05], 0, 0.78, 0.82, shutterMat)
  }
  if (style === 'shop') {
    // wide display window beside the door
    windowUnit(g, m, [w * 0.16, y0 + 1.5, d / 2 + 0.05], 0, 1.0, 0.86, shutterMat)
  }
  if (style === 'tall') {
    for (const sx of [-1, 1]) windowUnit(g, m, [sx * w * 0.26, frontY, d / 2 + 0.05], 0, 0.7, 0.78, shutterMat)
    for (const sx of [-1, 1]) windowUnit(g, m, [sx * w * 0.26, y0 + h * 0.78, d / 2 + 0.05], 0, 0.7, 0.78, shutterMat)
  }
  if (style === 'hut') {
    windowUnit(g, m, [side * w * 0.3, y0 + 1.55, d / 2 + 0.05], 0, 0.56, 0.62, shutterMat)
  }
  // side and back windows
  const sideY = twoFloors ? y0 + h * 0.3 : y0 + 1.5
  for (const sx of [-1, 1]) {
    windowUnit(g, m, [sx * (w / 2 + 0.03), sideY, rng(r, -d * 0.18, d * 0.18)], sx * (Math.PI / 2), 0.58, 0.62, shutterMat)
    if (twoFloors) {
      windowUnit(g, m, [sx * (w / 2 + 0.03), y0 + h * 0.76, rng(r, -d * 0.2, d * 0.2)], sx * (Math.PI / 2), 0.56, 0.6, shutterMat)
    }
  }
  for (const sx of [-1, 1]) {
    windowUnit(g, m, [sx * w * 0.24, sideY, -(d / 2 + 0.03)], Math.PI, 0.6, 0.66, shutterMat)
  }
  // hay hatch under the back gable
  if (style !== 'shop') {
    const hy = y0 + h * 0.82
    B(g, m.white, [0.72, 0.62, 0.1], [0, hy, -(d / 2 + 0.04)])
    B(g, m.woodWarm, [0.6, 0.5, 0.08], [0, hy, -(d / 2 + 0.09)])
    B(g, m.woodDeep, [0.6, 0.06, 0.04], [0, hy + 0.1, -(d / 2 + 0.13)])
    B(g, m.woodDeep, [0.06, 0.5, 0.04], [0, hy, -(d / 2 + 0.13)])
  }

  // downpipe on one front corner
  const pipeX = -w / 2 - 0.09
  CYL(g, m.stoneDeep, 0.045, 0.045, h - 0.2, 6, [pipeX, y0 + (h - 0.2) / 2, d / 2 - 0.16])
  for (const t of [0.25, 0.75]) B(g, m.stoneDeep, [0.11, 0.05, 0.11], [pipeX, y0 + h * t, d / 2 - 0.16])

  // ---- shop extras -------------------------------------------------------
  if (style === 'shop') {
    // striped awning over the front
    const stripes = 7
    const sw = (w + 0.3) / stripes
    for (let i = 0; i < stripes; i++) {
      B(
        g,
        i % 2 ? m.white : m.candy,
        [sw, 0.08, 0.78],
        [-w / 2 - 0.15 + sw * (i + 0.5), y0 + 2.42, d / 2 + 0.36],
        [-0.34, 0, 0],
      )
    }
    B(g, m.woodDeep, [w + 0.34, 0.1, 0.1], [0, y0 + 2.28, d / 2 + 0.72], [-0.34, 0, 0])
    // hanging sign on a bracket
    const signX = w * 0.46
    B(g, m.plum, [0.07, 0.07, 0.62], [signX, y0 + 2.5, d / 2 + 0.3])
    B(g, m.plum, [0.07, 0.28, 0.07], [signX, y0 + 2.36, d / 2 + 0.6])
    B(g, m.white, [0.06, 0.52, 0.56], [signX, y0 + 1.9, d / 2 + 0.6])
    B(g, m.candy, [0.05, 0.4, 0.44], [signX, y0 + 1.9, d / 2 + 0.6])
    SPH(g, m.lemon, 0.11, [signX, y0 + 1.94, d / 2 + 0.6], [1, 0.9, 1])
  }

  // ---- yard dressing -----------------------------------------------------
  yard(g, m, r, doorX - (style === 'shop' ? 1.5 : 1.2), d / 2 + 0.9, style === 'hut' ? 0 : side)

  const baked = bakeGroup(g)
  const footprint = Math.max(w, d) / 2 + 0.25
  return { scene: baked, footprint, height: y0 + h + rise + 0.7 }
}

export function buildHouseSet(r: Rnd): HouseAsset[] {
  const out: HouseAsset[] = []
  for (let i = 0; i < 3; i++) out.push(house(r, 'cottage', i * 2))
  for (let i = 0; i < 2; i++) out.push(house(r, 'tall', 1 + i * 2))
  for (let i = 0; i < 2; i++) out.push(house(r, 'shop', 3 + i))
  for (let i = 0; i < 2; i++) out.push(house(r, 'hut', i * 3))
  return out
}

/** Cobbled village square: a kerbed disc of chunky stones. */
export function plaza(r: Rnd, radius = 3.6): HouseAsset {
  const m = M()
  const g = new THREE.Group()
  CYL(g, m.stoneDeep, radius + 0.56, radius + 0.62, 0.16, 22, [0, 0.06, 0])
  CYL(g, m.joint, radius + 0.4, radius + 0.46, 0.09, 22, [0, 0.12, 0])
  const tones = [m.stoneDeep, m.stone, m.stone, m.stoneDeep, m.stone, m.wallD]
  const cobble = (x: number, z: number, size: number, i: number) => {
    const mesh = part(
      g,
      new THREE.CylinderGeometry(size * 0.8, size, 0.22, 7),
      tones[i % tones.length],
      [x, 0.2 - (x * x + z * z) / 192, z],
      [0, (i % 7) * 0.5, 0],
    )
    mesh.scale.set(1, 1, 0.86)
  }
  cobble(0, 0, 0.56, 0)
  let i = 1
  for (let ring = 1; ring * 0.63 < radius; ring++) {
    const rr = ring * 0.63
    const count = Math.max(6, Math.round((Math.PI * 2 * rr) / 0.7))
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (ring % 2 ? 1 : 0) * (Math.PI / count)
      cobble(Math.cos(a) * rr, Math.sin(a) * rr, 0.3 + ((i * 5) % 4) * 0.035, i++)
    }
  }
  // upright kerb stones holding the paving in
  const kerb = Math.round((Math.PI * 2 * radius) / 0.74)
  for (let k = 0; k < kerb; k++) {
    const a = (k / kerb) * Math.PI * 2
    const x = Math.cos(a) * (radius + 0.42)
    const z = Math.sin(a) * (radius + 0.42)
    const b = B(g, m.stoneDeep, [0.5, 0.34, 0.3], [x, 0.15, z])
    b.rotation.y = -a
  }
  return { scene: bakeGroup(g), footprint: radius + 0.8, height: 0.34 }
}

/** Village lamp post: fluted pole, two candy lanterns, warm globes. */
export function lampPost(): HouseAsset {
  const m = M()
  const g = new THREE.Group()
  B(g, m.stoneDeep, [0.7, 0.18, 0.7], [0, 0.09, 0])
  B(g, m.stone, [0.5, 0.24, 0.5], [0, 0.3, 0])
  CYL(g, m.woodDeep, 0.09, 0.13, 2.3, 10, [0, 1.55, 0])
  for (const y of [0.62, 1.5]) {
    B(g, m.gold, [0.2, 0.08, 0.2], [0, y, 0])
    B(g, m.white, [0.26, 0.06, 0.26], [0, y + 0.07, 0])
  }
  // cross arm with two lanterns
  B(g, m.gold, [1.56, 0.1, 0.1], [0, 2.72, 0])
  for (const s of [-1, 1]) {
    CYL(g, m.gold, 0.02, 0.02, 0.18, 6, [s * 0.7, 2.6, 0])
    part(g, new THREE.ConeGeometry(0.26, 0.2, 4), m.plum, [s * 0.7, 2.5, 0], [0, 0.78, 0])
    B(g, m.lemon, [0.34, 0.34, 0.34], [s * 0.7, 2.32, 0])
    B(g, m.white, [0.4, 0.07, 0.4], [s * 0.7, 2.13, 0])
    B(g, m.gold, [0.06, 0.06, 0.06], [s * 0.7, 2.5, 0])
  }
  SPH(g, m.gold, 0.13, [0, 2.86, 0])
  CYL(g, m.gold, 0.03, 0.05, 0.2, 6, [0, 2.98, 0])
  return { scene: bakeGroup(g), footprint: 0.9, height: 3.1 }
}
