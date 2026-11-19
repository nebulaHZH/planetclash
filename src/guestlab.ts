import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CHARACTERS, COLORS } from './config'
import { ToonRig } from './game/toonrig'
import { buildUsagiAsset } from './game/usagi'

/** Look-dev page for the procedural guest mascots: /guests.html */
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#2a1a3d')

const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 80)
camera.position.set(0, 2.5, 9.6)
camera.lookAt(0, 1.05, 0)

scene.add(new THREE.HemisphereLight('#FFF3FB', '#4C2E63', 2.1))
const key = new THREE.DirectionalLight('#FFF6E2', 2.9)
key.position.set(4, 8, 6)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.left = -8
key.shadow.camera.right = 8
key.shadow.camera.top = 6
key.shadow.camera.bottom = -3
key.shadow.camera.far = 30
scene.add(key)
const rim = new THREE.DirectionalLight('#B79BFF', 1.5)
rim.position.set(-6, 3, -5)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(16, 64),
  new THREE.MeshToonMaterial({ color: COLORS.mint }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const loader = new GLTFLoader()
const rigs: ToonRig[] = []
const guests = CHARACTERS.filter((c) => c.guest)

async function main() {
  const [gunGltf, usagiGltf] = await Promise.all([
    loader.loadAsync('/assets/guns/blaster-d.glb'),
    loader.loadAsync('/assets/chars/usagi/usagi.glb'),
  ])
  const sculpts = new Map([['Usagi', buildUsagiAsset(usagiGltf.scene)]])
  const gunScene = gunGltf.scene
  gunScene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(gunScene)
  const size0 = box.getSize(new THREE.Vector3())
  document.title = `gun ${size0.x.toFixed(2)} ${size0.y.toFixed(2)} ${size0.z.toFixed(2)}`
  gunScene.scale.setScalar(0.66 / Math.max(0.001, Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z)))
  const gun = { scene: new THREE.Group().add(gunScene), tip: 0.3, size: new THREE.Vector3(0.66, 0.2, 0.2), tint: 0.14, grip: [0, 0, 0] as const }

  const n = guests.length
  guests.forEach((config, i) => {
    const rig = new ToonRig(config, sculpts)
    const x = (i - (n - 1) / 2) * 3.1
    rig.setGun(gun)
    rig.root.position.set(x, 0, 0)
    rig.root.rotation.y = -x * 0.07
    scene.add(rig.root)
    rigs.push(rig)

    const label = document.createElement('div')
    label.className = 'label'
    label.textContent = `${config.name} · ${config.role}`
    label.style.left = `${50 + (x / (n * 3.1)) * 100}%`
    document.body.appendChild(label)
  })
}

// Handy from the devtools console: focus one guest for a close look.
;(window as unknown as Record<string, unknown>).__lab = { scene, camera, rigs, renderer }

let t = 0
let phase = 0
const clock = new THREE.Clock()
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  t += dt
  // idle -> aim -> shoot -> idle, so the pose set is visible in motion
  if (t > 2.2 * (phase + 1) - 1.2 && phase < 3) {
    phase++
    for (const rig of rigs) {
      if (phase === 1) rig.play('Ranged_1H_Aiming')
      if (phase === 2) rig.play('Ranged_1H_Shoot')
      if (phase === 3) rig.play('Idle_A')
    }
    if (phase === 3) phase = 0.0001
  }
  for (const rig of rigs) rig.update(dt)
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
tick()
main().catch((e) => console.error(e))

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
