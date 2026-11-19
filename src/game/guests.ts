import * as THREE from 'three'
import { toon } from './toon'
import { bakeGroup, ownedMaterial } from './bake'

/**
 * Three hand-built guest characters: the cartoon mascots the roster was
 * missing. They are plain primitives baked into six vertex-coloured parts
 * (torso, head, two arms, two legs) so one character costs six draw calls and
 * one material, which `ToonRig` can flash on hit.
 *
 * Everything is authored facing +Z with the origin between the feet, matching
 * the KayKit rigs that `enemies.ts` and `world.ts` already position.
 */

export type GuestModel = 'Chiikawa' | 'Nailong' | 'GGBond' | 'Usagi'

export type GuestBuild = {
  group: THREE.Group
  /** Everything above the feet: bob, lean and topple this. */
  body: THREE.Group
  head: THREE.Group
  arms: THREE.Group[]
  legs: THREE.Group[]
  /** Arm-mounted gun socket, already pointing +Z. */
  hands: THREE.Group
  height: number
  material: THREE.MeshToonMaterial
}

const PAL = {
  white: '#FFFDF8',
  cream: '#FFF3DC',
  butter: '#FFD375',
  butterDeep: '#F5C46B',
  pig: '#F9BCC8',
  pigDeep: '#F29CB0',
  pink: '#FFB4C8',
  rose: '#F58AA4',
  candy: '#FF7FA8',
  red: '#E8574C',
  redDeep: '#C63F3C',
  gold: '#FFD34D',
  ink: '#2B1B2F',
  blush: '#FF9EBB',
  sky: '#9EDCFF',
}

let mats: Record<keyof typeof PAL, THREE.MeshToonMaterial> | null = null
function paint() {
  if (mats) return mats
  const out = {} as Record<keyof typeof PAL, THREE.MeshToonMaterial>
  for (const key of Object.keys(PAL) as (keyof typeof PAL)[]) out[key] = toon(PAL[key])
  mats = out
  return out
}

const M = () => paint()

/** Round blob: a sphere with independent x/y/z radii. */
function blob(
  g: THREE.Object3D,
  m: THREE.Material,
  r: [number, number, number],
  at: [number, number, number],
  seg = 16,
) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), m)
  mesh.scale.set(r[0], r[1], r[2])
  mesh.position.set(at[0], at[1], at[2])
  g.add(mesh)
  return mesh
}

function cone(g: THREE.Object3D, m: THREE.Material, r: number, h: number, at: [number, number, number], rot?: [number, number, number], seg = 10) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m)
  mesh.position.set(at[0], at[1], at[2])
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2])
  g.add(mesh)
  return mesh
}

function capsule(g: THREE.Object3D, m: THREE.Material, r: number, len: number, at: [number, number, number]) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), m)
  mesh.position.set(at[0], at[1], at[2])
  g.add(mesh)
  return mesh
}

type Spec = {
  height: number
  headY: number
  shoulder: [number, number]
  hip: [number, number]
  torso(g: THREE.Group): void
  head(g: THREE.Group): void
  arm(g: THREE.Group, side: number): void
  leg(g: THREE.Group, side: number): void
}

/** Pivot, bake, assemble. Each callback draws around its own pivot origin. */
function assemble(spec: Spec): GuestBuild {
  const material = ownedMaterial()
  // Bake the primitives into one mesh and drop the originals: leaving them in
  // would draw every limb twice.
  const baked = (g: THREE.Group) => {
    const mesh = bakeGroup(g, material)
    g.clear()
    g.add(mesh)
  }
  const group = new THREE.Group()
  // Parts are drawn at their pivot, baked, then moved into place, so the bake
  // never folds the pivot offset into the geometry.
  const head = new THREE.Group()
  head.userData.head = true
  spec.head(head)
  baked(head)
  head.position.y = spec.headY

  const arms: THREE.Group[] = []
  const legs: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const arm = new THREE.Group()
    spec.arm(arm, side)
    baked(arm)
    arm.position.set(side * spec.shoulder[0], spec.shoulder[1], 0)
    arms.push(arm)

    const leg = new THREE.Group()
    spec.leg(leg, side)
    baked(leg)
    leg.position.set(side * spec.hip[0], spec.hip[1], 0)
    legs.push(leg)
  }

  const body = new THREE.Group()
  spec.torso(body)
  baked(body)
  body.add(head, ...arms, ...legs)

  const hands = new THREE.Group()
  hands.position.set(0.16, spec.height * 0.36, 0.3)
  group.add(body, hands)
  return { group, body, head, arms, legs, hands, height: spec.height, material }
}

/* ---------------------------------------------------------------- 吉伊卡哇 */

function chiikawa(): GuestBuild {
  const m = M()
  return assemble({
    height: 1.36,
    // Head pivot sits high on purpose: the big skull overlaps the belly so the
    // two blobs read as one pear-shaped body, the way the mascot is drawn.
    headY: 0.9,
    shoulder: [0.31, 0.58],
    hip: [0.14, 0.14],
    torso(g) {
      blob(g, m.white, [0.33, 0.34, 0.3], [0, 0.44, 0], 22)
    },
    head(g) {
      blob(g, m.white, [0.4, 0.395, 0.375], [0, 0, 0], 26)
      // small round ears, set wide, tips leaning out
      for (const side of [-1, 1]) {
        const ear = cone(g, m.white, 0.1, 0.22, [side * 0.25, 0.34, -0.01], [0, 0, -side * 0.34], 16)
        ear.scale.set(1, 1, 0.72)
      }
      // eyes: two small black ovals with a highlight
      for (const side of [-1, 1]) {
        blob(g, m.ink, [0.05, 0.062, 0.04], [side * 0.105, 0.02, 0.355], 14)
        blob(g, m.white, [0.017, 0.019, 0.012], [side * 0.088, 0.048, 0.388], 8)
      }
      // the wide oval blush is half the character
      for (const side of [-1, 1]) {
        blob(g, m.blush, [0.082, 0.055, 0.03], [side * 0.235, -0.055, 0.3], 14)
      }
      // tiny "w" mouth
      for (const side of [-1, 1]) {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 12, Math.PI), m.ink)
        arc.position.set(side * 0.022, -0.075, 0.378)
        arc.rotation.set(0, side * 0.4, Math.PI)
        g.add(arc)
      }
    },
    arm(g) {
      capsule(g, m.white, 0.062, 0.1, [0, -0.08, 0])
      blob(g, m.white, [0.075, 0.07, 0.07], [0, -0.18, 0.01], 12)
    },
    leg(g) {
      blob(g, m.white, [0.095, 0.06, 0.12], [0, -0.04, 0.03], 12)
    },
  })
}

/* ------------------------------------------------------------------- 奶龙 */

function nailong(): GuestBuild {
  const m = M()
  return assemble({
    height: 1.62,
    headY: 1.2,
    shoulder: [0.32, 0.84],
    hip: [0.15, 0.34],
    torso(g) {
      blob(g, m.butter, [0.36, 0.37, 0.34], [0, 0.66, 0], 20)
      blob(g, m.cream, [0.26, 0.26, 0.16], [0, 0.6, 0.22], 16)
      // stubby wings
      for (const side of [-1, 1]) {
        const wing = blob(g, m.cream, [0.16, 0.2, 0.06], [side * 0.3, 0.78, -0.24], 12)
        wing.rotation.set(0, side * 0.5, side * -0.35)
      }
      // tail curling behind
      const tail = cone(g, m.butter, 0.13, 0.42, [0, 0.5, -0.36], [1.9, 0, 0])
      tail.scale.set(1, 1, 1)
      blob(g, m.cream, [0.1, 0.1, 0.1], [0, 0.34, -0.5], 10)
    },
    head(g) {
      blob(g, m.butter, [0.4, 0.37, 0.38], [0, 0, 0], 20)
      // rounded snout
      blob(g, m.cream, [0.22, 0.16, 0.17], [0, -0.1, 0.31], 16)
      blob(g, m.ink, [0.025, 0.02, 0.02], [-0.07, -0.1, 0.45], 8)
      blob(g, m.ink, [0.025, 0.02, 0.02], [0.07, -0.1, 0.45], 8)
      // big eyes
      for (const side of [-1, 1]) {
        blob(g, m.ink, [0.075, 0.085, 0.045], [side * 0.17, 0.05, 0.33], 14)
        blob(g, m.white, [0.026, 0.03, 0.02], [side * 0.19, 0.09, 0.36], 8)
      }
      // horns
      cone(g, m.cream, 0.09, 0.3, [-0.17, 0.36, -0.02], [0, 0, 0.4])
      cone(g, m.cream, 0.09, 0.3, [0.17, 0.36, -0.02], [0, 0, -0.4])
      // cheek blush
      blob(g, m.blush, [0.07, 0.045, 0.03], [-0.27, -0.1, 0.26], 10)
      blob(g, m.blush, [0.07, 0.045, 0.03], [0.27, -0.1, 0.26], 10)
    },
    arm(g) {
      capsule(g, m.butter, 0.085, 0.16, [0, -0.1, 0])
      blob(g, m.cream, [0.1, 0.1, 0.1], [0, -0.22, 0], 10)
    },
    leg(g) {
      capsule(g, m.butter, 0.11, 0.1, [0, -0.11, 0])
      blob(g, m.cream, [0.13, 0.075, 0.15], [0, -0.21, 0.04], 12)
    },
  })
}

/* ----------------------------------------------------------------- 猪猪侠 */

function ggbond(): GuestBuild {
  const m = M()
  /** Hemisphere shell: the red cowl sits on the skull without covering the face. */
  const dome = (g: THREE.Object3D, mat: THREE.Material, r: number, at: [number, number, number], sweep = 1.36) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 14, 0, Math.PI * 2, 0, sweep), mat)
    mesh.position.set(at[0], at[1], at[2])
    g.add(mesh)
    return mesh
  }

  return assemble({
    height: 1.5,
    headY: 1.05,
    shoulder: [0.29, 0.8],
    hip: [0.13, 0.34],
    torso(g) {
      blob(g, m.red, [0.3, 0.34, 0.29], [0, 0.6, 0], 20)
      // gold oval badge, sitting low on the belly the way the show draws it
      blob(g, m.gold, [0.115, 0.145, 0.05], [0, 0.53, 0.272], 14)
      // cowl collaring the neck and spilling down the back
      blob(g, m.redDeep, [0.27, 0.15, 0.2], [0, 0.86, -0.06], 16)
      blob(g, m.redDeep, [0.24, 0.1, 0.09], [0, 0.9, 0.14], 14)
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 20), m.redDeep)
      collar.position.set(0, 0.855, 0.02)
      collar.rotation.x = Math.PI / 2
      g.add(collar)
    },
    head(g) {
      blob(g, m.pig, [0.4, 0.375, 0.375], [0, 0, 0], 24)
      // pig ears sit outside the cowl, just below its rim
      for (const side of [-1, 1]) {
        const ear = cone(g, m.pig, 0.105, 0.24, [side * 0.35, 0.18, -0.03], [0.15, 0, side * 0.95], 12)
        ear.scale.set(1, 1, 0.62)
      }
      // red cowl: crown only, so the forehead stays pink like the show
      const cap = dome(g, m.red, 0.418, [0, 0.02, -0.01], 0.92)
      cap.scale.set(1, 1, 1.02)
      // the two tied flaps that give the head its silhouette
      for (const side of [-1, 1]) {
        const petal = blob(g, m.redDeep, [0.105, 0.15, 0.062], [side * 0.13, 0.4, 0.0], 12)
        petal.rotation.z = side * 0.7
        petal.rotation.x = -0.14
      }
      blob(g, m.redDeep, [0.062, 0.058, 0.062], [0, 0.36, 0.01], 10)
      // the cowl dips to a point in the middle of the brow, as drawn on air
      const notch = cone(g, m.red, 0.072, 0.105, [0, 0.253, 0.318], [Math.PI, 0, 0], 4)
      notch.scale.set(1, 1, 0.34)
      notch.rotation.y = Math.PI / 4
      // eyes: big cartoon ovals, tucked in above the snout
      for (const side of [-1, 1]) {
        blob(g, m.ink, [0.062, 0.08, 0.048], [side * 0.128, 0.045, 0.33], 14)
        blob(g, m.white, [0.024, 0.027, 0.016], [side * 0.108, 0.078, 0.365], 8)
      }
      // snout: a fat pink oval with two nostrils
      blob(g, m.pigDeep, [0.15, 0.105, 0.105], [0, -0.115, 0.305], 16)
      for (const side of [-1, 1]) {
        blob(g, m.ink, [0.026, 0.034, 0.02], [side * 0.05, -0.115, 0.398], 8)
      }
      // smile tucked under the snout
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 14, Math.PI), m.ink)
      smile.position.set(0, -0.235, 0.315)
      smile.rotation.set(0.3, 0, Math.PI)
      g.add(smile)
      for (const side of [-1, 1]) {
        blob(g, m.blush, [0.07, 0.045, 0.028], [side * 0.26, -0.1, 0.262], 12)
      }
    },
    arm(g) {
      capsule(g, m.red, 0.075, 0.14, [0, -0.09, 0])
      blob(g, m.gold, [0.092, 0.092, 0.092], [0, -0.21, 0.01], 12)
    },
    leg(g) {
      capsule(g, m.red, 0.09, 0.09, [0, -0.09, 0])
      blob(g, m.gold, [0.105, 0.07, 0.145], [0, -0.2, 0.045], 12)
    },
  })
}

export function isGuest(model: string): model is GuestModel {
  return model === 'Chiikawa' || model === 'Nailong' || model === 'GGBond' || model === 'Usagi'
}

export function buildGuest(model: GuestModel): GuestBuild {
  if (model === 'Nailong') return nailong()
  if (model === 'GGBond') return ggbond()
  return chiikawa()
}
