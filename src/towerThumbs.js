import {
  ACESFilmicToneMapping,
  Box3,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { BUILDINGS } from './config.js'
import { capGeometry, floorGeometry, footprint, offset } from './shapes.js'
import { paintWindows, toTexture } from './textures.js'

// Portraits of every BUILDINGS entry for the Next Building reel: a small model of the tower
// (its footprint, curtain-wall glass, slabs, base plinth and crown, like tower.js builds it),
// rendered once on a throwaway WebGL context to PNG data URLs. Built on idle after boot
// (prewarmThumbs) or on first use; null entries (no WebGL) fall back to a CSS block.

const W = 320 // rendered at about 2x the size it is shown at, for clean edges
const H = 480
const FLOORS = 13
const FH = 4 // m per floor, as on the real tower
let urls = null

function makeModel(def, i, bin) {
  const g = new Group()
  const s = def.size * 0.6
  const pts = footprint(def.shape, s)
  const own = (x) => (bin.push(x), x)

  // Bigger panes than on the real tower, so they read at portrait size.
  const win = paintWindows(def.glass, def.frame, 4, 800 + i)
  const map = own(toTexture(win.color, { srgb: true }))
  map.repeat.set(1 / 14, 1)
  const glass = own(new MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.28, roughness: 0.25, metalness: 0.15 }))
  const slab = own(new MeshStandardMaterial({ color: def.slab, roughness: 0.5 }))
  const base = own(new MeshStandardMaterial({ color: def.base, roughness: 0.35, metalness: 0.2 }))
  const frame = own(new MeshStandardMaterial({ color: def.frame, roughness: 0.4, metalness: 0.3 }))
  const light = own(new MeshStandardMaterial({ color: '#ff3030', emissive: '#ff3030', emissiveIntensity: 2 }))

  const plinth = own(floorGeometry(offset(pts, 1), 1.4, 1.4, 0, 0))
  g.add(new Mesh(plinth, [base, base]))
  const storey = own(floorGeometry(pts, FH, 0.55))
  for (let f = 0; f < FLOORS; f++) {
    const m = new Mesh(storey, [slab, glass])
    m.position.y = 1.4 + f * FH
    g.add(m)
  }
  const top = 1.4 + FLOORS * FH
  const roof = new Mesh(own(capGeometry(pts)), slab)
  roof.position.y = top
  g.add(roof)

  // Crown, as tower.js makeCrown, sized to the smaller footprint.
  let rMin = Infinity
  for (const [x, z] of pts) rMin = Math.min(rMin, Math.hypot(x, z))
  const crownR = rMin * ({ spire: 0.6, dome: 0.78, ring: 0.7 }[def.crown] ?? 0.6)
  const c = new Group()
  c.position.y = top
  const add = (geo, mat, y, rx = 0) => {
    const m = new Mesh(own(geo), mat)
    m.position.y = y
    m.rotation.x = rx
    c.add(m)
    return m
  }
  if (def.crown === 'spire') {
    add(new CylinderGeometry(crownR * 0.7, crownR, 5, 12), glass, 2.5)
    add(new ConeGeometry(crownR * 0.66, 13, 12), frame, 11.5)
    add(new CylinderGeometry(0.22, 0.35, 16, 6), frame, 26)
    add(new SphereGeometry(0.7, 10, 8), light, 34.3)
  } else if (def.crown === 'dome') {
    add(new SphereGeometry(crownR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0)
    add(new TorusGeometry(crownR * 1.03, 0.45, 8, 32), frame, 0, Math.PI / 2)
    add(new CylinderGeometry(0.2, 0.32, 11, 6), frame, crownR + 4.5)
    add(new SphereGeometry(0.6, 10, 8), light, crownR + 10.4)
  } else {
    const halo = own(new MeshStandardMaterial({ color: def.glass, emissive: def.glass, emissiveIntensity: 1.6 }))
    add(new TorusGeometry(crownR, 0.8, 10, 40), halo, 7, Math.PI / 2)
    const post = own(new CylinderGeometry(0.38, 0.38, 7, 6))
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      const p = new Mesh(post, frame)
      p.position.set(Math.cos(a) * crownR, 3.5, Math.sin(a) * crownR)
      c.add(p)
    }
  }
  g.add(c)
  return g
}

function render() {
  const out = BUILDINGS.map(() => null)
  let renderer = null
  const bin = []
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(W, H, false)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    const scene = new Scene()
    scene.add(new HemisphereLight('#ffffff', '#7f8ea3', 1.9))
    const sun = new DirectionalLight('#fff3df', 2.6)
    sun.position.set(30, 60, 45)
    scene.add(sun)
    const rim = new DirectionalLight('#cfe6ff', 0.9)
    rim.position.set(-40, 20, -30)
    scene.add(rim)
    const camera = new PerspectiveCamera(26, W / H, 1, 2000)
    const box = new Box3()
    const size = new Vector3()
    const mid = new Vector3()
    const dir = new Vector3(0.62, 0.3, 1).normalize()
    BUILDINGS.forEach((def, i) => {
      const model = makeModel(def, i, bin)
      scene.add(model)
      box.setFromObject(model)
      box.getSize(size)
      box.getCenter(mid)
      const half = (camera.fov * Math.PI) / 360
      const fitH = size.y / 2 / Math.tan(half)
      const fitW = Math.max(size.x, size.z) / 2 / (Math.tan(half) * camera.aspect)
      camera.position.copy(mid).addScaledVector(dir, Math.max(fitH, fitW) * 1.04 + Math.max(size.x, size.z) * 0.3)
      camera.lookAt(mid)
      renderer.render(scene, camera)
      out[i] = renderer.domElement.toDataURL('image/png')
      scene.remove(model)
    })
  } catch (err) {
    console.warn('[thumbs] building portraits unavailable', err)
  } finally {
    for (const x of bin) x.dispose?.()
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
  return out
}

// Data URLs (or null) per BUILDINGS index; renders on the first call.
export function buildingThumbs() {
  if (!urls) urls = render()
  return urls
}

// Render them while the game is idle so the reel never waits on it.
export function prewarmThumbs(delayMs = 4000) {
  const go = () => buildingThumbs()
  setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 })
    else go()
  }, delayMs)
}
