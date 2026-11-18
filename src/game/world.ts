import * as THREE from 'three'
import { COLORS, PHYSICS } from '../config'
import { flagTexture, gradientMap, outlined, radialTexture, signTexture, toon } from './toon'

const R = PHYSICS.radius
const Y = new THREE.Vector3(0, 1, 0)
const _n = new THREE.Vector3()
const _jitter = new THREE.Vector3()

export function dirFromLatLon(latDeg: number, lonDeg: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const c = Math.cos(lat)
  return new THREE.Vector3(Math.cos(lon) * c, Math.sin(lat), Math.sin(lon) * c)
}

/** Analytic walking surface — the same function used to displace the mesh. */
export function surfaceRadius(dir: THREE.Vector3): number {
  _n.copy(dir).normalize()
  const n =
    Math.sin(_n.x * 11 + _n.z * 6.5) * 1.15 +
    Math.sin(_n.y * 17 + _n.x * 4) * 0.7 +
    Math.sin((_n.x + _n.y + _n.z) * 31) * 0.22 +
    Math.sin(_n.z * 7 - _n.y * 5) * 0.55
  return R + 2.4 + n
}

const MEADOW = new THREE.Color('#8FE4C2')
const ICE = new THREE.Color('#BCE8FF')
const SAND = new THREE.Color('#FFE2A8')
const JELLY = new THREE.Color('#F2ACE0')

const smooth = (t: number) => {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

function zoneColor(dir: THREE.Vector3, out: THREE.Color) {
  const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
  const lon = Math.atan2(dir.z, dir.x)
  const n =
    Math.sin(lon * 2.3 + lat * 3.7) * 0.5 +
    Math.sin(lon * 4.1 - lat * 2.3) * 0.28 +
    Math.sin(lat * 6.1) * 0.22
  const wIce = smooth((lat - 0.3) / 0.45) * (0.9 + n * 0.1)
  const wSand = smooth((-lat - 0.22) / 0.45) * (0.9 - n * 0.1)
  const wJelly = smooth((Math.cos(lon - 0.55) - 0.02) / 0.62) * smooth((0.62 - lat) / 0.6)
  out.copy(MEADOW)
  // HSL blending keeps the candy palette saturated where two biomes meet.
  out.lerpHSL(JELLY, THREE.MathUtils.clamp(wJelly, 0, 1))
  out.lerpHSL(SAND, THREE.MathUtils.clamp(wSand, 0, 1) * 0.94)
  out.lerpHSL(ICE, THREE.MathUtils.clamp(wIce, 0, 1))
  out.offsetHSL(0, 0.06, n * 0.03)
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

type Spinner = { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }
type Floater = { obj: THREE.Object3D; base: THREE.Vector3; axis: THREE.Vector3; amp: number; speed: number; phase: number }

export class World {
  planet: THREE.Mesh
  pads: CapturePad[] = []
  private spinners: Spinner[] = []
  private floaters: Floater[] = []
  private sky: THREE.Group
  private time = 0
  private mats: Record<string, THREE.MeshToonMaterial>

  constructor(scene: THREE.Scene) {
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

  resetPads() {
    for (const pad of this.pads) {
      pad.progress = 0
      pad.captured = false
      pad.ringMat.color.set(COLORS.gold)
      pad.flagMat.color.set(COLORS.candy)
    }
  }

  private buildPlanet() {
    const geo = new THREE.IcosahedronGeometry(1, 5)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const dir = new THREE.Vector3()
    const color = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize()
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

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(R + 7, 32, 20),
      new THREE.MeshBasicMaterial({ color: COLORS.candy, transparent: true, opacity: 0.055, side: THREE.BackSide, depthWrite: false }),
    )
    mesh.add(glow)
    return mesh
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
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.6, 6), this.mats.plum)
    pole.position.y = 0.8
    g.add(pole)
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.62),
      new THREE.MeshBasicMaterial({ map: signTexture(text), side: THREE.DoubleSide }),
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
  private addGroundDetail(scene: THREE.Scene) {
    const dummy = new THREE.Object3D()
    const dir = new THREE.Vector3()
    const color = new THREE.Color()
    const grassTones = ['#A8EEC8', '#8FE4C2', '#C8F7DE', '#7FD9AE', '#FFE38A']
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
      let n = 0
      for (let i = 0; i < count; i++) {
        if (center) dir.copy(center).add(_jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.42)).normalize()
        else dir.randomDirection()
        const radius = surfaceRadius(dir)
        const s = THREE.MathUtils.lerp(scale[0], scale[1], Math.random())
        dummy.position.copy(dir).multiplyScalar(radius + lift * s)
        dummy.quaternion.setFromUnitVectors(Y, dir)
        dummy.rotateY(Math.random() * Math.PI * 2)
        dummy.scale.set(s, s * THREE.MathUtils.lerp(yStretch[0], yStretch[1], Math.random()), s)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
        color.set(tones[(Math.random() * tones.length) | 0])
        if (Math.random() < 0.18) color.offsetHSL(0, 0, 0.06)
        mesh.setColorAt(n, color)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      scene.add(mesh)
    }

    scatter(6000, new THREE.ConeGeometry(0.045, 0.26, 5), 0.12, [0.6, 1.3], [0.6, 1.2], grassTones)
    scatter(900, new THREE.IcosahedronGeometry(0.085, 0), 0.07, [0.6, 1], [0.7, 1.4], flowerTones)
    scatter(420, new THREE.DodecahedronGeometry(0.13, 0), 0.06, [0.35, 0.6], [0.5, 0.9], pebbleTones)

    // Extra density around the landing site so the opening shot has readable ground detail.
    const landing = dirFromLatLon(6, -40)
    scatter(1500, new THREE.ConeGeometry(0.045, 0.26, 5), 0.12, [0.6, 1.3], [0.6, 1.2], grassTones, landing)
    scatter(850, new THREE.IcosahedronGeometry(0.085, 0), 0.07, [0.6, 1], [0.7, 1.4], flowerTones, landing)
    scatter(480, new THREE.DodecahedronGeometry(0.14, 0), 0.06, [0.35, 0.6], [0.6, 1.3], pebbleTones, landing)
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
    const padDirs = [dirFromLatLon(24, -46), dirFromLatLon(-20, 72)]
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
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.3, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }))
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
