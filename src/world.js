import {
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { COMPOUND, DESERT } from './config.js'
import { RAPIER, addFixed } from './physics.js'
import { bake } from './bake.js'
import { pinToFarPlane } from './lighting.js'
import { mulberry32, paintDuneSand, paintStrata, paintWaterNormal, toTexture } from './textures.js'

// The desert around the construction site: one big rippled-sand ground whose dunes
// rise only outside the compound (inside it is flat, y = 0), a ring of layered mesas on
// the horizon, an oasis with palms and puffy clouds. Physically the ground is one flat
// box; the compound fence (site.js) keeps everyone on the flat part.

// --- Height field --------------------------------------------------------------------
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function noise(x, z) {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const u = fx * fx * (3 - 2 * fx)
  const v = fz * fz * (3 - 2 * fz)
  const a = hash(x0, z0)
  const b = hash(x0 + 1, z0)
  const c = hash(x0, z0 + 1)
  const d = hash(x0 + 1, z0 + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// Distance (m) outside the fenced rectangle, 0 inside it.
function outside(x, z) {
  const dx = Math.max(COMPOUND.minX - x, 0, x - COMPOUND.maxX)
  const dz = Math.max(COMPOUND.minZ - z, 0, z - COMPOUND.maxZ)
  return Math.hypot(dx, dz)
}

export function groundHeight(x, z) {
  const t = smooth(18, 150, outside(x, z))
  if (t <= 0) return 0
  // Long crescent dunes: warped ridges plus rolling noise.
  const w = noise(x * 0.006, z * 0.006) * 6
  const ridge = Math.pow(Math.abs(Math.sin(x * 0.012 + z * 0.02 + w)), 1.6)
  const roll = noise(x * 0.015 + 9, z * 0.015 - 4)
  let h = t * DESERT.duneHeight * (0.65 * ridge + 0.55 * roll)
  const o = DESERT.oasis
  const d = Math.hypot(x - o.x, z - o.z)
  h = h + (-2.4 - h) * smooth(o.r + 40, o.r - 6, d) // the oasis basin
  return h
}

function buildGround(root) {
  const S = DESERT.size
  const geo = new PlaneGeometry(S, S, DESERT.segments, DESERT.segments)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)))
  geo.computeVertexNormals()
  // Sand colour shifts on the dunes (lighter crests): a vertex colour multiplier.
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const k = 0.94 + Math.min(0.12, Math.max(-0.08, y * 0.008)) + (hash(pos.getX(i) * 0.1, pos.getZ(i) * 0.1) - 0.5) * 0.04
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  const sand = paintDuneSand(DESERT.sand, DESERT.sandDark, DESERT.sandLight)
  const repeat = S / DESERT.sandTile
  const mat = new MeshStandardMaterial({
    map: toTexture(sand.color, { repeat, srgb: true }),
    normalMap: toTexture(sand.normal, { repeat }),
    normalScale: new Vector2(0.9, 0.9),
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
  })
  const mesh = new Mesh(geo, mat)
  mesh.receiveShadow = true
  root.add(mesh)
}

// --- Mesas ------------------------------------------------------------------------------
function rockShape(rand, r, points = 9) {
  const s = new Shape()
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2
    const rr = r * (0.75 + rand() * 0.45)
    const x = Math.cos(a) * rr
    const y = Math.sin(a) * rr
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

function buildMesas(root) {
  const rand = mulberry32(4242)
  const strata = toTexture(paintStrata(DESERT.mesaColor), { srgb: true })
  strata.repeat.set(0.02, 0.025)
  const side = new MeshStandardMaterial({ map: strata, roughness: 1, flatShading: true })
  const top = new MeshStandardMaterial({ color: '#d98a4e', roughness: 1, flatShading: true })
  const group = new Group()
  const [r0, r1] = DESERT.mesaRing
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.3
    const dist = r0 + rand() * (r1 - r0)
    const mesa = new Group()
    let r = 30 + rand() * 45
    let y = -4
    const tiers = 1 + Math.floor(rand() * 3)
    for (let t = 0; t < tiers; t++) {
      const h = 18 + rand() * 26
      const geo = new ExtrudeGeometry(rockShape(rand, r), { depth: h, bevelEnabled: false })
      geo.rotateX(-Math.PI / 2)
      const m = new Mesh(geo, [top, side])
      m.position.y = y
      mesa.add(m)
      y += h
      r *= 0.55 + rand() * 0.25
    }
    mesa.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist - 20)
    mesa.rotation.y = rand() * Math.PI
    group.add(mesa)
  }
  root.add(bake(group, false))
}

// --- Oasis ---------------------------------------------------------------------------------
export function makePalm(rand, height = 9) {
  const g = new Group()
  const trunkMat = new MeshStandardMaterial({ color: '#8a5a33', roughness: 0.9, flatShading: true })
  const leafMat = new MeshStandardMaterial({ color: '#2f9a3a', roughness: 0.8, side: DoubleSide, flatShading: true })
  const segs = 6
  const lean = (rand() - 0.5) * 0.5
  let x = 0
  let y = 0
  for (let i = 0; i < segs; i++) {
    const h = height / segs
    const seg = new Mesh(new CylinderGeometry(0.28 - i * 0.02, 0.34 - i * 0.02, h, 7), trunkMat)
    const k = i / segs
    seg.position.set(x + lean * k * k * 2, y + h / 2, 0)
    seg.rotation.z = -lean * k * 0.6
    g.add(seg)
    y += h * 0.98
    x += lean * 0.12
  }
  const topX = x + lean * 2
  for (let f = 0; f < 8; f++) {
    const leaf = new Mesh(new ConeGeometry(0.9, 5.2, 4, 1, true), leafMat)
    leaf.scale.set(1, 1, 0.18)
    leaf.geometry.translate(0, 2.6, 0)
    leaf.position.set(topX, y, 0)
    leaf.rotation.set(0, (f / 8) * Math.PI * 2 + rand() * 0.3, 1.25 + rand() * 0.3, 'YXZ')
    g.add(leaf)
  }
  const nut = new Mesh(new IcosahedronGeometry(0.45, 0), new MeshStandardMaterial({ color: '#5a3a1e', flatShading: true }))
  nut.position.set(topX, y - 0.3, 0)
  g.add(nut)
  return g
}

function buildOasis(root) {
  const o = DESERT.oasis
  const rand = mulberry32(31)
  const ripples = paintWaterNormal()
  const normal = toTexture(ripples, { repeat: 8 })
  const water = new Mesh(
    new CircleGeometry(o.r + 6, 48),
    new MeshPhysicalMaterial({ color: '#2fc6e8', roughness: 0.15, normalMap: normal, normalScale: new Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.92 }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(o.x, -0.9, o.z)
  root.add(water)
  // Green grass ring and palms around the water.
  const grass = new Mesh(new CircleGeometry(o.r + 16, 48), new MeshLambertMaterial({ color: '#5aa83a' }))
  grass.rotation.x = -Math.PI / 2
  grass.position.set(o.x, -1.15, o.z)
  root.add(grass)
  const palms = new Group()
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2
    const d = o.r + 2 + rand() * 12
    const x = o.x + Math.cos(a) * d
    const z = o.z + Math.sin(a) * d
    const p = makePalm(rand, 8 + rand() * 5)
    p.position.set(x, groundHeight(x, z) - 0.2, z)
    p.rotation.y = rand() * Math.PI * 2
    palms.add(p)
  }
  root.add(bake(palms, true))
  return { update: (elapsed) => normal.offset.set(elapsed * 0.01, elapsed * 0.015) }
}

// --- Scattered desert rocks + tumbleweed-ish shrubs (instanced) ------------------------------------
function buildScatter(root) {
  const rand = mulberry32(99)
  const rocks = new InstancedMesh(new DodecahedronGeometry(1, 0), new MeshStandardMaterial({ color: '#c47a45', roughness: 1, flatShading: true }), 260)
  const shrubs = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshStandardMaterial({ color: '#8f8a3a', roughness: 1, flatShading: true }), 140)
  const m = new Matrix4()
  const q = new Quaternion()
  const s = new Vector3()
  const p = new Vector3()
  const e = new Object3D()
  let ri = 0
  let si = 0
  for (let i = 0; i < 400 && (ri < rocks.count || si < shrubs.count); i++) {
    const a = rand() * Math.PI * 2
    const d = 150 + rand() * 420
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d - 20
    if (outside(x, z) < 8) continue
    const y = groundHeight(x, z)
    e.rotation.set(rand() * 3, rand() * 3, rand() * 3)
    q.setFromEuler(e.rotation)
    if (rand() < 0.65 && ri < rocks.count) {
      const k = 0.6 + rand() * 2.6
      s.set(k * (0.8 + rand() * 0.6), k * (0.5 + rand() * 0.4), k)
      p.set(x, y + s.y * 0.3, z)
      rocks.setMatrixAt(ri++, m.compose(p, q, s))
    } else if (si < shrubs.count) {
      const k = 0.4 + rand() * 0.6
      s.set(k, k * 0.7, k)
      p.set(x, y + k * 0.4, z)
      shrubs.setMatrixAt(si++, m.compose(p, q, s))
    }
  }
  rocks.count = ri
  shrubs.count = si
  rocks.receiveShadow = shrubs.receiveShadow = true
  root.add(rocks, shrubs)
}

// --- Clouds ------------------------------------------------------------------------------------
function makeClouds() {
  const rand = mulberry32(2024)
  const geo = new IcosahedronGeometry(1, 3)
  const mat = new MeshLambertMaterial({ color: '#ffffff', emissive: '#e8f1ff', emissiveIntensity: 0.6, fog: false })
  const group = new Group()
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2
    const dist = 300 + rand() * 260
    const cloud = new Group()
    const puffs = 5 + Math.floor(rand() * 4)
    const len = 30 + rand() * 36
    for (let p = 0; p < puffs; p++) {
      const t = p / (puffs - 1) - 0.5
      const r = (1 - Math.abs(t) * 1.1) * (11 + rand() * 8)
      const puff = new Mesh(geo, mat)
      puff.scale.set(r, r * 0.8, r)
      puff.position.set(t * len, r * 0.25 + rand() * 3, (rand() - 0.5) * 10)
      cloud.add(puff)
    }
    cloud.position.set(Math.cos(ang) * dist, 150 + rand() * 120, Math.sin(ang) * dist)
    cloud.lookAt(0, cloud.position.y, 0)
    group.add(cloud)
  }
  const baked = bake(group, false)
  baked.traverse((o) => {
    if (o.isMesh) {
      o.material.fog = false
      pinToFarPlane(o.material, 'pinFarClouds') // visible at any camera far plane
    }
  })
  return baked
}

// The whole desert. Returns { update(dt, elapsed), clouds } for the frame loop.
export function createWorld(scene) {
  const root = new Group()
  root.name = 'desert'
  buildGround(root)
  buildMesas(root)
  const oasis = buildOasis(root)
  buildScatter(root)
  const clouds = makeClouds()
  root.add(clouds)
  scene.add(root)
  const cloudColor = new Color()
  return {
    clouds,
    // Clouds dim with the night (they are self-lit so they read against the blue).
    setNight(n) {
      cloudColor.setRGB(1, 1, 1).lerp(new Color('#2a3350'), n)
      clouds.traverse((o) => {
        if (o.isMesh) o.material.emissive.copy(cloudColor).multiplyScalar(0.9)
      })
    },
    update(dt, elapsed) {
      oasis.update(elapsed)
      clouds.rotation.y = elapsed * 0.002
    },
  }
}

// One flat floor collider for the compound (the fence keeps everyone on it).
export function groundColliders() {
  addFixed(RAPIER.ColliderDesc.cuboid(420, 1, 420), { x: 0, y: -1, z: -20 }, null, { friction: 0.9 })
}
