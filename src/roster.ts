import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

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

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 60)
camera.position.set(0, 2.9, 11.2)
camera.lookAt(0, 1.25, 0)

scene.add(new THREE.HemisphereLight('#FFF3FB', '#4C2E63', 2.2))
const key = new THREE.DirectionalLight('#FFF6E2', 2.8)
key.position.set(3, 7, 5)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.left = -9
key.shadow.camera.right = 9
key.shadow.camera.top = 5
key.shadow.camera.bottom = -3
key.shadow.camera.near = 0.5
key.shadow.camera.far = 26
scene.add(key)
const rim = new THREE.DirectionalLight('#B79BFF', 1.6)
rim.position.set(-5, 3, -4)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.MeshStandardMaterial({ color: '#9EDCFF', roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const loader = new GLTFLoader()
const load = (url: string) => new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) => loader.load(url, (g) => res({ scene: g.scene, animations: g.animations }), undefined, rej))
const names = ['Barbarian', 'Knight', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded']

async function main() {
  const [general, movement] = await Promise.all([
    load('/assets/anim/Rig_Medium_General.glb'),
    load('/assets/anim/Rig_Medium_MovementBasic.glb'),
  ])
  const idle = [...general.animations, ...movement.animations].find((c) => c.name === 'Idle_A')!
  const models = (await Promise.all(names.map((n) => load(`/assets/chars/${n}.glb`)))).map((g) => g.scene)
  models.forEach((model, i) => {
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
        m.roughness = 0.86
        m.metalness = 0
      }
    })
    const clone = cloneSkeleton(model)
    clone.scale.setScalar(0.74)
    clone.position.set((i - 2.5) * 2.05, 0, 0)
    clone.rotation.y = 0
    scene.add(clone)
    const mixer = new THREE.AnimationMixer(clone)
    mixer.clipAction(idle).play()
    mixers.push(mixer)
  })
}

const mixers: THREE.AnimationMixer[] = []
const clock = new THREE.Clock()
function tick() {
  const dt = clock.getDelta()
  for (const m of mixers) m.update(dt)
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
