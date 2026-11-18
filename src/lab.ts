import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const info = document.getElementById('info')!
info.style.display = 'none'
const bar = document.getElementById('bar')!
bar.style.display = 'none'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#3B2150')
scene.fog = new THREE.Fog('#3B2150', 26, 52)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 120)
camera.position.set(5.4, 2.5, 1.2)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1.1, 0)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.48
controls.update()

scene.add(new THREE.HemisphereLight('#FFF3FB', '#4C2E63', 2.1))
const key = new THREE.DirectionalLight('#FFF6E2', 2.6)
key.position.set(4, 7, 3.5)
key.castShadow = true
key.shadow.mapSize.set(1024, 1024)
key.shadow.camera.left = -5
key.shadow.camera.right = 5
key.shadow.camera.top = 5
key.shadow.camera.bottom = -5
key.shadow.camera.near = 0.5
key.shadow.camera.far = 24
scene.add(key)
const rim = new THREE.DirectionalLight('#B79BFF', 1.4)
rim.position.set(-5, 3, -4)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(7, 48),
  new THREE.MeshStandardMaterial({ color: '#9EDCFF', roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)
const ring = new THREE.Mesh(
  new THREE.RingGeometry(1.4, 1.55, 48),
  new THREE.MeshBasicMaterial({ color: '#F8B84E' }),
)
ring.rotation.x = -Math.PI / 2
ring.position.y = 0.01
scene.add(ring)

const loader = new GLTFLoader()
const load = (url: string): Promise<THREE.Group & { animations: THREE.AnimationClip[] }> =>
  new Promise((res, rej) => loader.load(url, (g) => res(Object.assign(g.scene, { animations: g.animations })), undefined, rej))

async function main() {
  const [knight, general, movement, ranged] = await Promise.all([
    load('/assets/chars/Knight.glb'),
    load('/assets/anim/Rig_Medium_General.glb'),
    load('/assets/anim/Rig_Medium_MovementBasic.glb'),
    load('/assets/anim/Rig_Medium_CombatRanged.glb'),
  ])

  knight.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
      m.roughness = 0.85
      m.metalness = 0
    }
  })
  const rig = new THREE.Group()
  rig.add(knight)
  scene.add(rig)

  const box = new THREE.Box3().setFromObject(knight)
  const size = box.getSize(new THREE.Vector3())
  info.textContent = `knight height ${size.y.toFixed(2)}m\n` +
    `bones: ${(() => { const names: string[] = []; knight.traverse((o) => { if ((o as THREE.Bone).isBone) names.push(o.name) }); return names.filter((n) => /hand|head/i.test(n)).join(', ') })()}`

  const mixer = new THREE.AnimationMixer(knight)
  const clips = [...general.animations, ...movement.animations, ...ranged.animations]
  const byName = (name: string) => clips.find((c) => c.name === name)
  info.textContent += `\nclips: ${clips.length}`

  const actions = new Map<string, THREE.AnimationAction>()
  const play = (name: string) => {
    for (const a of actions.values()) a.fadeOut(0.15)
    let action = actions.get(name)
    if (!action) {
      const clip = byName(name)
      if (!clip) { info.textContent += `\nmissing clip ${name}`; return }
      action = mixer.clipAction(clip)
      actions.set(name, action)
    }
    action.reset().fadeIn(0.15).play()
  }
  info.textContent += `\nall: ${clips.map((c) => c.name).join(', ')}`

  const hand = knight.getObjectByName('handslotr') || knight.getObjectByName('handslot_r') || knight.getObjectByName('handslot.r')
  if (hand) {
    const gun = (await load('/assets/guns/blaster-c.glb')).clone()
    gun.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
    const gb = new THREE.Box3().setFromObject(gun)
    const gs = gb.getSize(new THREE.Vector3())
    info.textContent += `\ngun size ${gs.x.toFixed(2)} ${gs.y.toFixed(2)} ${gs.z.toFixed(2)}`
    const holder = new THREE.Group()
    const s = 0.9 / Math.max(gs.x, gs.y, gs.z)
    gun.scale.setScalar(s)
    gun.position.set(0, 0, 0.16)
    holder.add(gun)
    rig.add(holder)

    const align = () => {
      const p = hand.getWorldPosition(new THREE.Vector3())
      rig.worldToLocal(p)
      holder.position.copy(p)
      holder.quaternion.identity()
      holder.rotateX(-Math.PI / 2)
    }
    align()
    ;(window as unknown as { __lab: unknown }).__lab = { gun, holder, play, THREE, hand, knight, align }
  } else {
    info.textContent += '\nNO HANDSLOT'
  }

  for (const name of ['Idle_A', 'Running_A', 'Jump_Full_Short', 'Hit_A', 'Death_A']) {
    const b = document.createElement('button')
    b.textContent = name
    b.onclick = () => play(name)
    bar.appendChild(b)
  }
  play('Idle_A')

  const clock = new THREE.Clock()
  const tick = () => {
    const dt = clock.getDelta()
    mixer.update(dt)
    ;(window as unknown as { __lab?: { align?: () => void } }).__lab?.align?.()
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }
  tick()
}

main().catch((e) => { info.textContent = 'ERROR ' + e.message })

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
