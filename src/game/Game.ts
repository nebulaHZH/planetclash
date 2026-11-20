import * as THREE from 'three'
import { CHARACTERS, COLORS, GAME, PHYSICS, type CharacterConfig, type WeaponConfig } from '../config'
import type { GameCallbacks, HudState } from '../types'
import { DIG_MAX, World, dirFromLatLon, groundRadius, isDirt, surfaceRadius } from './world'
import { LadderField } from './ladder'
import { Player } from './player'
import { WeaponSystem } from './weapons'
import { EnemyManager, enemyHeadshot, enemyIdFrom, type Enemy } from './enemies'
import { Fx } from './fx'
import { GameAudio } from './audio'
import { loadGameAssets } from './assets'

import { SPAWN_LATLON } from './landmarks'

const SPAWN = dirFromLatLon(SPAWN_LATLON[0], SPAWN_LATLON[1])
const _v = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _roll = new THREE.Quaternion()
const _z = new THREE.Vector3(0, 0, 1)
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()

export class Game {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private world: World
  private player: Player
  private weapons: WeaponSystem
  private enemies: EnemyManager
  private ladders = new LadderField()
  private fx: Fx
  private audio = new GameAudio()
  private callbacks: GameCallbacks
  private canvas: HTMLCanvasElement

  private running = false
  private paused = false
  private ended = false
  private menu = true
  private disposed = false

  private character: CharacterConfig = CHARACTERS[0]
  private kills = 0
  private shots = 0
  private hits = 0
  private capturedCount = 0
  private elapsed = 0
  private invuln = 0
  private shake = 0
  private recoil = 0
  private hitstop = 0
  private slowmo = 0
  private sensitivity = 1
  private lookX = 0
  private lookY = 0
  private menuTime = Math.random() * 40
  private pendingEnd = 0
  private pendingWon = false
  private uiTimer = 0
  private last = performance.now()
  private frame = 0
  private locked = false
  private fallbackLock = false
  private lastMouse: { x: number; y: number } | null = null
  private keys = new Set<string>()
  private aiming = false
  private triggerHeld = false
  private raycaster = new THREE.Raycaster()
  private key: THREE.DirectionalLight
  private fill: THREE.DirectionalLight

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.autoClear = false
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setClearColor('#1B1030', 1)

    this.scene.background = new THREE.Color('#1B1030')
    this.scene.add(new THREE.HemisphereLight('#FFF3FB', '#5A3C78', 1.3))
    this.key = new THREE.DirectionalLight('#FFF6E2', 2.4)
    this.key.position.set(26, 46, 18)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.camera.near = 1
    this.key.shadow.camera.far = 170
    this.key.shadow.camera.left = -34
    this.key.shadow.camera.right = 34
    this.key.shadow.camera.top = 34
    this.key.shadow.camera.bottom = -34
    this.key.shadow.bias = -0.0006
    this.key.shadow.normalBias = 0.025
    this.scene.add(this.key)
    this.scene.add(this.key.target)
    this.fill = new THREE.DirectionalLight('#B79BFF', 0.55)
    this.fill.position.set(-34, -26, -22)
    this.scene.add(this.fill)

    this.camera = new THREE.PerspectiveCamera(PHYSICS.fov, 1, PHYSICS.near, PHYSICS.far)

    this.fx = new Fx(this.scene)
    this.world = new World(this.scene)
    this.player = new Player(SPAWN)
    this.audio = new GameAudio()
    if (import.meta.env.DEV) {
      const w = window as unknown as { __planet: Game; __isDirt?: (p: THREE.Vector3) => boolean }
      w.__planet = this
      w.__isDirt = isDirt
    }
    this.weapons = new WeaponSystem(this.audio, {
      onShoot: (weapon, spread) => this.fire(weapon, spread),
      onEmpty: () => this.toast('弹匣空了 — 按 R 换弹', 'bad'),
      onReload: () => {},
      onSwap: () => {},
      onMelee: (weapon) => this.swing(weapon),
      onDig: (weapon) => this.digGround(weapon),
      onPlace: () => this.placeLadder(),
    })
    this.scene.add(this.ladders.group)
    this.weapons.setCharacter(this.character)
    this.enemies = new EnemyManager(this.scene, this.fx, this.audio)
    this.player.obstacles = this.world.obstacles
    this.enemies.obstacles = this.world.obstacles
    void this.world.loadProps().then(() => {
      this.enemies.occluders = this.world.solids
    })
    void loadGameAssets().then((assets) => {
      if (this.disposed) return
      this.enemies.init(assets)
      this.weapons.setGuns(assets.guns)
      this.enemies.occluders = this.world.solids
      this.emitHud()
    })

    this.resize()
    this.bind()
    this.snapCamera()
    this.emitHud()
    this.last = performance.now()
    this.loop = this.loop.bind(this)
    this.frame = requestAnimationFrame(this.loop)
  }

  // ---------------------------------------------------------------- lifecycle

  start(characterId: string) {
    const config = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0]
    this.character = config
    this.player.reset(SPAWN, config.health, config.speed)
    // Open facing the rainbow arch: the nearest hero landmark inside the horizon.
    this.player.heading.copy(dirFromLatLon(14, -34)).projectOnPlane(this.player.dir).normalize()
    this.weapons.setCharacter(config)
    this.weapons.reset()
    this.enemies.reset()
    this.fx.reset()
    this.world.resetPads()
    this.world.resetDigs()
    this.ladders.reset()
    this.kills = 0
    this.shots = 0
    this.hits = 0
    this.capturedCount = 0
    this.elapsed = 0
    this.invuln = 0
    this.shake = 0
    this.recoil = 0
    this.hitstop = 0
    this.slowmo = 0
    this.lookX = 0
    this.lookY = 0
    this.pendingEnd = 0
    this.pendingWon = false
    this.aiming = false
    this.triggerHeld = false
    this.keys.clear()
    this.menu = false
    this.ended = false
    this.paused = false
    this.running = true
    this.fallbackLock = false
    this.lastMouse = null
    this.camera.fov = PHYSICS.fov
    this.camera.updateProjectionMatrix()
    this.snapCamera()
    this.key.position.set(26, 46, 18)
    this.key.intensity = 2.4
    this.fill.position.set(-34, -26, -22)
    this.fill.intensity = 0.55
    this.audio.unlock()
    this.emitHud()
    this.callbacks.onEvent({ kind: 'resumed' })
    this.requestLock()
    window.setTimeout(() => {
      if (this.running && !this.ended && !this.paused && !this.disposed) this.toast(`击倒 ${GAME.killTarget} 名对手 · 占领据点回血`, 'gold')
    }, 700)
  }

  resume() {
    if (this.ended || !this.running) return
    this.paused = false
    this.callbacks.onEvent({ kind: 'resumed' })
    this.audio.unlock()
    this.last = performance.now()
    this.emitHud()
    this.requestLock()
  }

  pause() {
    if (!this.running || this.ended || this.paused) return
    this.paused = true
    this.aiming = false
    this.triggerHeld = false
    this.weapons.triggerUp()
    this.keys.clear()
    if (document.pointerLockElement) document.exitPointerLock()
    this.callbacks.onEvent({ kind: 'paused' })
    this.emitHud()
  }

  enterMenu() {
    this.running = false
    this.paused = false
    this.ended = false
    this.menu = true
    this.menuTime = Math.random() * 40
    this.aiming = false
    this.triggerHeld = false
    this.weapons.triggerUp()
    this.enemies.reset()
    this.enemies.clearBullets()
    if (document.pointerLockElement) document.exitPointerLock()
    this.emitHud()
  }

  setSensitivity(value: number) {
    this.sensitivity = THREE.MathUtils.clamp(value, 0.2, 3)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.unbind()
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  // ------------------------------------------------------------------- input

  private bind() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('resize', this.resize)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private unbind() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.running || this.ended) return
    if (event.repeat) {
      if (event.code === 'Space') event.preventDefault()
      return
    }
    this.keys.add(event.code)
    if (event.code === 'Space') {
      event.preventDefault()
      this.player.jump()
    } else if (event.code === 'KeyR') {
      this.weapons.reload()
    } else if (event.code === 'Digit1') this.weapons.select(0)
    else if (event.code === 'Digit2') this.weapons.select(1)
    else if (event.code === 'Digit3') this.weapons.select(2)
    else if (event.code === 'Digit4') this.weapons.select(3)
    else if (event.code === 'Digit5') this.weapons.select(4)
    else if (event.code === 'Digit6') this.weapons.select(5)
    else if (event.code === 'KeyQ') this.weapons.cycle(-1)
    else if (event.code === 'KeyE') this.weapons.cycle(1)
    else if (event.code === 'Escape' && this.fallbackLock) this.pause()
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
  }

  private onMouseDown = (event: MouseEvent) => {
    if (!this.running || this.paused || this.ended) return
    if (!this.locked && !this.fallbackLock) return
    if (event.button === 0) {
      this.triggerHeld = true
      this.weapons.triggerDown()
    } else if (event.button === 2) {
      this.aiming = true
      event.preventDefault()
    }
  }

  private onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) {
      this.triggerHeld = false
      this.weapons.triggerUp()
    } else if (event.button === 2) {
      this.aiming = false
    }
  }

  private onMouseMove = (event: MouseEvent) => {
    if (!this.running || this.paused || this.ended) return
    if (!this.locked && !this.fallbackLock) return
    let dx = event.movementX
    let dy = event.movementY
    if (!this.locked && this.fallbackLock) {
      if (this.lastMouse) {
        dx = event.clientX - this.lastMouse.x
        dy = event.clientY - this.lastMouse.y
      }
      this.lastMouse = { x: event.clientX, y: event.clientY }
    }
    const limit = 220
    dx = THREE.MathUtils.clamp(dx, -limit, limit)
    dy = THREE.MathUtils.clamp(dy, -limit, limit)
    this.player.look(dx, dy, PHYSICS.sens * this.sensitivity, this.aiming)
    this.lookX += dx
    this.lookY += dy
    this.lookX = THREE.MathUtils.clamp(this.lookX, -400, 400)
    this.lookY = THREE.MathUtils.clamp(this.lookY, -400, 400)
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.running || this.paused || this.ended) return
    event.preventDefault()
    this.weapons.cycle(event.deltaY > 0 ? 1 : -1)
  }

  private onBlur = () => {
    this.keys.clear()
    this.aiming = false
    this.triggerHeld = false
    this.weapons.triggerUp()
  }

  private onContextMenu = (event: Event) => {
    if (this.running) event.preventDefault()
  }

  private onVisibility = () => {
    if (document.hidden && this.running && !this.ended) this.pause()
  }

  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas
    if (this.locked) {
      this.lastMouse = null
      if (this.paused && this.running && !this.ended) {
        this.paused = false
        this.callbacks.onEvent({ kind: 'resumed' })
        this.emitHud()
      }
    } else if (this.running && !this.ended && !this.paused && !this.fallbackLock) {
      this.pause()
    }
  }

  private requestLock() {
    if (document.pointerLockElement === this.canvas) return
    try {
      const request = this.canvas.requestPointerLock as unknown as () => Promise<void> | void
      const result = request.call(this.canvas)
      if (result && typeof (result as Promise<void>).then === 'function') {
        ;(result as Promise<void>).catch(() => this.enableFallback())
      }
    } catch {
      this.enableFallback()
    }
    window.setTimeout(() => {
      if (this.running && !this.ended && !this.paused && !this.locked) this.enableFallback()
    }, 350)
  }

  private enableFallback() {
    if (this.fallbackLock || this.paused || !this.running || this.ended) return
    this.fallbackLock = true
    this.callbacks.onEvent({ kind: 'lockFailed' })
  }

  private resize = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.weapons.viewCamera.aspect = width / height
    this.weapons.viewCamera.updateProjectionMatrix()
  }

  // -------------------------------------------------------------------- loop

  private loop(now: number) {
    this.frame = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000))
    this.last = now

    if (this.menu) {
      this.updateMenu(dt)
    } else {
      if (this.running && !this.paused && !this.ended) {
        this.simulate(dt)
      } else if (!this.paused) {
        this.world.update(dt)
        this.fx.update(dt)
        if (!this.ended) this.updateCamera(dt)
      }
    }

    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (!this.menu && !this.paused && !this.ended) {
      this.renderer.clearDepth()
      this.renderer.render(this.weapons.viewScene, this.weapons.viewCamera)
    }
  }

  private updateMenu(dt: number) {
    this.menuTime += dt
    const angle = this.menuTime * 0.07
    const radius = PHYSICS.radius * 2.95
    this.camera.position.set(Math.cos(angle) * radius, PHYSICS.radius * 0.62 + Math.sin(this.menuTime * 0.3) * 5, Math.sin(angle) * radius)
    this.camera.up.set(0, 1, 0)
    // Look slightly left of the planet so it is framed on the right of the menu card.
    _v.copy(this.camera.position).negate().normalize()
    _v2.crossVectors(_v, this.camera.up).normalize()
    _v3.copy(_v2).multiplyScalar(-30)
    this.camera.lookAt(_v3)
    this.key.position.copy(this.camera.position).multiplyScalar(1.08)
    this.key.position.y += 40
    this.key.target.position.set(0, 0, 0)
    this.key.target.updateMatrixWorld()
    this.fill.position.copy(this.camera.position).multiplyScalar(0.55)
    this.fill.intensity = 1.0
    this.key.intensity = 2.2
    this.camera.fov = 52
    this.camera.updateProjectionMatrix()
    this.world.update(dt)
    this.fx.update(dt)
  }

  private simulate(dt: number) {
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt)
      this.fx.update(dt * 0.35)
      return
    }
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - dt)
      dt *= 0.34
    }
    this.elapsed += dt
    this.invuln = Math.max(0, this.invuln - dt)
    this.shake = Math.max(0, this.shake - dt * 2.8)
    this.recoil *= Math.exp(-9 * dt)

    const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
    const strafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')

    // Rocket jumps move the body up to ~30 m/s: split the frame so one long
    // step (a hiccup's dt spike) can never carry the player through a wall.
    const bodySpeed = this.player.moveVel.length() + Math.abs(this.player.velY)
    const steps = Math.min(5, Math.max(1, Math.ceil((bodySpeed * dt) / 0.15)))
    for (let i = 0; i < steps; i++) {
      this.player.update(dt / steps, {
        forward,
        strafe,
        sprint,
        aim: this.aiming,
        jumpHeld: this.keys.has('Space'),
        ladder: this.ladders.nearest(this.player.dir),
      })
    }

    if (this.player.jumpedThisFrame) {
      this.audio.jump()
      this.fx.ring(this.player.feet, this.player.dir, COLORS.white, 1.1)
    }
    if (this.player.landImpact > 0) {
      const impact = this.player.landImpact
      this.audio.land()
      this.shake = Math.min(1, this.shake + impact * 0.03)
      if (impact > 6) this.fx.ring(this.player.feet, this.player.dir, COLORS.white, 1.4)
      this.player.landImpact = 0
    }

    this.updateCamera(dt)

    const eye = this.player.eye
    this.weapons.update(dt, this.player, this.aiming, this.triggerHeld, this.lookX, this.lookY)
    this.enemies.update(dt, this.elapsed, eye, this.player.alive, this.camera, (from) => this.hurt(1, from))
    this.updatePads(dt)
    this.world.update(dt)
    this.fx.update(dt)

    this.lookX = 0
    this.lookY = 0

    if (this.pendingEnd > 0) {
      this.pendingEnd -= dt
      if (this.pendingEnd <= 0) this.finish(this.pendingWon)
    }

    this.uiTimer -= dt
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1
      this.emitHud()
    }
  }

  private updateCamera(dt: number) {
    const p = this.player
    const up = p.dir
    const heading = p.heading
    _right.copy(heading).cross(up).normalize()
    const pitch = THREE.MathUtils.clamp(p.pitch + this.recoil, -1.45, 1.45)
    _forward.copy(heading).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize()
    _up.copy(_right).cross(_forward).normalize()

    const moving = p.grounded ? p.speedNorm : 0
    const bobY = Math.sin(p.bobPhase * 2) * 0.032 * moving
    const bobX = Math.cos(p.bobPhase) * 0.024 * moving
    const lean = THREE.MathUtils.clamp(p.moveVel.dot(_right) / PHYSICS.walkSpeed, -1, 1)

    this.camera.position.copy(p.feet)
    this.camera.position.addScaledVector(up, PHYSICS.eyeHeight + bobY - p.landDip * 0.7 - p.duck)
    this.camera.position.addScaledVector(_right, bobX)
    if (this.shake > 0.001) {
      const s = this.shake * 0.14
      this.camera.position.addScaledVector(_right, (Math.random() - 0.5) * s)
      this.camera.position.addScaledVector(_up, (Math.random() - 0.5) * s)
    }
    // Last resort inside tunnels: never render from inside the dirt — slide
    // the camera home toward the player point, which is always in open air.
    if (!p.climbing) {
      _v.copy(p.feet).addScaledVector(up, 1.0)
      for (let i = 0; i < 14 && isDirt(this.camera.position); i++) {
        this.camera.position.lerp(_v, 0.18)
      }
    }

    _matrix.makeBasis(_right, _up, _v.copy(_forward).negate())
    this.camera.quaternion.setFromRotationMatrix(_matrix)
    _roll.setFromAxisAngle(_z, -lean * 0.018)
    this.camera.quaternion.multiply(_roll)
    this.camera.up.copy(_up)
    this.camera.updateMatrixWorld()

    if (this.running) {
      this.key.target.position.copy(p.feet).addScaledVector(up, 1)
      this.key.position.copy(this.key.target.position)
        .addScaledVector(up, 44)
        .addScaledVector(_right, 22)
        .addScaledVector(_forward, 16)
      this.key.target.updateMatrixWorld()
    }

    const targetFov = this.aiming ? PHYSICS.adsFov : PHYSICS.fov + p.speedNorm * 2.5
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 11)
    this.camera.updateProjectionMatrix()

    this.weapons.viewCamera.fov = this.camera.fov
    this.weapons.viewCamera.aspect = this.camera.aspect
    this.weapons.viewCamera.updateProjectionMatrix()
  }

  private snapCamera() {
    this.camera.fov = PHYSICS.fov
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.updateCamera(1)
  }

  // ------------------------------------------------------------------ combat

  private fire(weapon: WeaponConfig, spread: number) {
    if (!this.running || this.paused || this.ended) return
    this.shots += weapon.pellets
    const origin = this.camera.position.clone()
    const forward = this.camera.getWorldDirection(new THREE.Vector3())
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward).normalize()
    const groups = this.enemies.hitGroups()
    const dirt = this.world.digColliders()
    const muzzle = new THREE.Vector3()
    this.weapons.muzzleWorld(this.camera, muzzle)

    let anyHit = false
    let anyHead = false
    // The launcher's shells blast: the closest world hit detonates and can
    // fling the player — point it at your feet and ride the explosion.
    let blastPoint: THREE.Vector3 | null = null
    let blastDist = Infinity

    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const direction = forward.clone()
      if (spread > 0) {
        const radius = spread * Math.sqrt(Math.random())
        const angle = Math.random() * Math.PI * 2
        direction.addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius).normalize()
      }
      this.raycaster.set(origin, direction)
      this.raycaster.far = weapon.range
      const enemyHit = this.raycaster.intersectObjects(groups, true)[0]
      const planetHit = this.raycaster.intersectObjects(dirt, false)[0]
      const propHit = this.world.solids.length > 0
        ? this.raycaster.intersectObjects(this.world.solids, true)[0]
        : undefined
      const worldHit = propHit && (!planetHit || propHit.distance < planetHit.distance) ? propHit : planetHit

      let end = _v.copy(origin).addScaledVector(direction, weapon.range)
      if (enemyHit && (!worldHit || enemyHit.distance < worldHit.distance)) {
        end = enemyHit.point
        const enemy = this.enemies.byId(enemyIdFrom(enemyHit.object))
        if (enemy && !enemy.defeated) {
          const head = enemyHeadshot(enemyHit.object)
          const falloff = weapon.id === 'star'
            ? THREE.MathUtils.clamp(1 - Math.max(0, enemyHit.distance - weapon.falloffStart) / 22, 0.3, 1)
            : 1
          const damage = weapon.damage * (head ? GAME.headshotMult : 1) * falloff
          const killed = this.enemies.damage(enemy, damage)
          this.audio.hit(head)
          this.hits += 1
          anyHit = true
          anyHead = anyHead || head
          this.fx.burst(enemyHit.point, head ? 16 : 9, {
            colors: [COLORS.lemon, COLORS.white, COLORS.candy],
            speed: 4.4,
            size: 0.085,
            life: 0.36,
            up: enemy.up,
          })
          this.fx.flash(enemyHit.point, COLORS.lemon, head ? 1.3 : 0.85)
          this.showDamage(enemyHit.point, Math.round(damage), head)
          this.hitstop = Math.max(this.hitstop, head ? 0.075 : 0.045)
          this.shake = Math.min(1, this.shake + (head ? 0.34 : 0.18))
          if (killed) this.onKill(enemy, enemyHit.point, head)
        }
      } else if (worldHit) {
        end = worldHit.point
        const normal = worldHit.face
          ? worldHit.face.normal.clone().transformDirection(worldHit.object.matrixWorld)
          : worldHit.point.clone().normalize()
        this.fx.impact(worldHit.point, normal, weapon.color)
        if (weapon.id === 'star' && worldHit.distance < blastDist) {
          blastPoint = worldHit.point.clone()
          blastDist = worldHit.distance
        }
      }
      this.fx.tracer(muzzle, end.clone(), weapon.color)
    }

    if (anyHit) {
      this.recoil = Math.min(0.22, this.recoil + weapon.recoil * 0.011)
      this.callbacks.onEvent({ kind: 'hit', headshot: anyHead })
    }
    if (blastPoint) this.blastJump(blastPoint)
  }

  /**
   * The launcher detonates where it lands: everything near the blast is shoved
   * away from it, the player included. Straight down at your feet that is a
   * rocket jump — up and over the hills, no ladder needed.
   */
  private blastJump(point: THREE.Vector3) {
    const away = this.player.feet.sub(point)
    const dist = Math.max(0.3, away.length())
    const strength = 29 * THREE.MathUtils.clamp(1 - dist / 7.5, 0, 1)
    if (strength < 1.5) return
    away.normalize()
    // Two biases keep the launch tall: pow < 1 rescues shallow aims, and the
    // distance floor makes a blast right at your feet shove you straight up
    // instead of sideways along the tiny aim offset.
    const dot = THREE.MathUtils.clamp(away.dot(this.player.dir), 0, 1)
    const radial = Math.max(Math.pow(dot, 0.65), THREE.MathUtils.clamp(1 - dist / 3.5, 0, 1))
    this.player.velY = Math.min(30, Math.max(this.player.velY, 0) + radial * strength)
    const flat = away.clone().addScaledVector(this.player.dir, -away.dot(this.player.dir))
    if (flat.lengthSq() > 1e-6) this.player.moveVel.add(flat.normalize().multiplyScalar(strength * 0.7))
    this.player.grounded = false
    this.fx.ring(point, this.player.dir, COLORS.gold, 2.4)
    this.fx.burst(point, 20, { colors: [COLORS.gold, COLORS.white, COLORS.candy], speed: 7.5, size: 0.12, life: 0.5, up: this.player.dir })
    this.fx.flash(point, COLORS.gold, 1.4)
    this.shake = Math.min(1, this.shake + 0.5)
  }

  /** Knife: short cone in front of the camera, no raycast, no ammo. */
  private swing(weapon: WeaponConfig) {
    if (!this.running || this.paused || this.ended) return
    const eye = this.camera.position
    const forward = this.camera.getWorldDirection(_forward)
    let best: Enemy | null = null
    let bestDist = weapon.range
    let bestPoint = _v.set(0, 0, 0)
    for (const enemy of this.enemies.enemies) {
      if (enemy.defeated) continue
      const to = _v2.copy(enemy.pos).addScaledVector(enemy.up, 0.75).sub(eye)
      const dist = to.length() - 0.55
      if (dist > bestDist) continue
      if (to.normalize().dot(forward) < 0.55) continue
      bestDist = dist
      best = enemy
      bestPoint = _v3.copy(enemy.pos).addScaledVector(enemy.up, 0.75)
    }
    if (!best) {
      this.fx.ring(eye.clone().addScaledVector(forward, 1.1), this.player.dir, COLORS.white, 0.5)
      return
    }
    const head = bestPoint.clone().sub(eye).normalize().dot(forward) > 0.93
    const killed = this.enemies.damage(best, weapon.damage * (head ? GAME.headshotMult : 1))
    this.hits += 1
    this.shots += 1
    this.audio.hit(head)
    const point = bestPoint.clone()
    this.fx.burst(point, 12, { colors: [COLORS.lemon, COLORS.white, COLORS.candy], speed: 3.6, size: 0.08, life: 0.32, up: best.up })
    this.fx.flash(point, COLORS.lemon, 1)
    this.showDamage(point, Math.round(weapon.damage), head)
    this.fx.ring(point, best.up, COLORS.candy, 1.2)
    this.hitstop = Math.max(this.hitstop, 0.05)
    this.shake = Math.min(1, this.shake + 0.2)
    this.callbacks.onEvent({ kind: 'hit', headshot: head })
    if (killed) this.onKill(best, point, head)
  }

  /**
   * Ground point under the crosshair. The ray can fall short when it grazes a
   * slope, so if you are plainly looking down it falls back to a spot a short
   * step in front of your feet — the shovel should never feel finicky.
   */
  private groundPoint(maxDist: number): THREE.Vector3 | null {
    const forward = this.camera.getWorldDirection(_forward)
    const hit = this.world.aimGround(this.camera.position, forward, maxDist)
    if (hit) return hit
    if (forward.dot(this.player.dir) > -0.22) return null
    const foot = _v.copy(this.player.dir).addScaledVector(this.player.heading, 1.7 / PHYSICS.radius).normalize()
    return new THREE.Vector3().copy(foot).multiplyScalar(surfaceRadius(foot))
  }

  /**
   * Shovel: take a bite out of the dirt wherever the crosshair is pointing.
   * Down, forward into a bank, sideways into the wall of a pit, or straight up
   * into the roof over your head all work — the bite is a sphere in space, not
   * a dent in a height field.
   */
  private digGround(weapon: WeaponConfig) {
    if (!this.running || this.paused || this.ended) return
    const forward = this.camera.getWorldDirection(_forward)
    const hit = this.groundPoint(Math.max(weapon.range, 7))
    if (!hit) {
      this.toast('够不到 · 走近一点', 'bad')
      return
    }
    const dir = _vB.copy(hit).normalize()
    for (const obstacle of this.world.obstacles) {
      if (dir.angleTo(obstacle.dir) * PHYSICS.radius < obstacle.radius + 1.1) {
        this.toast('旁边有东西，挖不动', 'bad')
        return
      }
    }
    const before = this.world.depthAt(dir)
    const hole = this.world.dig(hit, forward)
    this.audio.dig()
    this.fx.burst(hit, 18, { colors: ['#B9825C', '#8A5A44', COLORS.lemon], speed: 3.6, size: 0.11, life: 0.55, up: dir })
    this.fx.ring(hit, dir, COLORS.lemon, 1.5)
    this.shake = Math.min(1, this.shake + 0.12)
    if (hole.depth >= DIG_MAX && before < DIG_MAX - 0.05) {
      this.toast('挖到星球的地板啦 · 再往下就是核心了', 'gold')
    } else if (hole.depth >= 2 && hole.depth - before < 0.6) {
      this.toast(`已经挖了 ${hole.depth.toFixed(1)} 米 · 记得带梯子`, 'good')
    }
    this.emitHud()
  }

  /** Ladder: drop one where the crosshair points, standing on the real floor. */
  private placeLadder() {
    if (!this.running || this.paused || this.ended) return
    const hit = this.groundPoint(6)
    if (!hit) {
      this.toast('对准地面才能放梯子', 'bad')
      return
    }
    const aim = hit.clone().normalize()
    // Feet-relative ground march: in a deep pit or under a tunnel roof the
    // sky-march only finds the grass, so ask what is below *us* instead.
    const base = groundRadius(aim, this.player.feet.length() + 0.5)
    const ladder = this.ladders.place(aim, base)
    if (!ladder) {
      this.toast('这里已经放满了梯子', 'bad')
      return
    }
    const footPoint = aim.clone().multiplyScalar(ladder.base)
    this.audio.placeLadder()
    this.fx.ring(footPoint, aim, COLORS.lemon, 1.6)
    this.fx.burst(footPoint, 8, { colors: [COLORS.lemon, COLORS.white], speed: 2.2, size: 0.09, life: 0.4, up: aim })
    this.toast('梯子放好了 · 走过去按 W 就能爬', 'good')
  }

  private onKill(enemy: Enemy, point: THREE.Vector3, headshot: boolean) {
    this.kills += 1
    this.weapons.giveAmmo(GAME.ammoReward)
    this.audio.kill()
    this.hitstop = 0.12
    this.slowmo = 0.42
    this.shake = Math.min(1, this.shake + 0.55)
    this.fx.confettiBurst(point, enemy.up, 46)
    this.fx.marbles(point, enemy.up)
    this.fx.ring(point, enemy.up, COLORS.lemon, 2.1)
    const screen = this.toScreen(point.clone().addScaledVector(enemy.up, 0.9))
    this.callbacks.onEvent({ kind: 'kill', name: enemy.config.name, x: screen.x, y: screen.y, headshot })
    this.emitHud()

    if (this.kills >= GAME.killTarget && this.pendingEnd <= 0) {
      this.pendingWon = true
      this.pendingEnd = 1.2
    }
  }

  private hurt(amount: number, from: THREE.Vector3) {
    if (!this.running || this.paused || this.ended || !this.player.alive) return
    if (this.invuln > 0) return
    this.invuln = GAME.invuln
    this.hitstop = Math.max(this.hitstop, 0.05)
    this.player.health = Math.max(0, this.player.health - amount)
    this.shake = Math.min(1, this.shake + 0.9)
    this.audio.hurt()
    this.callbacks.onEvent({ kind: 'hurt', health: this.player.health })
    if (from) this.fx.burst(from, 5, { colors: [COLORS.candy, COLORS.white], speed: 2, size: 0.07, life: 0.3 })
    if (this.player.health <= 0) {
      this.player.alive = false
      this.pendingWon = false
      this.pendingEnd = 1
    }
    this.emitHud()
  }

  private updatePads(dt: number) {
    const feet = this.player.feet
    for (const pad of this.world.pads) {
      if (pad.captured) continue
      const dir = pad.dir
      _v.copy(dir).multiplyScalar(surfaceRadius(dir))
      if (_v.distanceTo(feet) < GAME.captureRadius) {
        pad.progress = Math.min(1, pad.progress + dt / GAME.captureTime)
        if (pad.progress >= 1) {
          pad.captured = true
          this.capturedCount += 1
          pad.ringMat.color.set(COLORS.mint)
          pad.flagMat.color.set(COLORS.mint)
          pad.beamMat.color.set(COLORS.mint)
          this.player.health = Math.min(this.player.maxHealth, this.player.health + 1)
          this.weapons.giveAmmo(14)
          this.audio.capture()
          this.fx.ring(_v, dir, COLORS.mint, 5)
          this.toast('据点占领！回复 1 ❤ 与弹药', 'good')
          this.emitHud()
        }
      } else {
        pad.progress = Math.max(0, pad.progress - dt * 0.55)
      }
    }
  }

  // -------------------------------------------------------------------- state

  private finish(won: boolean) {
    if (this.ended) return
    this.ended = true
    this.running = false
    this.aiming = false
    this.triggerHeld = false
    if (document.pointerLockElement) document.exitPointerLock()
    if (won) {
      this.audio.win()
      this.fx.confettiBurst(this.player.eye, this.player.dir, 110)
      this.fx.ring(this.player.feet, this.player.dir, COLORS.lemon, 6)
    } else {
      this.audio.lose()
      this.enemies.clearBullets()
    }
    this.callbacks.onEvent({
      kind: 'end',
      result: {
        won,
        kills: this.kills,
        accuracy: this.shots > 0 ? this.hits / this.shots : 0,
        time: this.elapsed,
        captured: this.capturedCount,
      },
    })
    this.emitHud()
  }

  private toScreen(point: THREE.Vector3) {
    point.project(this.camera)
    return {
      x: (point.x * 0.5 + 0.5) * window.innerWidth,
      y: (-point.y * 0.5 + 0.5) * window.innerHeight,
    }
  }

  private showDamage(point: THREE.Vector3, amount: number, headshot: boolean) {
    const screen = this.toScreen(point)
    this.callbacks.onEvent({ kind: 'damage', amount, headshot, x: screen.x, y: screen.y })
  }

  private toast(text: string, tone: 'good' | 'bad' | 'gold') {
    this.callbacks.onEvent({ kind: 'toast', text, tone })
  }

  private emitHud() {
    const weapons = this.weapons
    let nearestDist = -1
    let bearing = 0
    const up = this.player.dir
    const heading = this.player.heading
    const right = new THREE.Vector3().copy(heading).cross(up).normalize()
    for (const enemy of this.enemies.enemies) {
      if (enemy.defeated) continue
      const to = new THREE.Vector3().copy(enemy.pos).sub(this.player.feet)
      const dist = to.length()
      if (nearestDist >= 0 && dist >= nearestDist) continue
      nearestDist = dist
      const flat = to.addScaledVector(up, -to.dot(up))
      bearing = flat.lengthSq() < 1e-5 ? 0 : Math.atan2(flat.normalize().dot(right), flat.dot(heading))
    }
    const hud: HudState = {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      weaponIndex: weapons.index,
      ammo: weapons.ammo[weapons.index],
      reserve: weapons.reserve[weapons.index],
      reloading: weapons.isReloading,
      reloadProgress: weapons.reloadProgress,
      score: this.kills,
      enemiesLeft: this.enemies.aliveCount,
      enemiesTotal: this.enemies.total,
      sprint: this.player.stamina,
      spread: weapons.spread01,
      aiming: weapons.aiming,
      captured: this.capturedCount,
      captureProgress: [this.world.pads[0].progress, this.world.pads[1].progress],
      nearestDist,
      bearing,
      characterId: this.character.id,
      running: this.running,
    }
    this.callbacks.onHud(hud)
  }
}
