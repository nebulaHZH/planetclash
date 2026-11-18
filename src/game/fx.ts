import * as THREE from 'three'
import { COLORS, GAME } from '../config'
import { radialTexture } from './toon'

type Particle = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
  size: number
  color: THREE.Color
}

type Confetti = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  quat: THREE.Quaternion
  spin: THREE.Vector3
  life: number
  maxLife: number
  color: THREE.Color
}

type Tracer = {
  a: THREE.Vector3
  b: THREE.Vector3
  life: number
  maxLife: number
  color: THREE.Color
}

type Ring = {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  life: number
  maxLife: number
  size: number
}

type Flash = {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  life: number
  maxLife: number
  size: number
}

const _dummy = new THREE.Object3D()
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)

const PALETTE = [COLORS.candy, COLORS.mint, COLORS.lemon, COLORS.sky, COLORS.white, COLORS.gold]

export class Fx {
  private particles: Particle[] = []
  private particleMesh: THREE.InstancedMesh
  private confettiPieces: Confetti[] = []
  private confettiMesh: THREE.InstancedMesh
  private tracers: Tracer[] = []
  private tracerMesh: THREE.InstancedMesh
  private rings: Ring[] = []
  private flashes: Flash[] = []
  private flashTexture: THREE.Texture

  constructor(private scene: THREE.Scene) {
    const particleMaterial = new THREE.MeshBasicMaterial({ color: COLORS.white })
    this.particleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), particleMaterial, GAME.maxParticles)
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.particleMesh.frustumCulled = false
    this.particleMesh.count = 0
    scene.add(this.particleMesh)

    const confettiMaterial = new THREE.MeshBasicMaterial({ color: COLORS.white, side: THREE.DoubleSide })
    this.confettiMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.03, 0.24), confettiMaterial, 240)
    this.confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.confettiMesh.frustumCulled = false
    this.confettiMesh.count = 0
    scene.add(this.confettiMesh)

    const tracerGeo = new THREE.BoxGeometry(0.045, 0.045, 1)
    this.tracerMesh = new THREE.InstancedMesh(tracerGeo, new THREE.MeshBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }), 32)
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.tracerMesh.frustumCulled = false
    this.tracerMesh.count = 0
    scene.add(this.tracerMesh)

    const ringGeo = new THREE.RingGeometry(0.86, 1, 40)
    ringGeo.rotateX(-Math.PI / 2)
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: COLORS.lemon, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      const mesh = new THREE.Mesh(ringGeo, mat)
      mesh.visible = false
      mesh.raycast = () => {}
      scene.add(mesh)
      this.rings.push({ mesh, mat, life: 0, maxLife: 1, size: 1 })
    }

    this.flashTexture = radialTexture(128, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0.3)')
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.flashTexture, color: COLORS.lemon, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      sprite.visible = false
      scene.add(sprite)
      this.flashes.push({ sprite, mat, life: 0, maxLife: 1, size: 1 })
    }
  }

  burst(pos: THREE.Vector3, count: number, opts: { colors?: string[]; speed?: number; size?: number; life?: number; up?: THREE.Vector3 } = {}) {
    const colors = opts.colors ?? PALETTE
    const speed = opts.speed ?? 4
    const size = opts.size ?? 0.09
    const life = opts.life ?? 0.5
    const up = opts.up ?? pos.clone().normalize()
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= GAME.maxParticles) this.particles.shift()
      const vel = _v.randomDirection().multiplyScalar(speed * (0.35 + Math.random()))
      vel.addScaledVector(up, speed * 0.5)
      this.particles.push({
        pos: pos.clone(),
        vel: vel.clone(),
        life: life * (0.6 + Math.random() * 0.7),
        maxLife: life,
        size: size * (0.55 + Math.random() * 0.8),
        color: new THREE.Color(colors[i % colors.length]),
      })
    }
  }

  confettiBurst(pos: THREE.Vector3, up: THREE.Vector3, count = 42) {
    for (let i = 0; i < count; i++) {
      if (this.confettiPieces.length >= 240) this.confettiPieces.shift()
      const tangent = new THREE.Vector3().randomDirection()
      tangent.addScaledVector(up, -tangent.dot(up)).normalize()
      const vel = tangent.multiplyScalar(2 + Math.random() * 4)
      vel.addScaledVector(up, 3 + Math.random() * 4)
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28))
      this.confettiPieces.push({
        pos: pos.clone(),
        vel,
        quat: q,
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        life: 1.1 + Math.random() * 0.5,
        maxLife: 1.6,
        color: new THREE.Color(PALETTE[i % PALETTE.length]),
      })
    }
  }

  marbles(pos: THREE.Vector3, up: THREE.Vector3) {
    this.burst(pos, 14, { colors: [COLORS.candy, COLORS.mint, COLORS.sky, COLORS.lemon], speed: 5, size: 0.2, life: 0.7, up })
    this.ring(pos, up, COLORS.white, 1.6)
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: string) {
    if (this.tracers.length >= 32) this.tracers.shift()
    this.tracers.push({ a: a.clone(), b: b.clone(), life: 0.075, maxLife: 0.075, color: new THREE.Color(color) })
  }

  ring(pos: THREE.Vector3, up: THREE.Vector3, color: string, size = 1.4) {
    const slot = this.rings.find((r) => r.life <= 0)
    if (!slot) return
    slot.life = 0.5
    slot.maxLife = 0.5
    slot.size = size
    slot.mat.color.set(color)
    slot.mesh.position.copy(pos)
    slot.mesh.quaternion.setFromUnitVectors(_up, up)
    slot.mesh.visible = true
  }

  flash(pos: THREE.Vector3, color: string, size = 1) {
    const slot = this.flashes.find((f) => f.life <= 0)
    if (!slot) return
    slot.life = 0.2
    slot.maxLife = 0.2
    slot.size = size
    slot.mat.color.set(color)
    slot.sprite.position.copy(pos)
    slot.sprite.visible = true
    slot.sprite.scale.setScalar(size)
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, color: string) {
    this.burst(pos.addScaledVector(normal, 0.06), 6, { colors: [color, COLORS.white], speed: 3.2, size: 0.075, life: 0.34, up: normal })
    this.flash(pos, color, 0.7)
  }

  reset() {
    this.particles.length = 0
    this.confettiPieces.length = 0
    this.tracers.length = 0
    for (const ring of this.rings) {
      ring.life = 0
      ring.mesh.visible = false
    }
    for (const flash of this.flashes) {
      flash.life = 0
      flash.sprite.visible = false
    }
    this.particleMesh.count = 0
    this.confettiMesh.count = 0
    this.tracerMesh.count = 0
  }

  update(dt: number) {
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1]
        this.particles.pop()
        continue
      }
      _v.copy(p.pos).normalize()
      p.vel.addScaledVector(_v, -7 * dt)
      p.vel.multiplyScalar(1 - 1.6 * dt)
      p.pos.addScaledVector(p.vel, dt)
      const surface = p.pos.length()
      if (surface < 40) {
        p.pos.setLength(40)
        p.vel.multiplyScalar(0.3)
      }
    }
    this.particleMesh.count = this.particles.length
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      _dummy.position.copy(p.pos)
      _dummy.quaternion.identity()
      _dummy.scale.setScalar(p.size * Math.min(1, p.life / (p.maxLife * 0.5)))
      _dummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, _dummy.matrix)
      this.particleMesh.setColorAt(i, p.color)
    }
    this.particleMesh.instanceMatrix.needsUpdate = true
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true

    // confetti
    for (let i = this.confettiPieces.length - 1; i >= 0; i--) {
      const c = this.confettiPieces[i]
      c.life -= dt
      if (c.life <= 0) {
        this.confettiPieces[i] = this.confettiPieces[this.confettiPieces.length - 1]
        this.confettiPieces.pop()
        continue
      }
      _v.copy(c.pos).normalize()
      c.vel.addScaledVector(_v, -5 * dt)
      c.pos.addScaledVector(c.vel, dt)
      _q.setFromEuler(new THREE.Euler(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt))
      c.quat.multiply(_q)
    }
    this.confettiMesh.count = this.confettiPieces.length
    for (let i = 0; i < this.confettiPieces.length; i++) {
      const c = this.confettiPieces[i]
      _dummy.position.copy(c.pos)
      _dummy.quaternion.copy(c.quat)
      _dummy.scale.setScalar(Math.min(1, c.life / 0.4))
      _dummy.updateMatrix()
      this.confettiMesh.setMatrixAt(i, _dummy.matrix)
      this.confettiMesh.setColorAt(i, c.color)
    }
    this.confettiMesh.instanceMatrix.needsUpdate = true
    if (this.confettiMesh.instanceColor) this.confettiMesh.instanceColor.needsUpdate = true

    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]
      t.life -= dt
      if (t.life <= 0) {
        this.tracers[i] = this.tracers[this.tracers.length - 1]
        this.tracers.pop()
      }
    }
    this.tracerMesh.count = this.tracers.length
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i]
      const length = t.a.distanceTo(t.b)
      _dummy.position.copy(t.a).add(t.b).multiplyScalar(0.5)
      _dummy.lookAt(t.b)
      const fade = t.life / t.maxLife
      _dummy.scale.set(fade, fade, length)
      _dummy.updateMatrix()
      this.tracerMesh.setMatrixAt(i, _dummy.matrix)
      this.tracerMesh.setColorAt(i, t.color)
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true

    // rings
    for (const ring of this.rings) {
      if (ring.life <= 0) continue
      ring.life -= dt
      if (ring.life <= 0) {
        ring.mesh.visible = false
        continue
      }
      const t = 1 - ring.life / ring.maxLife
      ring.mesh.scale.setScalar(ring.size * (0.35 + t * 1.1))
      ring.mat.opacity = (1 - t) * 0.75
    }

    // flashes
    for (const flash of this.flashes) {
      if (flash.life <= 0) continue
      flash.life -= dt
      if (flash.life <= 0) {
        flash.sprite.visible = false
        continue
      }
      const t = flash.life / flash.maxLife
      flash.mat.opacity = t
      flash.sprite.scale.setScalar(flash.size * (1.4 - t * 0.4))
    }
  }
}
