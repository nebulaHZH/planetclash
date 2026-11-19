import * as THREE from 'three'
import { toon } from './toon'
import { bakeGroup, bakedMaterial } from './bake'
import { surfaceRadius } from './world'

/**
 * Toy wooden ladders. They are placed by the player at the bottom of a dug pit
 * and always stand along the radial, so climbing them is just "walk up in alt".
 */
export type Ladder = {
  group: THREE.Group
  /** Unit direction of the foot. */
  dir: THREE.Vector3
  /** Radius of the foot. */
  base: number
  /** Radius the top of the rails reaches — always a little above the rim. */
  top: number
  /** Direction to step off onto once the top is reached. */
  exitDir: THREE.Vector3
}

const MAX_LADDERS = 10

const _d = new THREE.Vector3()
const _e1 = new THREE.Vector3()
const _e2 = new THREE.Vector3()

export class LadderField {
  readonly group = new THREE.Group()
  readonly ladders: Ladder[] = []

  constructor() {
    this.group.name = 'ladders'
  }

  /**
   * Stand a ladder at `dir`. Height is measured from the pit floor to the
   * highest ground within a few metres, so a deep pit gets a tall ladder.
   * `baseHint` pins the foot (used when the spot is under a roof, where the
   * sky-march only finds the grass on top).
   */
  place(dir: THREE.Vector3, baseHint?: number): Ladder | null {
    if (this.ladders.length >= MAX_LADDERS) return null
    const foot = dir.clone().normalize()
    // One per spot.
    if (this.nearest(foot, 1.1)) return null

    const base = baseHint ?? surfaceRadius(foot)
    let best = base
    const exitDir = foot.clone()
    _e1.crossVectors(foot, Math.abs(foot.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
    _e2.crossVectors(foot, _e1).normalize()
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2
      for (let dist = 0.6; dist <= 4.5; dist += 0.6) {
        const arc = dist / 96
        _d.copy(foot).multiplyScalar(Math.cos(arc))
          .addScaledVector(_e1, Math.sin(a) * Math.sin(arc))
          .addScaledVector(_e2, Math.cos(a) * Math.sin(arc))
          .normalize()
        const r = surfaceRadius(_d)
        if (r > best) {
          best = r
          exitDir.copy(_d)
        }
      }
    }
    const height = THREE.MathUtils.clamp(best - base + 0.55, 1.7, 13)
    const top = base + height

    const group = new THREE.Group()
    group.name = 'ladder'
    group.position.copy(foot).multiplyScalar(base)
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot)
    group.add(this.build(height))
    this.group.add(group)

    const ladder: Ladder = { group, dir: foot, base, top, exitDir }
    this.ladders.push(ladder)
    return ladder
  }

  private build(height: number) {
    const wood = toon('#D9A273')
    const woodDeep = toon('#B9814F')
    const rung = toon('#EBC493')
    const parts = new THREE.Group()
    const rail = 0.075
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(rail, height, rail), wood)
      bar.position.set(side * 0.24, height / 2, 0)
      parts.add(bar)
      // Little candy caps so the top reads from a distance.
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), toon('#FF7FA8'))
      cap.position.set(side * 0.24, height, 0)
      parts.add(cap)
    }
    const count = Math.max(2, Math.round(height / 0.38))
    for (let i = 1; i < count; i++) {
      const y = (i / count) * height
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.055, 0.075), rung)
      bar.position.set(0, y, 0)
      parts.add(bar)
    }
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.09, 0.3), woodDeep)
    foot.position.y = 0.045
    parts.add(foot)

    const mesh = bakeGroup(parts, bakedMaterial())
    mesh.castShadow = true
    parts.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
    return mesh
  }

  /** Closest ladder the player could grab from `dir`, measured on the surface. */
  nearest(dir: THREE.Vector3, max = 1.5): Ladder | null {
    let best: Ladder | null = null
    let bestD = max
    for (const ladder of this.ladders) {
      const d = ladder.dir.angleTo(dir) * 96
      if (d < bestD) {
        bestD = d
        best = ladder
      }
    }
    return best
  }

  reset() {
    for (const ladder of this.ladders) {
      this.group.remove(ladder.group)
      ladder.group.traverse((child) => {
        const m = child as THREE.Mesh
        if (m.isMesh) m.geometry.dispose()
      })
    }
    this.ladders.length = 0
  }
}
