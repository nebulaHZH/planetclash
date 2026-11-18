import * as THREE from 'three'
import { CHARACTERS, COLORS, type CharacterConfig } from '../config'
import {
  alertTexture,
  buildCharacter,
  flashCharacter,
  radialTexture,
  type CharacterBuild,
} from './toon'
import { dirFromLatLon, surfaceRadius } from './world'
import type { Fx } from './fx'
import type { GameAudio } from './audio'

type Bullet = {
  mesh: THREE.Mesh
  glow: THREE.Sprite
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  trail: number
  active: boolean
}

export type Enemy = {
  id: number
  config: CharacterConfig
  build: CharacterBuild
  group: THREE.Group
  anchor: THREE.Vector3
  health: number
  maxHealth: number
  phase: number
  alert: number
  cooldown: number
  flash: number
  punch: number
  defeated: boolean
  bar: THREE.Group
  barFill: THREE.Mesh
  alertSprite: THREE.Sprite
  up: THREE.Vector3
  pos: THREE.Vector3
}

const SPAWNS: [number, number][] = [
  [16, -8], [34, 12], [-24, 30], [-40, -12], [44, -38], [-14, -54], [10, -24],
]

const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const BAR_LOW = new THREE.Color(COLORS.candy)
const BAR_HIGH = new THREE.Color(COLORS.mint)
const _ab = new THREE.Vector3()
const _closest = new THREE.Vector3()

function _muzzle(enemy: Enemy) {
  return _v2.copy(enemy.pos).addScaledVector(enemy.up, 1.55)
}

/** Small planets hide things behind the horizon — enemies may not shoot through it. */
export function hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
  _ab.copy(b).sub(a)
  const t = THREE.MathUtils.clamp(-a.dot(_ab) / Math.max(1e-6, _ab.lengthSq()), 0, 1)
  _closest.copy(a).addScaledVector(_ab, t)
  return _closest.length() > surfaceRadius(_closest) + 0.5
}

export class EnemyManager {
  enemies: Enemy[] = []
  private bullets: Bullet[] = []
  private barBgMat = new THREE.MeshBasicMaterial({ color: COLORS.outline, transparent: true, opacity: 0.75 })
  private alertMap = alertTexture()
  private bulletMat = new THREE.MeshBasicMaterial({ color: COLORS.candy })
  private glowMat = new THREE.SpriteMaterial({
    map: radialTexture(64, 'rgba(255,190,220,0.95)', 'rgba(255,120,170,0.2)'),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  constructor(private scene: THREE.Scene, private fx: Fx, private audio: GameAudio) {
    SPAWNS.forEach(([lat, lon], index) => {
      const config = CHARACTERS[(index + 1) % CHARACTERS.length]
      const build = buildCharacter(config, { enemy: true })
      const group = build.group
      group.userData.enemyId = index
      const scale = config.health > 3 ? 1.12 : 1
      group.scale.setScalar(scale)
      this.scene.add(group)

      const bar = new THREE.Group()
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.2), this.barBgMat)
      bar.add(bg)
      const fillGeo = new THREE.PlaneGeometry(1.34, 0.12)
      fillGeo.translate(0.67, 0, 0)
      const fillMat = new THREE.MeshBasicMaterial({ color: config.accentColor })
      const fill = new THREE.Mesh(fillGeo, fillMat)
      fill.position.set(-0.67, 0, 0.01)
      bar.add(fill)
      bar.visible = false
      this.scene.add(bar)

      const alertSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.alertMap,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }))
      alertSprite.scale.setScalar(0.62)
      alertSprite.visible = false
      this.scene.add(alertSprite)

      const maxHealth = config.health > 3 ? 140 : 100
      this.enemies.push({
        id: index,
        config,
        build,
        group,
        anchor: dirFromLatLon(lat, lon),
        health: maxHealth,
        maxHealth,
        phase: Math.random() * 6.28,
        alert: 0,
        cooldown: 1.5 + Math.random() * 2.5,
        flash: 0,
        punch: 0,
        defeated: false,
        bar,
        barFill: fill,
        alertSprite,
        up: new THREE.Vector3(0, 1, 0),
        pos: new THREE.Vector3(),
      })
    })

    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), this.bulletMat)
      mesh.visible = false
      const glow = new THREE.Sprite(this.glowMat)
      glow.scale.setScalar(1.1)
      mesh.add(glow)
      this.scene.add(mesh)
      this.bullets.push({ mesh, glow, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, trail: 0, active: false })
    }
  }

  get aliveCount() {
    return this.enemies.filter((e) => !e.defeated).length
  }

  get total() {
    return this.enemies.length
  }

  hitGroups() {
    return this.enemies.filter((e) => !e.defeated).map((e) => e.group)
  }

  byId(id: number) {
    return this.enemies[id]
  }

  reset() {
    this.enemies.forEach((enemy, i) => {
      enemy.health = enemy.maxHealth
      enemy.defeated = false
      enemy.flash = 0
      enemy.punch = 0
      enemy.alert = 0
      enemy.cooldown = 2.4 + i * 0.4 + Math.random() * 2
      enemy.group.visible = true
      enemy.group.scale.setScalar(enemy.config.health > 3 ? 1.12 : 1)
      enemy.bar.visible = false
      enemy.alertSprite.visible = false
      flashCharacter(enemy.build, 0)
    })
    for (const bullet of this.bullets) {
      bullet.active = false
      bullet.mesh.visible = false
      bullet.life = 0
    }
  }

  damage(enemy: Enemy, amount: number) {
    if (enemy.defeated) return false
    enemy.health -= amount
    enemy.flash = 1
    enemy.punch = 1
    if (enemy.health <= 0) {
      enemy.health = 0
      enemy.defeated = true
      enemy.group.visible = false
      enemy.bar.visible = false
      enemy.alertSprite.visible = false
      enemy.alert = 0
      return true
    }
    return false
  }

  update(
    dt: number,
    time: number,
    eye: THREE.Vector3,
    playerAlive: boolean,
    camera: THREE.Camera,
    onPlayerHit: (from: THREE.Vector3) => void,
  ) {
    for (const enemy of this.enemies) {
      if (enemy.defeated) continue
      const sway = Math.sin(time * 0.34 + enemy.phase) * 0.11
      enemy.up.copy(enemy.anchor).normalize()
      _q.setFromAxisAngle(enemy.up, sway)
      _v.copy(enemy.anchor).applyQuaternion(_q)
      const radius = surfaceRadius(_v)
      enemy.pos.copy(_v).multiplyScalar(radius + 0.05)
      enemy.group.position.copy(enemy.pos)
      enemy.group.up.copy(enemy.up)
      _v2.copy(eye)
      enemy.group.lookAt(_v2)
      // chibi faces -Z, and Object3D.lookAt aims +Z at the target
      enemy.group.rotateY(Math.PI)

      const distance = enemy.pos.distanceTo(eye)
      const pulse = 1 + Math.sin(time * 2.4 + enemy.phase) * 0.012
      const punch = 1 + enemy.punch * 0.09
      const base = enemy.config.health > 3 ? 1.12 : 1
      enemy.group.scale.setScalar(base * pulse * punch)
      enemy.punch = Math.max(0, enemy.punch - dt * 6)
      if (enemy.flash > 0) {
        enemy.flash = Math.max(0, enemy.flash - dt * 5)
        flashCharacter(enemy.build, enemy.flash)
      }

      // billboard health bar
      enemy.bar.visible = distance < 62
      if (enemy.bar.visible) {
        enemy.bar.position.copy(enemy.pos).addScaledVector(enemy.up, 2.95)
        enemy.bar.quaternion.copy(camera.quaternion)
        const scale = THREE.MathUtils.clamp(distance * 0.045, 0.9, 3)
        enemy.bar.scale.setScalar(scale)
        const ratio = enemy.health / enemy.maxHealth
        enemy.barFill.scale.x = Math.max(0.001, ratio)
        const mat = enemy.barFill.material as THREE.MeshBasicMaterial
        mat.color.copy(BAR_LOW).lerp(BAR_HIGH, ratio)
      }

      // telegraph + shoot
      if (enemy.alert > 0) {
        enemy.alert -= dt
        enemy.alertSprite.visible = true
        enemy.alertSprite.position.copy(enemy.pos).addScaledVector(enemy.up, 3.5)
        const s = 0.55 + Math.sin(time * 22) * 0.06
        enemy.alertSprite.scale.setScalar(s * THREE.MathUtils.clamp(distance * 0.04, 0.7, 2))
        if (enemy.alert <= 0) {
          enemy.alertSprite.visible = false
          if (playerAlive && distance < 46 && hasLineOfSight(_muzzle(enemy), eye)) this.shoot(enemy, eye)
          enemy.cooldown = 2.9 + Math.random() * 2.8
        }
      } else {
        enemy.cooldown -= dt
        if (enemy.cooldown <= 0 && playerAlive && distance < 42 && hasLineOfSight(_muzzle(enemy), eye)) {
          enemy.alert = 0.7
        }
      }
    }

    this.updateBullets(dt, eye, playerAlive, onPlayerHit)
  }

  private shoot(enemy: Enemy, eye: THREE.Vector3) {
    const bullet = this.bullets.find((b) => !b.active)
    if (!bullet) return
    bullet.active = true
    bullet.life = 4.2
    bullet.trail = 0
    _v2.copy(eye).sub(enemy.pos).normalize()
    _v2.x += (Math.random() - 0.5) * 0.06
    _v2.y += (Math.random() - 0.5) * 0.06
    _v2.z += (Math.random() - 0.5) * 0.06
    _v2.normalize()
    bullet.pos.copy(enemy.pos).addScaledVector(enemy.up, 1.55).addScaledVector(_v2, 0.55)
    bullet.mesh.position.copy(bullet.pos)
    bullet.mesh.visible = true
    bullet.vel.copy(_v2).multiplyScalar(17)
    this.audio.enemyShot()
    this.fx.flash(bullet.pos, COLORS.candy, 0.7)
  }

  private updateBullets(dt: number, eye: THREE.Vector3, playerAlive: boolean, onPlayerHit: (from: THREE.Vector3) => void) {
    for (const bullet of this.bullets) {
      if (!bullet.active) continue
      bullet.life -= dt
      if (bullet.life <= 0) {
        this.kill(bullet)
        continue
      }
      const prev = bullet.pos.clone()
      const toPlayer = new THREE.Vector3().copy(eye).sub(bullet.pos).normalize().multiplyScalar(17)
      bullet.vel.lerp(toPlayer, Math.min(1, dt * 1.1))
      bullet.pos.addScaledVector(bullet.vel, dt)
      bullet.mesh.position.copy(bullet.pos)
      bullet.trail -= dt
      if (bullet.trail <= 0) {
        bullet.trail = 0.06
        this.fx.burst(bullet.pos, 1, { colors: [COLORS.candy, COLORS.white], speed: 0.5, size: 0.075, life: 0.24, up: bullet.vel.clone().normalize() })
      }

      // planet hit
      if (bullet.pos.length() < surfaceRadius(bullet.pos) + 0.25) {
        this.fx.burst(bullet.pos, 7, { colors: [COLORS.candy, COLORS.white], speed: 3, size: 0.09, life: 0.3 })
        this.fx.ring(bullet.pos, bullet.pos.clone().normalize(), COLORS.candy, 0.9)
        this.kill(bullet)
        continue
      }

      if (playerAlive) {
        const ab = new THREE.Vector3().copy(bullet.pos).sub(prev)
        const t = THREE.MathUtils.clamp(new THREE.Vector3().copy(eye).sub(prev).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1)
        const closest = prev.clone().addScaledVector(ab, t)
        if (closest.distanceTo(eye) < 0.95) {
          this.fx.burst(bullet.pos, 10, { colors: [COLORS.candy, COLORS.lemon], speed: 3.4, size: 0.09, life: 0.4 })
          onPlayerHit(bullet.pos)
          this.kill(bullet)
        }
      }
    }
  }

  private kill(bullet: Bullet) {
    bullet.active = false
    bullet.mesh.visible = false
    bullet.life = 0
  }

  clearBullets() {
    for (const bullet of this.bullets) this.kill(bullet)
  }
}

export function enemyHeadshot(object: THREE.Object3D) {
  let node: THREE.Object3D | null = object
  while (node) {
    if (node.userData.head) return true
    node = node.parent
  }
  return false
}

export function enemyIdFrom(object: THREE.Object3D) {
  let node: THREE.Object3D | null = object
  while (node) {
    if (typeof node.userData.enemyId === 'number') return node.userData.enemyId as number
    node = node.parent
  }
  return -1
}
