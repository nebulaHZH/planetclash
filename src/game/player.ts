import * as THREE from 'three'
import { PHYSICS } from '../config'
import { surfaceRadius } from './world'
import type { Obstacle } from './props'
import type { Ladder } from './ladder'

export type MoveInput = {
  forward: number
  strafe: number
  sprint: boolean
  aim: boolean
  /** Held down: keeps the jump tall. Tapping gives a short hop. */
  jumpHeld: boolean
  /** Ladder the player is standing next to, if any. */
  ladder: Ladder | null
}

const _up = new THREE.Vector3(0, 1, 0)
const _away = new THREE.Vector3()
/** Steeper than this and you need the ladder. */
const MAX_SLOPE = 1.15
const CLIMB_SPEED = 2.9

export class Player {
  dir = new THREE.Vector3(0, 1, 0)
  heading = new THREE.Vector3(1, 0, 0)
  pitch = 0
  alt = 0
  velY = 0
  grounded = true
  alive = true
  health = 3
  maxHealth = 3
  speedMult = 1
  stamina = 1
  moveVel = new THREE.Vector3()
  bobPhase = 0
  landDip = 0
  landImpact = 0
  jumpedThisFrame = false
  moving = false
  speedNorm = 0
  obstacles: Obstacle[] = []
  /** Set while hanging on a ladder; `alt` is then the height up the rails. */
  climbing: Ladder | null = null
  private sprintLock = false
  private regenDelay = 0
  private jumpBuffer = 0
  private coyote = 0
  private cutApplied = true

  constructor(spawn: THREE.Vector3) {
    this.reset(spawn, 3, 1)
  }

  reset(spawn: THREE.Vector3, maxHealth: number, speedMult: number) {
    this.dir.copy(spawn).normalize()
    // face east along the latitude line so the spawn view looks into the map
    const lon = Math.atan2(this.dir.z, this.dir.x)
    this.heading.set(-Math.sin(lon), 0, Math.cos(lon)).projectOnPlane(this.dir)
    if (this.heading.lengthSq() < 0.001) this.heading.copy(_up).cross(this.dir)
    this.heading.normalize()
    this.pitch = -0.03
    this.alt = 0
    this.velY = 0
    this.grounded = true
    this.alive = true
    this.maxHealth = maxHealth
    this.health = maxHealth
    this.speedMult = speedMult
    this.stamina = 1
    this.sprintLock = false
    this.regenDelay = 0
    this.moveVel.set(0, 0, 0)
    this.bobPhase = 0
    this.landDip = 0
    this.landImpact = 0
    this.jumpedThisFrame = false
    this.jumpBuffer = 0
    this.coyote = 0
    this.cutApplied = true
    this.climbing = null
  }

  get surface() {
    return surfaceRadius(this.dir)
  }

  get feet() {
    return this.dir.clone().multiplyScalar(this.surface + this.alt)
  }

  get eye() {
    return this.dir.clone().multiplyScalar(this.surface + this.alt + PHYSICS.eyeHeight)
  }

  look(dx: number, dy: number, sensitivity: number, aiming: boolean) {
    const factor = sensitivity * (aiming ? 0.62 : 1)
    this.heading.applyAxisAngle(this.dir, -dx * factor)
    this.heading.addScaledVector(this.dir, -this.heading.dot(this.dir)).normalize()
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * factor, -1.42, 1.42)
  }

  jump() {
    this.jumpBuffer = 0.14
  }

  /** Highest solid top under the feet, or 0 for the terrain itself. */
  private supportLevel() {
    if (this.obstacles.length === 0) return 0
    let best = 0
    for (const obstacle of this.obstacles) {
      // Too tall to be a floor from here: it is a wall, and `collide` handles it.
      if (obstacle.height > this.alt + 0.35) continue
      if (obstacle.height <= best) continue
      const dot = THREE.MathUtils.clamp(this.dir.dot(obstacle.dir), -1, 1)
      if (Math.acos(dot) * PHYSICS.radius > obstacle.radius + 0.3) continue
      best = obstacle.height
    }
    return best
  }

  update(dt: number, input: MoveInput) {
    this.jumpedThisFrame = false
    if (!this.alive) {
      this.moveVel.multiplyScalar(1 - Math.min(1, dt * 8))
      return
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    if (this.climbing) {
      this.climbUpdate(dt, input)
      return
    }

    const up = this.dir
    const right = this.heading.clone().cross(up).normalize()
    const wish = new THREE.Vector3()
      .addScaledVector(this.heading, input.forward)
      .addScaledVector(right, input.strafe)
    if (wish.lengthSq() > 1) wish.normalize()
    this.moving = wish.lengthSq() > 0.002

    const wantSprint = input.sprint && input.forward > 0.15 && this.stamina > 0 && !this.sprintLock
    if (wantSprint) {
      this.stamina = Math.max(0, this.stamina - dt * 0.3)
      this.regenDelay = 0.7
      if (this.stamina <= 0) this.sprintLock = true
    } else {
      this.regenDelay -= dt
      if (this.regenDelay <= 0) {
        this.stamina = Math.min(1, this.stamina + dt * 0.24)
        if (this.stamina > 0.25) this.sprintLock = false
      }
    }
    const sprinting = wantSprint

    let speed = PHYSICS.walkSpeed * this.speedMult
    if (sprinting) speed = PHYSICS.sprintSpeed * this.speedMult
    if (input.aim) speed = Math.min(speed, PHYSICS.aimSpeed * this.speedMult)

    const target = wish.multiplyScalar(speed)
    const accel = this.grounded ? 15 : 4.5
    this.moveVel.lerp(target, 1 - Math.exp(-accel * dt))
    this.speedNorm = Math.min(1, this.moveVel.length() / PHYSICS.sprintSpeed)

    const startRadius = this.surface + this.alt
    const distance = this.moveVel.length() * dt
    if (distance > 1e-6) {
      const tangent = this.moveVel.clone().normalize()
      const oldUp = this.dir.clone()
      const oldHeading = this.heading.clone()
      const next = oldUp.clone().addScaledVector(tangent, distance / this.surface).normalize()
      const transport = new THREE.Quaternion().setFromUnitVectors(oldUp, next)
      this.heading.applyQuaternion(transport)
      this.dir.copy(next)
      this.heading.addScaledVector(this.dir, -this.heading.dot(this.dir))
      if (this.heading.lengthSq() < 0.001) this.heading.set(1, 0, 0).projectOnPlane(this.dir)
      this.heading.normalize()

      // Walking keeps the feet at the same world height while the ground moves
      // under them, which is what makes stepping off a pit rim a real fall.
      const surf = surfaceRadius(this.dir)
      if (this.grounded && surf - startRadius > distance * MAX_SLOPE + 0.06) {
        // A wall of dirt: refuse the step instead of teleporting up it.
        this.dir.copy(oldUp)
        this.heading.copy(oldHeading)
        this.moveVel.multiplyScalar(0.15)
      } else {
        this.alt = startRadius - surf
      }
    }

    if (input.ladder && this.grounded && input.forward > 0.3) {
      if (input.ladder.dir.angleTo(this.dir) * PHYSICS.radius < 1.5) {
        this.attach(input.ladder)
        return
      }
    }

    // Crates, fence rails and barricades are standable: anything solid under
    // the feet becomes the floor, so the jump can get you on top of them.
    const floor = this.supportLevel()

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.jumpBuffer = 0
      this.coyote = 0
      this.grounded = false
      this.cutApplied = false
      this.velY = PHYSICS.jumpSpeed
      this.alt = Math.max(this.alt, floor) + 0.02
      this.jumpedThisFrame = true
    }

    // Letting go early trims the arc, which is most of what sells the weight.
    if (!this.cutApplied && !input.jumpHeld && this.velY > 0) {
      this.velY *= PHYSICS.jumpCut
      this.cutApplied = true
    }

    if (!this.grounded) {
      const pull = this.velY > 0 ? PHYSICS.gravity : PHYSICS.gravityFall
      this.velY = Math.max(-PHYSICS.terminal, this.velY - pull * dt)
      this.alt += this.velY * dt
      if (this.velY <= 0 && this.alt <= floor) {
        this.landImpact = Math.abs(this.velY)
        this.alt = floor
        this.velY = 0
        this.grounded = true
        this.landDip = Math.min(0.32, this.landImpact * 0.032)
      }
    } else if (this.alt > floor + 0.04) {
      // Stepped off a ledge: fall instead of dragging the floor up with us.
      this.grounded = false
      this.velY = 0
    } else {
      this.alt = floor
      this.velY = 0
    }

    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt)
    this.collide()

    this.landDip += (0 - this.landDip) * Math.min(1, dt * 11)

    if (this.grounded && this.moving) {
      this.bobPhase += dt * (6 + this.moveVel.length() * 0.75)
    } else if (!this.grounded) {
      this.bobPhase += dt * 2
    }
  }

  private attach(ladder: Ladder) {
    const feet = this.surface + this.alt
    this.climbing = ladder
    this.dir.copy(ladder.dir)
    this.alt = THREE.MathUtils.clamp(feet - ladder.base, 0, ladder.top - ladder.base - 0.05)
    this.velY = 0
    this.grounded = true
    this.moveVel.set(0, 0, 0)
    this.moving = false
    this.speedNorm = 0
    this.heading.addScaledVector(this.dir, -this.heading.dot(this.dir))
    if (this.heading.lengthSq() < 1e-6) this.heading.set(1, 0, 0).projectOnPlane(this.dir)
    this.heading.normalize()
  }

  private climbUpdate(dt: number, input: MoveInput) {
    const ladder = this.climbing
    if (!ladder) return
    const top = ladder.top - ladder.base
    this.moveVel.set(0, 0, 0)
    this.moving = false
    this.speedNorm = 0
    this.velY = 0

    if (this.jumpBuffer > 0) {
      // Let go and drop back down.
      this.jumpBuffer = 0
      this.climbing = null
      this.grounded = false
      this.velY = 2.4
      return
    }

    this.dir.copy(ladder.dir)
    this.alt += input.forward * CLIMB_SPEED * dt
    if (this.alt >= top) {
      // Step off onto the rim.
      this.dir.copy(ladder.exitDir)
      this.alt = 0
      this.grounded = true
      this.climbing = null
      this.jumpedThisFrame = true
      return
    }
    if (this.alt <= 0) {
      this.alt = 0
      this.grounded = true
      this.climbing = null
    }
  }

  /** Push the capsule out of solid props along the great circle. */
  private collide() {
    if (this.obstacles.length === 0) return
    for (let pass = 0; pass < 2; pass++) {
      for (const obstacle of this.obstacles) {
        // Above the top: this is a floor now, not a wall.
        if (this.alt >= obstacle.height - 0.15) continue
        const dot = THREE.MathUtils.clamp(this.dir.dot(obstacle.dir), -1, 1)
        const arc = Math.acos(dot) * PHYSICS.radius
        const min = obstacle.radius + 0.42
        if (arc >= min) continue
        _away.copy(this.dir).addScaledVector(obstacle.dir, -dot)
        if (_away.lengthSq() < 1e-8) _away.set(1, 0, 0).projectOnPlane(this.dir)
        _away.normalize()
        this.dir.addScaledVector(_away, (min - arc) / PHYSICS.radius).normalize()
        this.heading.addScaledVector(this.dir, -this.heading.dot(this.dir))
        if (this.heading.lengthSq() < 1e-6) this.heading.set(1, 0, 0).projectOnPlane(this.dir)
        this.heading.normalize()
        const into = this.moveVel.dot(_away)
        if (into < 0) this.moveVel.addScaledVector(_away, -into)
      }
    }
  }
}
