import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildUsagiAsset } from './game/usagi'

/**
 * Look-dev for the sculpted guest: /usagi-view.html
 * Three front-ortho panels sharing one frame, so the paint layer can be checked
 * against the raw sculpt: shaded bake, unlit albedo, untouched mesh.
 */

const W = 1180
const H = 700
const PANEL = W / 3
const Y0 = -0.15
const Y1 = 1.47
const S = PANEL / 0.91 // px per metre

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(1)
renderer.setSize(W, H)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.setScissorTest(true)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#241b30')
scene.add(new THREE.HemisphereLight('#FFFFFF', '#9A86B8', 2.0))
const key = new THREE.DirectionalLight('#FFFFFF', 1.9)
key.position.set(0.7, 1.6, 2)
scene.add(key)
const fill = new THREE.DirectionalLight('#BFD8FF', 0.7)
fill.position.set(-1.6, 0.6, 0.5)
scene.add(fill)

const gltf = await new GLTFLoader().loadAsync('/assets/chars/usagi/usagi.glb')
const asset = buildUsagiAsset(gltf.scene)

const panels = [
  new THREE.Mesh(asset.geometry, new THREE.MeshToonMaterial({ vertexColors: true })),
  new THREE.Mesh(asset.geometry, new THREE.MeshBasicMaterial({ vertexColors: true })),
  new THREE.Mesh(
    (gltf.scene.children[0] as THREE.Mesh).geometry.clone(),
    new THREE.MeshToonMaterial({ color: '#FFFFFF' }),
  ),
]
panels.forEach((mesh, i) => {
  mesh.position.set(i * 1.2, i === 2 ? 0 : asset.lift, 0)
  scene.add(mesh)
})
;(window as unknown as Record<string, unknown>).__dbg = { asset, THREE }

const mid = (Y0 + Y1) / 2
const cam = new THREE.OrthographicCamera(-0.455, 0.455, Y1 - mid, Y0 - mid, 0.01, 40)

function draw() {
  for (let i = 0; i < panels.length; i++) {
    renderer.setViewport(i * PANEL, 0, PANEL, H)
    renderer.setScissor(i * PANEL, 0, PANEL, H)
    const cx = panels[i].position.x
    cam.position.set(cx, mid, 6)
    cam.lookAt(cx, mid, 0)
    renderer.render(scene, cam)
  }
}
draw()

const ui = document.createElement('canvas')
ui.width = W
ui.height = H
ui.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none'
document.body.appendChild(ui)
const ctx = ui.getContext('2d')!
const py = (y: number) => H - ((y - Y0) / (Y1 - Y0)) * H
ctx.font = '12px ui-monospace, monospace'
ctx.fillStyle = 'rgba(255,255,255,0.8)'
;['toon bake', 'albedo', 'sculpt'].forEach((t, i) => ctx.fillText(t, i * PANEL + 12, 22))

ctx.strokeStyle = 'rgba(120,240,255,0.2)'
for (let x = -0.45; x <= 0.4501; x += 0.05) {
  for (let i = 0; i < panels.length; i++) {
    ctx.beginPath()
    ctx.moveTo(i * PANEL + PANEL / 2 + x * S, 30)
    ctx.lineTo(i * PANEL + PANEL / 2 + x * S, H)
    ctx.stroke()
  }
}
ctx.fillStyle = 'rgba(160,250,255,0.7)'
for (let y = 0; y <= 1.4001; y += 0.1) {
  ctx.beginPath()
  ctx.moveTo(0, py(y))
  ctx.lineTo(W, py(y))
  ctx.stroke()
  if (Math.round(y * 10) % 2 === 0) ctx.fillText(y.toFixed(1), 2, py(y) - 2)
}
document.title = `usagi ${asset.height.toFixed(2)}m`
