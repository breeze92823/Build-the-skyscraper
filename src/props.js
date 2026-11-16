import { CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, TorusGeometry, Vector2 } from 'three'
import { box, cyl, put, std } from './propkit.js'
import { paintCorrugated, paintHazard, toTexture } from './textures.js'

// Reusable construction-site props, built from boxes and cylinders in metres with their
// base at y = 0 and facing +Z (front). Every builder returns a Group; callers place it
// and add colliders. Materials are shared so bake() can merge whole scenes.

const M = {}
const mat = (key, make) => M[key] || (M[key] = make())
export const mats = {
  tyre: () => mat('tyre', () => std('#1d1e22', { roughness: 0.9 })),
  rim: () => mat('rim', () => std('#c9ccd3', { metalness: 0.6, roughness: 0.35 })),
  glass: () => mat('glass', () => std('#6fb8e8', { metalness: 0.4, roughness: 0.12, envMapIntensity: 1.4 })),
  chrome: () => mat('chrome', () => std('#e8ebf0', { metalness: 0.85, roughness: 0.2 })),
  dark: () => mat('dark', () => std('#2b2d33', { roughness: 0.7 })),
  steel: () => mat('steel', () => std('#8a9099', { metalness: 0.5, roughness: 0.45 })),
  wood: () => mat('wood', () => std('#b9854a', { roughness: 0.85 })),
  orange: () => mat('orange', () => std('#ff6a1a', { roughness: 0.55 })),
  yellow: () => mat('yellow', () => std('#ffc21a', { roughness: 0.5 })),
  white: () => mat('white', () => std('#f2f4f7', { roughness: 0.55 })),
  hazard: () => mat('hazard', () => std('#ffffff', { map: toTexture(paintHazard(), { repeat: 1, srgb: true }), roughness: 0.6 })),
  lamp: () => mat('lamp', () => std('#fff6d8', { emissive: '#ffd98a', emissiveIntensity: 0.3 })),
  taillight: () => mat('tail', () => std('#ff2a2a', { emissive: '#ff2a2a', emissiveIntensity: 0.5 })),
}
const color = (c) => mat(`c${c}`, () => std(c))

function wheel(g, x, y, z, r = 0.55, w = 0.4) {
  const t = put(g, new CylinderGeometry(r, r, w, 14), mats.tyre(), x, y, z)
  t.rotation.z = Math.PI / 2
  const h = put(g, new CylinderGeometry(r * 0.55, r * 0.55, w + 0.04, 10), mats.rim(), x, y, z)
  h.rotation.z = Math.PI / 2
}

function cab(g, paint, z, w = 2.5, h = 2.3, d = 2.2) {
  box(g, w, 0.5, d, mats.dark(), 0, 0.6, z)
  box(g, w, h, d, paint, 0, 1.0, z)
  box(g, w * 0.86, h * 0.42, 0.06, mats.glass(), 0, 1.0 + h * 0.48, z + d / 2 + 0.01) // windscreen
  box(g, 0.06, h * 0.36, d * 0.5, mats.glass(), w / 2 + 0.01, 1.0 + h * 0.5, z + d * 0.12)
  box(g, 0.06, h * 0.36, d * 0.5, mats.glass(), -w / 2 - 0.01, 1.0 + h * 0.5, z + d * 0.12)
  box(g, w * 0.9, 0.35, 0.16, mats.chrome(), 0, 0.75, z + d / 2 + 0.08) // bumper
  box(g, 0.4, 0.22, 0.06, mats.lamp(), w * 0.32, 1.2, z + d / 2 + 0.03)
  box(g, 0.4, 0.22, 0.06, mats.lamp(), -w * 0.32, 1.2, z + d / 2 + 0.03)
  box(g, w * 0.5, 0.18, 0.4, mats.orange(), 0, 1.0 + h, z - d * 0.1) // roof beacon bar
}

// Cement mixer truck: cab, chassis and a striped drum that turns (group.userData.drum).
export function makeMixerTruck(paint = '#1aa3b8') {
  const g = new Group()
  const p = color(paint)
  box(g, 2.2, 0.5, 8.4, mats.dark(), 0, 0.55, -0.6) // chassis
  cab(g, p, 2.6)
  for (const z of [2.6, -1.6, -3.3]) {
    wheel(g, 1.2, 0.55, z)
    wheel(g, -1.2, 0.55, z)
  }
  // Drum: a lathe profile tilted up toward the back.
  const pts = [new Vector2(0.01, 0), new Vector2(0.8, 0.2), new Vector2(1.25, 1.2), new Vector2(1.3, 2.6), new Vector2(1.0, 4.0), new Vector2(0.55, 4.8), new Vector2(0.01, 4.85)]
  const drumGeo = new LatheGeometry(pts, 18)
  const drum = new Group()
  const shell = new Mesh(drumGeo, mats.white())
  shell.castShadow = true
  drum.add(shell)
  const stripeMat = color('#ff7a1a')
  for (let i = 0; i < 3; i++) {
    const ring = new Mesh(new TorusGeometry(1.28 - Math.abs(i - 1) * 0.08, 0.1, 6, 24), stripeMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 1.4 + i * 0.9
    ring.rotation.y = i * 0.6
    ring.scale.set(1, 1, 1)
    drum.add(ring)
  }
  drum.rotation.x = -Math.PI / 2 + 0.22
  drum.position.set(0, 2.55, 1.0)
  g.add(drum)
  box(g, 1.4, 1.4, 0.3, p, 0, 1.0, 1.3) // drum stand
  box(g, 0.8, 0.9, 0.6, p, 0, 3.0, -4.4) // chute hopper
  g.userData.drum = drum
  return g
}

// Box truck with a trailer of building blocks.
export function makeFlatbed(paint = '#e8ecf2', load = null) {
  const g = new Group()
  const p = color(paint)
  box(g, 2.4, 0.5, 9.5, mats.dark(), 0, 0.55, -1)
  cab(g, p, 3.2, 2.5, 2.4, 2.3)
  box(g, 2.5, 0.3, 6.6, mats.steel(), 0, 1.05, -2.4) // bed
  for (const z of [3.2, -2.6, -4.4]) {
    wheel(g, 1.25, 0.55, z)
    wheel(g, -1.25, 0.55, z)
  }
  if (load) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) box(g, 1.05, 1.0, 1.05, load, -0.55 + j * 1.1, 1.35, -0.6 - i * 1.6)
  }
  box(g, 0.3, 0.2, 0.1, mats.taillight(), 1.0, 1.0, -5.7)
  box(g, 0.3, 0.2, 0.1, mats.taillight(), -1.0, 1.0, -5.7)
  return g
}

// Forklift with the forks raised to `lift` (m).
export function makeForklift(lift = 0.3, load = null) {
  const g = new Group()
  const y = mats.yellow()
  box(g, 1.5, 1.0, 2.4, y, 0, 0.35, -0.2)
  box(g, 1.5, 0.7, 0.7, mats.dark(), 0, 0.35, -1.2) // counterweight
  wheel(g, 0.8, 0.42, 0.55, 0.42, 0.34)
  wheel(g, -0.8, 0.42, 0.55, 0.42, 0.34)
  wheel(g, 0.8, 0.38, -1.0, 0.38, 0.32)
  wheel(g, -0.8, 0.38, -1.0, 0.38, 0.32)
  // Cage over the seat.
  for (const [x, z] of [[0.68, 0.45], [-0.68, 0.45], [0.68, -0.85], [-0.68, -0.85]]) box(g, 0.1, 1.7, 0.1, mats.dark(), x, 1.35, z)
  box(g, 1.5, 0.08, 1.45, mats.dark(), 0, 3.05, -0.2)
  box(g, 0.8, 0.5, 0.6, mats.dark(), 0, 1.35, -0.5) // seat
  // Mast + forks.
  box(g, 0.12, 2.9, 0.12, mats.dark(), 0.45, 0.2, 1.08)
  box(g, 0.12, 2.9, 0.12, mats.dark(), -0.45, 0.2, 1.08)
  box(g, 1.0, 0.5, 0.1, mats.dark(), 0, 0.2 + lift, 1.18)
  box(g, 0.14, 0.06, 1.3, mats.steel(), 0.32, 0.18 + lift, 1.85)
  box(g, 0.14, 0.06, 1.3, mats.steel(), -0.32, 0.18 + lift, 1.85)
  if (load) box(g, 1.2, 1.0, 1.2, load, 0, 0.26 + lift, 1.9)
  box(g, 0.2, 0.15, 0.2, mats.orange(), 0, 3.09, -0.2) // beacon
  return g
}

// 6 m shipping container (corrugated sides).
export function makeContainer(paint = '#d63a2a') {
  const g = new Group()
  const tex = toTexture(paintCorrugated(paint), { srgb: true })
  tex.repeat.set(4, 1)
  const side = mat(`cont${paint}`, () => std('#ffffff', { map: tex, roughness: 0.6, metalness: 0.2 }))
  box(g, 2.44, 2.6, 6.06, side, 0, 0, 0)
  box(g, 2.5, 0.12, 6.12, color('#33363d'), 0, 2.58, 0)
  for (const x of [-0.5, 0.5]) box(g, 0.06, 2.3, 0.06, mats.steel(), x, 0.15, 3.04)
  return g
}

// Site office cabin: white box, blue stripe, windows and a door.
export function makeCabin(stripe = '#2f6fd0') {
  const g = new Group()
  box(g, 6, 2.8, 2.6, mats.white(), 0, 0.3, 0)
  box(g, 6.02, 0.35, 2.62, color(stripe), 0, 2.4, 0)
  box(g, 6.2, 0.15, 2.8, color('#5a5e66'), 0, 3.1, 0)
  for (const x of [-1.8, 1.4]) box(g, 1.2, 0.9, 0.05, mats.glass(), x, 1.5, 1.31)
  box(g, 0.9, 2.0, 0.05, color('#46617f'), -0.3, 0.3, 1.31)
  box(g, 6.2, 0.3, 2.8, mats.dark(), 0, 0, 0) // skids
  box(g, 1.2, 0.3, 0.9, mats.steel(), -0.3, 0, 1.75) // step
  return g
}

// Traffic cone (base at 0).
export function makeCone() {
  const g = new Group()
  put(g, new CylinderGeometry(0.08, 0.3, 0.75, 10), mats.orange(), 0, 0.42, 0)
  put(g, new CylinderGeometry(0.16, 0.22, 0.14, 10), mats.white(), 0, 0.42, 0)
  box(g, 0.66, 0.06, 0.66, mats.orange(), 0, 0, 0)
  return g
}

// Blue oil drum.
export function makeBarrel(c = '#2e66d8') {
  const g = new Group()
  cyl(g, 0.42, 1.1, color(c), 0, 0, 0, 14)
  put(g, new TorusGeometry(0.42, 0.03, 5, 16), mats.dark(), 0, 0.35, 0).rotation.x = Math.PI / 2
  put(g, new TorusGeometry(0.42, 0.03, 5, 16), mats.dark(), 0, 0.75, 0).rotation.x = Math.PI / 2
  return g
}

// Wooden pallet with a 2 x 2 x n stack of blocks on it.
export function makePallet(blockMat, layers = 2) {
  const g = new Group()
  box(g, 2.3, 0.18, 2.3, mats.wood(), 0, 0, 0)
  for (let l = 0; l < layers; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box(g, 1.08, 1.0, 1.08, blockMat, -0.56 + i * 1.12, 0.2 + l * 1.02, -0.56 + j * 1.12)
  return g
}

// Stack of steel pipes.
export function makePipes(n = 10) {
  const g = new Group()
  const m = mats.steel()
  let k = 0
  for (let row = 0; k < n; row++) {
    const count = Math.max(1, 4 - row)
    for (let i = 0; i < count && k < n; i++, k++) {
      const p = put(g, new CylinderGeometry(0.32, 0.32, 6, 12), m, (i - (count - 1) / 2) * 0.66, 0.32 + row * 0.56, 0)
      p.rotation.x = Math.PI / 2
    }
  }
  return g
}

// Sand / gravel pile.
export function makePile(c = '#d9a05e', r = 3) {
  const g = new Group()
  const m = put(g, new CylinderGeometry(r * 0.15, r, r * 0.7, 10, 1), color(c), 0, r * 0.35, 0)
  m.material = mat(`pile${c}`, () => std(c, { roughness: 1, flatShading: true }))
  return g
}

// Construction barrier (hazard striped board on two feet).
export function makeBarrier(len = 3) {
  const g = new Group()
  box(g, len, 0.35, 0.08, mats.hazard(), 0, 0.85, 0)
  box(g, len, 0.35, 0.08, mats.hazard(), 0, 0.3, 0)
  for (const x of [-len / 2 + 0.2, len / 2 - 0.2]) {
    box(g, 0.08, 1.25, 0.08, mats.white(), x, 0, 0)
    box(g, 0.12, 0.08, 0.7, mats.dark(), x, 0, 0)
  }
  return g
}

// Street lamp: pole, arm and a bulb that glows at night (bulb material passed in).
export function makeLamp(bulbMat, h = 6.5) {
  const g = new Group()
  cyl(g, 0.12, h, mats.dark(), 0, 0, 0, 8)
  cyl(g, 0.3, 0.4, mats.dark(), 0, 0, 0, 8)
  box(g, 0.12, 0.12, 1.4, mats.dark(), 0, h - 0.1, 0.65)
  box(g, 0.5, 0.25, 0.7, mats.dark(), 0, h - 0.3, 1.3)
  box(g, 0.42, 0.08, 0.6, bulbMat, 0, h - 0.36, 1.3, false)
  return g
}

// Fence banner flag (navy with a stripe).
export function makeBanner(c = '#1b2a6b', stripe = '#3fd3e6') {
  const g = new Group()
  cyl(g, 0.06, 4.6, mats.dark(), 0, 0, 0, 6)
  const flagMat = mat(`flag${c}`, () => std(c, { side: DoubleSide, roughness: 0.8 }))
  box(g, 0.04, 2.1, 0.8, flagMat, 0, 2.3, 0.42)
  box(g, 0.05, 0.25, 0.8, color(stripe), 0, 3.6, 0.42)
  return g
}

export const solidMat = color

export const sharedMaterials = mats

export function makeWaterTank() {
  const g = new Group()
  cyl(g, 1.4, 3.2, color('#e6e9ee'), 0, 1.4, 0, 16)
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) box(g, 0.15, 1.4, 0.15, mats.dark(), x, 0, z)
  return g
}

export function makeGenerator() {
  const g = new Group()
  box(g, 3.2, 1.6, 1.6, color('#2fae5a'), 0, 0.2, 0)
  box(g, 3.3, 0.2, 1.7, mats.dark(), 0, 0, 0)
  box(g, 0.2, 0.9, 0.2, mats.dark(), 1.1, 1.8, 0.3)
  box(g, 1.2, 0.6, 0.05, mats.dark(), -0.5, 0.7, 0.81)
  return g
}

export function makeMaterialMeta() {
  return MeshStandardMaterial
}
