import * as THREE from 'three'
import { PHYSICS } from '../config'
import { surfaceRadius } from './world'

export type MoveInput = {
  forward: number
  strafe: number
  sprint: boolean
  aim: boolean
}

const _up = new THREE.Vector3(0, 1, 0)

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
  private sprintLock = false
  private regenDelay = 0
  private jumpQueued = false

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
    this.jumpQueued = false
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
    this.jumpQueued = true
  }

  update(dt: number, input: MoveInput) {
    this.jumpedThisFrame = false
    if (!this.alive) {
      this.moveVel.multiplyScalar(1 - Math.min(1, dt * 8))
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

    const distance = this.moveVel.length() * dt
    if (distance > 1e-6) {
      const tangent = this.moveVel.clone().normalize()
      const oldUp = this.dir.clone()
      const next = oldUp.clone().addScaledVector(tangent, distance / this.surface).normalize()
      const transport = new THREE.Quaternion().setFromUnitVectors(oldUp, next)
      this.heading.applyQuaternion(transport)
      this.dir.copy(next)
      this.heading.addScaledVector(this.dir, -this.heading.dot(this.dir))
      if (this.heading.lengthSq() < 0.001) this.heading.set(1, 0, 0).projectOnPlane(this.dir)
      this.heading.normalize()
    }

    if (this.jumpQueued) {
      this.jumpQueued = false
      if (this.grounded) {
        this.grounded = false
        this.velY = PHYSICS.jumpSpeed
        this.alt = 0.02
        this.jumpedThisFrame = true
      }
    }

    if (!this.grounded) {
      this.velY -= PHYSICS.gravity * dt
      this.alt += this.velY * dt
      if (this.alt <= 0) {
        this.landImpact = Math.abs(this.velY)
        this.alt = 0
        this.velY = 0
        this.grounded = true
        this.landDip = Math.min(0.32, this.landImpact * 0.032)
      }
    } else {
      this.alt = 0
      this.velY = 0
    }

    this.landDip += (0 - this.landDip) * Math.min(1, dt * 11)

    if (this.grounded && this.moving) {
      this.bobPhase += dt * (6 + this.moveVel.length() * 0.75)
    } else if (!this.grounded) {
      this.bobPhase += dt * 2
    }
  }
}
