import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS } from '../config'
import { toon } from './toon'

/**
 * Procedural cover props, replacing the flat-shaded Kenney GLB blocks.
 *
 * Every variant is baked into a single vertex-coloured geometry, so one prop
 * costs one draw call, and all of them share one toon material. That keeps
 * the candy palette consistent with the landmarks while staying cheap enough
 * to scatter ~200 of them around the planet.
 *
 * Assets are authored with the origin at the base centre and y = 0 on the
 * ground, so `attach()` can drop them straight onto the surface.
 */

export type CoverKind = 'tree' | 'rock' | 'block' | 'wall' | 'column' | 'barricade' | 'bush'

export type CoverAsset = {
  scene: THREE.Object3D
  /** Half of the widest horizontal extent, in metres at scale 1. */
  footprint: number
  /** Total height, in metres at scale 1. */
  height: number
}

const PAL = {
  candy: COLORS.candy,
  mint: COLORS.mint,
  lemon: COLORS.lemon,
  sky: COLORS.sky,
  white: COLORS.white,
  gold: COLORS.gold,
  wood: '#C98B6B',
  choco: '#9A5B62',
  plum: COLORS.plum,
  lavender: '#C9A4F2',
  peach: '#FFB59E',
  leaf: '#7BDCA6',
  cream: '#FFE9C9',
}

type MatKey = keyof typeof PAL
type Mats = Record<MatKey, THREE.MeshToonMaterial>
let mats: Mats | null = null

function materials(): Mats {
  if (mats) return mats
  const out = {} as Mats
  for (const key of Object.keys(PAL) as MatKey[]) out[key] = toon(PAL[key])
  mats = out
  return out
}

let coverMat: THREE.MeshToonMaterial | null = null
function bakedMaterial() {
  if (!coverMat) {
    coverMat = toon(COLORS.white)
    coverMat.vertexColors = true
  }
  return coverMat
}

type Rnd = () => number
const pick = <T>(rnd: Rnd, list: T[]): T => list[(rnd() * list.length) | 0]

const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)

/** Flatten a small group of coloured meshes into one vertex-coloured geometry. */
function bake(group: THREE.Group): THREE.Mesh {
  group.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    geo.deleteAttribute('uv')
    geo.deleteAttribute('uv1')
    const flat = geo.index ? geo.toNonIndexed() : geo
    if (flat !== geo) geo.dispose()
    const color = (mesh.material as THREE.MeshToonMaterial).color
    const count = flat.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(flat)
  })
  const merged = mergeGeometries(parts, false)!
  for (const part of parts) part.dispose()
  merged.computeBoundingSphere()
  const mesh = new THREE.Mesh(merged, bakedMaterial())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

const TREE_TONES: MatKey[] = ['candy', 'mint', 'sky', 'lavender', 'lemon', 'peach']

/** Lollipop tree: chunky trunk, one big candy canopy, white sprinkle dots. */
function tree(i: number): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.21, 1.5, 8), M.wood)
  trunk.position.y = 0.75
  g.add(trunk)
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.92, 16, 12), M[TREE_TONES[i % TREE_TONES.length]])
  canopy.position.y = 2.15
  canopy.scale.y = 0.94
  g.add(canopy)
  for (let i = 0; i < 4; i++) {
    const a = i * 1.9 + 0.4
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.white)
    dot.position.set(Math.cos(a) * 0.62, 2.12 + Math.sin(a * 2.3) * 0.42, Math.sin(a) * 0.62)
    g.add(dot)
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7), M.lemon)
  knot.position.y = 2.92
  g.add(knot)
  return { scene: bake(g), footprint: 0.95, height: 3.1 }
}

/** Gumdrop rock: faceted blob plus a small companion. */
function rock(rnd: Rnd): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), pick(rnd, [M.choco, M.lavender, M.peach]))
  body.scale.set(1.25, 0.82, 1)
  body.position.y = 0.36
  body.rotation.y = rnd() * 6
  g.add(body)
  const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), M.choco)
  small.position.set(0.44, 0.16, 0.24)
  g.add(small)
  return { scene: bake(g), footprint: 0.68, height: 0.72 }
}

/** Candy crate: banded box with a white ribbon, made to stack. */
function crate(rnd: Rnd): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const s = 0.86
  const body = box(s, s, s, pick(rnd, [M.lemon, M.mint, M.candy, M.peach]))
  body.position.y = s / 2
  g.add(body)
  for (const rot of [0, Math.PI / 2]) {
    const ribbon = box(s * 1.035, s * 1.035, 0.15, M.white)
    ribbon.position.y = s / 2
    ribbon.rotation.y = rot
    g.add(ribbon)
  }
  const lid = box(s * 1.02, 0.1, s * 1.02, M.white)
  lid.position.y = s - 0.01
  g.add(lid)
  return { scene: bake(g), footprint: 0.48, height: s }
}

/** Candy-cane fence segment, long axis on X. */
function wall(rnd: Rnd): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const half = 0.78
  for (const x of [-half, half]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.02, 8), M.candy)
    post.position.set(x, 0.51, 0)
    g.add(post)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), M.white)
    cap.position.set(x, 1.04, 0)
    g.add(cap)
  }
  for (const y of [0.34, 0.7]) {
    const plank = box(half * 2, 0.15, 0.1, pick(rnd, [M.white, M.mint, M.lemon]))
    plank.position.y = y
    g.add(plank)
  }
  return { scene: bake(g), footprint: half + 0.09, height: 1.12 }
}

/** Candy column: fluted shaft, white collar, gold ball. */
function column(): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.16, 12), M.white)
  base.position.y = 0.08
  g.add(base)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.5, 12), M.mint)
  shaft.position.y = 0.9
  g.add(shaft)
  for (const y of [0.55, 1.05, 1.5]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.045, 5, 14), M.white)
    ring.position.y = y
    ring.rotation.x = Math.PI / 2
    g.add(ring)
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.14, 12), M.white)
  cap.position.y = 1.7
  g.add(cap)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), M.gold)
  ball.position.y = 1.94
  g.add(ball)
  return { scene: bake(g), footprint: 0.4, height: 2.16 }
}

/** Gumdrop barricade: a solid row of fat sweets on a white plinth, long axis X. */
function barricade(rnd: Rnd): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const tones = [M.candy, M.lemon, M.mint, M.sky, M.peach]
  const plinth = box(1.56, 0.14, 0.5, M.white)
  plinth.position.y = 0.07
  g.add(plinth)
  for (let i = 0; i < 4; i++) {
    const x = -0.57 + i * 0.38
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), pick(rnd, tones))
    body.scale.set(1, 0.86, 0.9)
    body.position.set(x, 0.36, 0)
    g.add(body)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 10), M.white)
    tip.position.set(x, 0.6, 0)
    g.add(tip)
  }
  return { scene: bake(g), footprint: 0.78, height: 0.82 }
}

/** Squat berry bush: three mint blobs and a few candy dots. */
const BUSH_TONES: MatKey[] = ['mint', 'leaf', 'mint', 'leaf']

function bush(rnd: Rnd, i: number): CoverAsset {
  const M = materials()
  const g = new THREE.Group()
  const spots: [number, number, number, number][] = [
    [0, 0.34, 0, 0.38],
    [0.32, 0.24, 0.14, 0.27],
    [-0.26, 0.22, -0.12, 0.24],
  ]
  for (const [x, y, z, r] of spots) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), M[BUSH_TONES[i % BUSH_TONES.length]])
    blob.position.set(x, y, z)
    g.add(blob)
  }
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), pick(rnd, [M.candy, M.lemon, M.white]))
    dot.position.set((rnd() - 0.5) * 0.6, 0.42 + rnd() * 0.16, (rnd() - 0.5) * 0.5)
    g.add(dot)
  }
  return { scene: bake(g), footprint: 0.52, height: 0.68 }
}

const BUILDERS: Record<CoverKind, (rnd: Rnd, i: number) => CoverAsset> = {
  tree: (_rnd, i) => tree(i),
  rock: (rnd) => rock(rnd),
  block: (rnd) => crate(rnd),
  wall: (rnd) => wall(rnd),
  column: () => column(),
  barricade: (rnd) => barricade(rnd),
  bush: (rnd, i) => bush(rnd, i),
}

/** How many colour variants each kind gets. Cheap: variants share one material. */
const VARIANTS: Record<CoverKind, number> = {
  tree: 6,
  rock: 3,
  block: 3,
  wall: 3,
  column: 2,
  barricade: 3,
  bush: 4,
}

export const COVER_KINDS: CoverKind[] = ['tree', 'rock', 'block', 'wall', 'column', 'barricade', 'bush']

export function buildCoverSet(rnd: Rnd): Map<CoverKind, CoverAsset[]> {
  const set = new Map<CoverKind, CoverAsset[]>()
  for (const kind of COVER_KINDS) {
    const list: CoverAsset[] = []
    for (let i = 0; i < VARIANTS[kind]; i++) list.push(BUILDERS[kind](rnd, i))
    set.set(kind, list)
  }
  return set
}
