import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { gradientMap } from './game/toon'

const NAMES = [
  '31-Pew_Pew', '39-Raygun', '32-Lightning_Gun', '38-F_lock_12',
  '25-Ray_Gun', '51-Scifi_Pistol', '46-Scifi_Grenade_Launcher', '74-Turret_Teleporter',
  '62-Scifi_Gun', '73-Low_Poly_Blaster', '43-Capacitor_Rifle', '22-Mpsd',
  '16-Scifi_Assault_Rifle', '20-Scifi_Assault_Rifle', '24-Scifi_Assault_Rifle', '26-Scifi_AR',
  '27-Scifi_Assault_Rifle', '29-Scifi_Smg', '1-Coil_Gun', '3-Energy_Pistol',
  '86-Submachine_Gun', '87-Rail_Gun_Turret',
]

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#2a1a3d')
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200)

scene.add(new THREE.HemisphereLight('#ffffff', '#7651a5', 2.1))
const key = new THREE.DirectionalLight('#ffffff', 2.4)
key.position.set(-2, 4, 5)
scene.add(key)
const rim = new THREE.DirectionalLight('#9EDCFF', 1.2)
rim.position.set(3, -1, -4)
scene.add(rim)

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 128
  const g = c.getContext('2d')!
  g.font = '600 56px ui-sans-serif, system-ui, sans-serif'
  g.fillStyle = '#fffdf8'
  g.textAlign = 'center'
  g.fillText(text, 256, 84)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  s.scale.set(1.1, 0.275, 1)
  return s
}

const cols = 6
const stepX = 1.22
const stepY = 1.08
const loader = new GLTFLoader()
const grad = gradientMap()

NAMES.forEach((name, i) => {
  loader.load(`/assets/guns/candidates/${name}.glb`, (gltf) => {
    const obj = gltf.scene
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      m.material = new THREE.MeshToonMaterial({
        map: src.map ?? null,
        color: src.color ? src.color.clone() : new THREE.Color('#ffffff'),
        gradientMap: grad,
      })
    })
    const box = new THREE.Box3().setFromObject(obj)
    const size = box.getSize(new THREE.Vector3())
    const s = 0.62 / Math.max(size.x, size.y, size.z)
    obj.scale.setScalar(s)
    obj.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(obj)
    const ctr = b2.getCenter(new THREE.Vector3())
    obj.position.sub(ctr)
    const g = new THREE.Group()
    g.add(obj)
    g.rotation.y = -0.5
    g.position.set((i % cols) * stepX - ((cols - 1) * stepX) / 2, 1.55 - Math.floor(i / cols) * stepY, 0)
    scene.add(g)
    const lab = label(name.replace(/^\d+-/, '').replace(/_/g, ' '))
    lab.position.set(g.position.x, g.position.y - 0.36, 0.4)
    scene.add(lab)
  })
})

camera.position.set(0, 0, 9)
camera.lookAt(0, 0, 0)

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
})

renderer.setAnimationLoop(() => renderer.render(scene, camera))
;(window as any).__gunlab = { scene, camera, renderer }
