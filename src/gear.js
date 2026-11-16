import {
  AdditiveBlending,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { boxGeo, neon } from './propkit.js'
import { makeMixerTruck, mats } from './props.js'

// Robot Gear models, all procedural:
//  - wearGear(root, id): armour fixed to an avatar's bones (player, the display mannequins in the
//    hall), so it follows every animation. Parts are built in rig units around an anchor in the
//    character root's bind-pose space (feet at 0, 6.4 tall, front +Z, the avatar's left hand at +X)
//    out of rounded "toy plastic" boxes, joints, pistons, lenses and glowing strips. One holder per
//    bone carries the parts; each part has an inner group the suit-up flies in from outside the
//    body. finalize() then merges every static mesh of a bone into one mesh per material family
//    (vertex coloured), so a full suit is a few dozen draw calls. Animated bits (robotic arms,
//    claws, the mixer drum, thruster flames) are marked `live` and stay separate.
//  - makeVehicle(kind): the transformers' other form (mixer truck, big rig, jet), in metres.
//  - makeDropship(): the red dropship that delivers Titan Armor; makePod(): its armour pod.

// --- Materials + geometry (shared) ----------------------------------------------------------------
const cache = new Map()
const once = (key, make) => cache.get(key) ?? cache.set(key, make()).get(key)
// Every paint belongs to a family; merged parts share one vertex-coloured material per family.
const FAMILY = { gloss: [0.34, 0.2], matte: [0.66, 0.05], metal: [0.26, 0.78] } // roughness, metalness
function paint(color, metal = 0.2, rough = 0.36) {
  return once(`p${color}|${metal}|${rough}`, () => {
    const m = new MeshStandardMaterial({ color, metalness: metal, roughness: rough })
    m.userData.family = metal >= 0.6 ? 'metal' : rough >= 0.6 ? 'matte' : 'gloss'
    return m
  })
}
const familyMat = (f) => once(`fam${f}`, () => new MeshStandardMaterial({ vertexColors: true, roughness: FAMILY[f][0], metalness: FAMILY[f][1] }))
const lit = (color, k = 2.6) => once(`n${color}|${k}`, () => neon(color, k))
const flameMat = (color, opacity) => once(`f${color}|${opacity}`, () => new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }))
const chrome = () => paint('#e3e7ee', 0.8, 0.22)
const glass = () => once('glass', () => new MeshStandardMaterial({ color: '#1b2b3d', metalness: 0.6, roughness: 0.08, envMapIntensity: 1.6 }))
const cylGeo = (rt, rb, h, seg = 14) => once(`c${rt}|${rb}|${h}|${seg}`, () => new CylinderGeometry(rt, rb, h, seg))
const sphereGeo = (r) => once(`s${r}`, () => new SphereGeometry(r, 14, 10))
const rbGeo = (w, h, d, r) => once(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r))
const flameGeo = () => once('flame', () => new ConeGeometry(0.34, 1.6, 10, 1, true).translate(0, 0.8, 0).rotateX(Math.PI))
const SIDES = [1, -1]
const r2 = (n) => Math.round(n * 1000) / 1000

function mesh(g, geo, mat, x, y, z, rx, ry, rz, shadow = true) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.castShadow = shadow
  m.receiveShadow = shadow
  g.add(m)
  return m
}
// A sharp box centred at (x, y, z).
const bx = (g, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true) => mesh(g, boxGeo(w, h, d), mat, x, y, z, rx, ry, rz, shadow)
// A rounded box (the toy-plastic look).
function rb(g, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, r) {
  w = r2(w)
  h = r2(h)
  d = r2(d)
  const rad = r2(r ?? Math.min(w, h, d) * 0.22)
  return mesh(g, rbGeo(w, h, d, rad), mat, x, y, z, rx, ry, rz)
}
const cy = (g, rt, rb_, h, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 14) => mesh(g, cylGeo(r2(rt), r2(rb_), r2(h), seg), mat, x, y, z, rx, ry, rz)
// An empty marker the particles read their position from.
function marker(g, x, y, z, list) {
  const m = new Group()
  m.position.set(x, y, z)
  g.add(m)
  list.push(m)
  return m
}
// A round camera-lens light: dark bezel, glowing ring, dark pupil, a glint. face: 'z' | 'z-' | 'x' | 'x-' | 'y'.
function lens(g, x, y, z, r, p, face = 'z') {
  const L = new Group()
  L.position.set(x, y, z)
  if (face === 'z') L.rotation.x = Math.PI / 2
  else if (face === 'z-') L.rotation.x = -Math.PI / 2
  else if (face === 'x') L.rotation.z = -Math.PI / 2
  else if (face === 'x-') L.rotation.z = Math.PI / 2
  g.add(L)
  cy(L, r, r, 0.16, p.dark, 0, 0, 0, 0, 0, 0, 20)
  cy(L, r * 0.76, r * 0.76, 0.2, lit(p.glow, 3), 0, 0.01, 0, 0, 0, 0, 20)
  cy(L, r * 0.42, r * 0.42, 0.24, paint('#0b1a24', 0.3, 0.3), 0, 0.02, 0, 0, 0, 0, 16)
  cy(L, r * 0.14, r * 0.14, 0.26, lit('#ffffff', 2), r * 0.18, 0.03, -r * 0.18, 0, 0, 0, 8)
  return L
}
// A thruster flame (outer orange, inner white-blue core) pointing down from (x, y, z) ('back': -Z).
function flame(g, x, y, z, size = 1, dir = 'down', color = '#ff8a1a') {
  const f = new Group()
  f.userData.live = true
  const outer = new Mesh(flameGeo(), flameMat(color, 0.85))
  const inner = new Mesh(flameGeo(), flameMat('#bfe9ff', 0.9))
  inner.scale.set(0.5, 0.65, 0.5)
  f.add(outer, inner)
  f.position.set(x, y, z)
  if (dir === 'back') f.rotation.x = Math.PI / 2
  f.scale.setScalar(size)
  f.userData.size = size
  g.add(f)
  return f
}

// Geometry with the colours baked in (one draw call for a multi-coloured animated piece).
// pieces: [[geometry, colour, x, y, z, rx, ry, rz]]
const tmpM = new Matrix4()
function coloured(key, pieces) {
  return once(key, () => {
    const geos = pieces.map(([geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0]) => {
      let g = geo.index ? geo.toNonIndexed() : geo.clone()
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n)
      g.applyMatrix4(tmpM.makeRotationFromEuler({ x: rx, y: ry, z: rz, order: 'XYZ', isEuler: true }).setPosition(x, y, z))
      const c = paint(color).color
      const n = g.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new BufferAttribute(arr, 3))
      return g
    })
    return mergeGeometries(geos)
  })
}

// Merges every static mesh under `holder` (skipping `live` subtrees) into one mesh per material
// family (vertex coloured) or per other material.
function mergeStatic(holder) {
  holder.updateMatrixWorld(true)
  const inv = new Matrix4().copy(holder.matrixWorld).invert()
  const groups = new Map()
  const done = []
  const walk = (o) => {
    if (o.userData.live) return
    if (o.isMesh) {
      const m = o.material
      const fam = m.userData?.family
      const key = fam ? `fam${fam}` : m.uuid
      let e = groups.get(key)
      if (!e) groups.set(key, (e = { mat: fam ? familyMat(fam) : m, geos: [] }))
      tmpM.multiplyMatrices(inv, o.matrixWorld)
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      g.applyMatrix4(tmpM)
      const keepUv = !fam && !!m.map
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && !(n === 'uv' && keepUv)) g.deleteAttribute(n)
      if (fam) {
        const n = g.attributes.position.count
        const arr = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
          arr[i * 3] = m.color.r
          arr[i * 3 + 1] = m.color.g
          arr[i * 3 + 2] = m.color.b
        }
        g.setAttribute('color', new BufferAttribute(arr, 3))
      }
      g.morphAttributes = {}
      g.clearGroups()
      e.geos.push(g)
      done.push(o)
    }
    for (const c of o.children) walk(c)
  }
  walk(holder)
  for (const o of done) o.parent.remove(o)
  for (const e of groups.values()) {
    const g = mergeGeometries(e.geos)
    for (const x of e.geos) x.dispose()
    if (!g) continue
    const m = new Mesh(g, e.mat)
    m.castShadow = true
    m.receiveShadow = true
    holder.add(m)
  }
}

// --- Bones ---------------------------------------------------------------------------------------------
const BONES = {
  torso: ['Spine1'],
  head: ['Neck1'],
  upper: (s) => [s > 0 ? 'ArmL1' : 'ArmR1'],
  lower: (s) => (s > 0 ? ['ArmL2', 'ArmL1'] : ['ArmR2', 'ArmR1']),
  thigh: (s) => [s > 0 ? 'LegL1' : 'LegR1'],
  shin: (s) => (s > 0 ? ['LegL2', 'LegL1'] : ['LegR2', 'LegR1']),
}

// --- Armour pieces (rig units, around the part's anchor) --------------------------------------------
// p: { main, dark, mid, trim, glow }
function fist(g, p, s, f, fx, grey = p.mid) {
  rb(g, 1.7 * f, 0.95 * f, 1.75 * f, p.dark, 0, 0.12 * f, 0)
  rb(g, 1.78 * f, 0.42 * f, 0.58 * f, grey, 0, 0, 0.74 * f)
  for (let i = 0; i < 4; i++) {
    const x = (-0.6 + i * 0.4) * f
    rb(g, 0.36 * f, 0.6 * f, 0.46 * f, grey, x, -0.55 * f, 0.72 * f)
    rb(g, 0.34 * f, 0.44 * f, 0.42 * f, grey, x, -0.98 * f, 0.5 * f, 0.55)
  }
  rb(g, 0.44 * f, 0.82 * f, 0.52 * f, grey, -s * 0.98 * f, -0.3 * f, 0.42 * f, 0, 0, s * 0.35)
  marker(g, 0, -0.6 * f, 0.6 * f, fx.fists)
}

function head(g, p, style) {
  if (style === 'titan') {
    rb(g, 2.0, 2.0, 2.05, p.main, 0, 0, 0, 0, 0, 0, 0.45)
    rb(g, 1.55, 1.3, 0.18, p.trim, 0, -0.15, 1.0)
    for (const s of SIDES) {
      rb(g, 0.5, 0.15, 0.08, lit(p.glow, 3.6), s * 0.36, 0.15, 1.1, 0, 0, s * -0.12, 0.03)
      rb(g, 0.24, 0.9, 0.5, p.dark, s * 1.02, -0.2, 0.3)
    }
    for (let i = 0; i < 3; i++) bx(g, 0.6, 0.05, 0.04, p.dark, 0, -0.42 - i * 0.12, 1.1)
    rb(g, 0.36, 0.42, 1.8, p.trim, 0, 1.0, -0.05)
    return
  }
  rb(g, 2.15, 1.95, 2.15, p.main, 0, 0, 0, 0, 0, 0, 0.4)
  rb(g, 1.8, 0.5, 0.14, lit(p.glow, 2.8), 0, 0.15, 1.07, 0, 0, 0, 0.05)
  rb(g, 1.4, 0.38, 0.16, p.dark, 0, -0.6, 1.05)
  if (style === 'mech') rb(g, 2.22, 0.38, 2.22, p.hazardHead ?? mats.hazard(), 0, 0.98, 0, 0, 0, 0, 0.08)
  else rb(g, 0.36, 0.42, 1.9, p.trim, 0, 1.0, -0.05)
  for (const s of SIDES) {
    cy(g, 0.44, 0.44, 0.24, p.dark, s * 1.12, 0, 0, 0, 0, Math.PI / 2, 18)
    cy(g, 0.25, 0.25, 0.28, lit(p.glow, 2.6), s * 1.14, 0, 0, 0, 0, Math.PI / 2, 14)
    cy(g, 0.05, 0.05, 0.9, p.mid, s * 0.7, 1.45, -0.55, 0, 0, 0, 6)
    mesh(g, sphereGeo(0.11), lit(p.glow, 3), s * 0.7, 1.92, -0.55, 0, 0, 0, false)
  }
}

// The big suit (mech, black mech, Titan, the transformers' robot form).
// o: { head, core, fist, footJets, backJets, shoulderWheel, stacks, chest: fn(g), back: fn(g) }
function suit(p, fx, o = {}) {
  const parts = []
  const add = (bones, at, build) => parts.push({ bones, at, build })
  add(BONES.torso, [0, 3.65, 0], (g) => {
    rb(g, 3.4, 2.75, 2.25, p.main, 0, 0, 0, 0, 0, 0, 0.4)
    rb(g, 2.7, 1.35, 0.3, p.dark, 0, 0.35, 1.12)
    if (o.chest) o.chest(g)
    else if (o.core) {
      lens(g, 0, 0.35, 1.32, 0.5, p, 'z')
      for (const s of SIDES) rb(g, 0.42, 0.12, 0.08, lit(p.glow, 2.6), s * 0.95, 0.35, 1.3, 0, 0, 0, 0.03)
    } else {
      for (const s of SIDES) rb(g, 0.85, 0.26, 0.1, lit(p.glow, 3), s * 0.62, 0.62, 1.29, 0, 0, 0, 0.04)
      for (let i = 0; i < 4; i++) rb(g, 1.7, 0.1, 0.08, p.mid, 0, 0.26 - i * 0.18, 1.29, 0, 0, 0, 0.03)
    }
    for (let i = 0; i < 3; i++) bx(g, 2.0, 0.12, 0.1, p.dark, 0, -0.55 - i * 0.22, 1.13)
    for (const s of SIDES) {
      rb(g, 0.34, 2.1, 1.7, p.dark, s * 1.74, 0, 0)
      rb(g, 0.1, 1.5, 0.1, lit(p.glow, 2.6), s * 1.92, 0, 0.5, 0, 0, 0, 0.03)
    }
    rb(g, 3.55, 0.48, 2.4, p.dark, 0, -1.3, 0)
    rb(g, 1.0, 0.38, 0.16, p.trim, 0, -1.3, 1.2)
    rb(g, 2.3, 0.42, 1.9, p.dark, 0, 1.48, 0)
    // Back unit with exhausts and vents.
    rb(g, 2.7, 2.3, 1.0, p.main, 0, 0.1, -1.5)
    rb(g, 2.1, 1.6, 0.2, p.dark, 0, 0.1, -2.02)
    for (let i = 0; i < 4; i++) bx(g, 1.5, 0.1, 0.08, p.mid, 0, -0.35 + i * 0.25, -2.14)
    for (const s of SIDES) {
      cy(g, 0.24, 0.28, 1.2, p.mid, s * 0.8, 1.55, -1.5, 0, 0, 0, 12)
      cy(g, 0.3, 0.3, 0.12, p.dark, s * 0.8, 2.15, -1.5, 0, 0, 0, 12)
    }
    if (o.backJets) {
      for (const s of SIDES) {
        cy(g, 0.36, 0.5, 0.9, p.mid, s * 0.78, -1.15, -1.55, 0, 0, 0, 14)
        cy(g, 0.52, 0.52, 0.14, p.dark, s * 0.78, -1.6, -1.55, 0, 0, 0, 14)
        fx.flames.push(flame(g, s * 0.78, -1.68, -1.55, 1.0))
      }
    }
    if (o.back) o.back(g)
  })
  if (o.head) add(BONES.head, [0, 5.65, 0], (g) => head(g, p, o.head))
  const f = o.fist ?? 1.1
  for (const s of SIDES) {
    add(BONES.upper(s), [s * 2.15, 4.8, 0], (g) => {
      rb(g, 2.05, 1.2, 2.3, p.main, 0, 0, 0, 0, 0, 0, 0.32)
      rb(g, 2.1, 0.24, 2.36, p.dark, 0, -0.58, 0)
      for (let i = 0; i < 3; i++) cy(g, 0.12, 0.12, 0.14, p.mid, s * 0.2, 0.62, -0.6 + i * 0.6, 0, 0, 0, 8)
      rb(g, 0.12, 0.16, 1.6, lit(p.glow, 2.6), s * 1.03, 0.15, 0, 0, 0, 0, 0.04)
      if (o.shoulderWheel) {
        cy(g, 0.72, 0.72, 0.45, mats.tyre(), s * 1.2, 0.05, 0, 0, 0, Math.PI / 2, 18)
        cy(g, 0.36, 0.36, 0.5, p.mid, s * 1.2, 0.05, 0, 0, 0, Math.PI / 2, 12)
      }
      if (o.stacks) {
        cy(g, 0.2, 0.2, 2.4, chrome(), s * 0.3, 1.4, -0.6, 0, 0, 0, 12)
        cy(g, 0.25, 0.25, 0.2, p.dark, s * 0.3, 2.6, -0.6, 0, 0, 0, 12)
      }
    })
    add(BONES.upper(s), [s * 1.85, 4.3, 0], (g) => {
      cy(g, 0.62, 0.62, 0.7, p.dark, 0, 0, 0, 0, 0, Math.PI / 2, 16)
      cy(g, 0.3, 0.3, 0.76, p.mid, 0, 0, 0, 0, 0, Math.PI / 2, 12)
    })
    add(BONES.upper(s), [s * 2.0, 3.95, 0], (g) => {
      rb(g, 1.4, 1.1, 1.4, p.mid)
      cy(g, 0.12, 0.12, 1.0, chrome(), s * 0.75, 0, -0.35, 0, 0, 0, 8)
    })
    add(BONES.lower(s), [s * 2.0, 3.55, -0.05], (g) => {
      cy(g, 0.66, 0.66, 1.6, p.dark, 0, 0, 0, 0, 0, Math.PI / 2, 18)
      cy(g, 0.34, 0.34, 1.66, p.mid, 0, 0, 0, 0, 0, Math.PI / 2, 12)
    })
    add(BONES.lower(s), [s * 2.0, 2.75, 0.05], (g) => {
      rb(g, 1.8, 1.55, 1.9, p.main, 0, 0, 0, 0, 0, 0, 0.3)
      rb(g, 1.86, 0.3, 1.96, p.trim, 0, 0.62, 0)
      rb(g, 1.2, 0.7, 0.12, p.dark, 0, -0.05, 0.97)
      rb(g, 0.6, 0.16, 0.07, lit(p.glow, 2.8), 0, -0.05, 1.04, 0, 0, 0, 0.03)
      for (let i = 0; i < 3; i++) rb(g, 0.1, 0.9, 0.16, p.dark, s * 0.92, -0.1, -0.45 + i * 0.4)
    })
    add(BONES.lower(s), [s * 2.0, 1.72, 0.1], (g) => {
      fist(g, p, s, f, fx)
      if (o.palmJets) {
        cy(g, 0.32, 0.32, 0.1, lit(p.glow, 3.2), 0, -0.45, 0, 0, 0, 0, 16)
      }
    })
    add(BONES.thigh(s), [s * 0.72, 2.2, 0], (g) => cy(g, 0.55, 0.55, 0.95, p.dark, 0, 0, 0, 0, 0, Math.PI / 2, 14))
    add(BONES.thigh(s), [s * 0.75, 1.75, 0], (g) => {
      rb(g, 1.65, 1.05, 1.85, p.main, 0, 0, 0, 0, 0, 0, 0.3)
      rb(g, 0.2, 0.8, 1.3, p.dark, s * 0.85, 0, 0)
      rb(g, 1.0, 0.16, 0.08, lit(p.glow, 2.4), 0, 0.15, 0.94, 0, 0, 0, 0.03)
    })
    add(BONES.shin(s), [s * 0.75, 1.18, 0.1], (g) => {
      cy(g, 0.62, 0.62, 0.5, mats.tyre(), s * 0.98, 0, 0, 0, 0, Math.PI / 2, 18)
      cy(g, 0.32, 0.32, 0.56, p.mid, s * 0.98, 0, 0, 0, 0, Math.PI / 2, 12)
      rb(g, 1.15, 0.8, 0.42, p.main, 0, 0, 0.88)
    })
    add(BONES.shin(s), [s * 0.75, 0.75, 0], (g) => {
      rb(g, 1.45, 0.85, 1.1, p.main, 0, 0, 0.35)
      for (const dx of [-0.35, 0.35]) cy(g, 0.14, 0.14, 1.1, chrome(), dx, 0, -0.38, 0, 0, 0, 8)
      rb(g, 0.12, 0.55, 0.07, lit(p.glow, 2.4), 0, 0, 0.93, 0, 0, 0, 0.03)
    })
    add(BONES.shin(s), [s * 0.75, 0.36, 0.35], (g) => {
      rb(g, 1.95, 0.55, 2.9, p.main, 0, 0, 0, 0, 0, 0, 0.22)
      rb(g, 2.05, 0.24, 3.0, p.dark, 0, -0.3, 0)
      for (let i = 0; i < 6; i++) bx(g, 2.12, 0.1, 0.22, p.dark, 0, -0.4, -1.2 + i * 0.48)
      rb(g, 1.75, 0.32, 0.55, p.trim, 0, 0.1, 1.3, -0.35)
      rb(g, 0.55, 0.14, 0.07, lit(p.glow, 2.8), 0, 0.15, 1.5, 0, 0, 0, 0.03)
      marker(g, 0, -0.3, 0, fx.feet)
      if (o.footJets) {
        cy(g, 0.3, 0.44, 0.45, p.mid, 0, -0.2, -1.3, 0, 0, 0, 12)
        fx.flames.push(flame(g, 0, -0.45, -1.3, 0.8))
      }
    })
  }
  return parts
}

// --- Robotic arms ------------------------------------------------------------------------------------------
const ARM_L = 0.58
function armGeos() {
  const white = '#f4f6f8'
  const black = '#22252c'
  const yellow = '#ffc21a'
  const grey = '#8f97a3'
  return {
    seg: coloured('armSeg', [
      [cylGeo(0.2, 0.2, 0.42, 12), white, 0, 0.31, 0],
      [cylGeo(0.245, 0.245, 0.14, 12), black, 0, 0.04, 0],
      [cylGeo(0.215, 0.215, 0.05, 12), black, 0, 0.54, 0],
    ]),
    housing: coloured('armHousing', [
      [rbGeo(0.66, 0.56, 0.66, 0.14), yellow, 0, 0.3, 0],
      [cylGeo(0.16, 0.16, 0.72, 12), grey, 0, 0.3, 0, 0, 0, Math.PI / 2],
      [cylGeo(0.09, 0.09, 0.76, 8), black, 0, 0.3, 0, 0, 0, Math.PI / 2],
    ]),
    wrist: coloured('armWrist', [
      [cylGeo(0.26, 0.24, 0.38, 14), yellow, 0, 0.19, 0],
      [cylGeo(0.3, 0.3, 0.1, 14), grey, 0, 0.4, 0],
      [cylGeo(0.34, 0.3, 0.12, 14), black, 0, 0.5, 0],
    ]),
    finger: coloured('armFinger', [
      [rbGeo(0.18, 0.4, 0.22, 0.05), '#3a3e47', 0, 0.2, 0],
      [cylGeo(0.06, 0.1, 0.42, 8), '#2a2d34', 0, 0.58, 0.04, 0.35],
    ]),
  }
}
function roboArm(g, p, side, upper, fx, x, y, z) {
  const G = armGeos()
  const mat = familyMat('gloss')
  const yaw = new Group()
  yaw.userData.live = true
  yaw.position.set(x, y, z)
  yaw.rotation.y = Math.atan2(side, upper ? 0.85 : -0.75)
  g.add(yaw)
  const N = upper ? 14 : 12
  const joints = []
  let parent = yaw
  for (let i = 0; i < N; i++) {
    const j = new Group()
    if (i > 0) j.position.y = ARM_L
    parent.add(j)
    mesh(j, i === 6 ? G.housing : G.seg, mat, 0, 0, 0, 0, 0, 0)
    joints.push(j)
    parent = j
  }
  const wrist = new Group()
  wrist.position.y = ARM_L
  parent.add(wrist)
  mesh(wrist, G.wrist, mat, 0, 0, 0, 0, 0, 0)
  const fingers = []
  for (let k = 0; k < 3; k++) {
    const around = new Group()
    around.rotation.y = (k / 3) * Math.PI * 2
    wrist.add(around)
    const f = new Group()
    f.position.set(0, 0.52, 0.18)
    around.add(f)
    mesh(f, G.finger, mat, 0, 0, 0, 0, 0, 0, false)
    fingers.push(f)
  }
  marker(wrist, 0, 0.9, 0, fx.claws)
  fx.arms.push({ yaw, joints, fingers, side, upper, phase: (side > 0) === upper ? 0 : Math.PI })
}

// --- Gear builds --------------------------------------------------------------------------------------------
const PAL = {
  jetboots: { main: paint('#ffbf1f'), dark: paint('#2a2d35', 0.3, 0.55), mid: paint('#a3aab4', 0.55, 0.32), trim: mats.hazard(), glow: '#2fe6ff' },
  gauntlets: { main: paint('#ffc21a'), dark: paint('#2a2d35', 0.3, 0.55), mid: paint('#a8afb9', 0.5, 0.32), trim: mats.hazard(), glow: '#2fe6ff' },
  arms: { main: paint('#ffc21a'), dark: paint('#23262d', 0.3, 0.5), mid: paint('#8f97a3', 0.6, 0.3), trim: mats.hazard(), glow: '#2fe6ff' },
  mech: { main: paint('#ffbe1a'), dark: paint('#2a2d35', 0.3, 0.55), mid: paint('#a6adb7', 0.55, 0.32), trim: mats.hazard(), glow: '#2fe6ff' },
  blackmech: { main: paint('#24262d', 0.45, 0.32), dark: paint('#121318', 0.3, 0.5), mid: paint('#5d6470', 0.6, 0.3), trim: paint('#ffc21a'), glow: '#2fe6ff', hazardHead: paint('#ffc21a') },
  titan: { main: paint('#d4202d', 0.4, 0.3), dark: paint('#3a0d12', 0.3, 0.45), mid: paint('#ffb21f', 0.5, 0.3), trim: paint('#ffb21f', 0.5, 0.3), glow: '#8ff6ff' },
  mixer: { main: paint('#2f6fd0', 0.3, 0.32), dark: paint('#1c2433', 0.3, 0.5), mid: paint('#c9d0da', 0.5, 0.3), trim: paint('#ff7a1a'), glow: '#ffb347' },
  truck: { main: paint('#7a3dd1', 0.4, 0.3), dark: paint('#24202e', 0.3, 0.5), mid: chrome(), trim: paint('#f2f4f7', 0.1, 0.35), glow: '#ff5fd2' },
  jet: { main: paint('#f2f4f7', 0.15, 0.3), dark: paint('#3a3f4a', 0.35, 0.45), mid: paint('#aab2bd', 0.5, 0.3), trim: paint('#ffb21f', 0.5, 0.3), glow: '#ffc21a' },
}

function gearParts(id, fx) {
  const p = PAL[id]
  const parts = []
  const add = (bones, at, build) => parts.push({ bones, at, build })
  const hide = { pack: true }
  switch (id) {
    case 'jetboots':
      hide.pack = false
      for (const s of SIDES) {
        add(BONES.shin(s), [s * 0.72, 0.98, 0.05], (g) => {
          rb(g, 1.58, 1.25, 1.78, p.main, 0, 0, 0, 0, 0, 0, 0.3)
          rb(g, 1.64, 0.28, 1.84, p.trim, 0, 0.5, 0)
          lens(g, 0, -0.08, 0.92, 0.3, p, 'z')
          rb(g, 0.2, 0.9, 1.2, p.dark, s * 0.82, 0, 0)
          rb(g, 0.08, 0.6, 0.08, lit(p.glow, 2.6), s * 0.94, 0, 0.35, 0, 0, 0, 0.02)
        })
        add(BONES.shin(s), [s * 0.72, 0.34, 0.25], (g) => {
          rb(g, 1.82, 0.64, 2.58, p.main, 0, 0, 0, 0, 0, 0, 0.24)
          rb(g, 1.92, 0.24, 2.68, p.dark, 0, -0.35, 0)
          for (let i = 0; i < 5; i++) bx(g, 1.98, 0.1, 0.22, p.dark, 0, -0.45, -1.0 + i * 0.5)
          rb(g, 1.62, 0.32, 0.52, p.dark, 0, 0.12, 1.15, -0.3)
          rb(g, 0.5, 0.12, 0.07, lit(p.glow, 2.8), 0, 0.14, 1.38, 0, 0, 0, 0.03)
          // Heel thruster + two ankle jets.
          cy(g, 0.36, 0.52, 0.62, p.mid, 0, -0.12, -1.35, 0, 0, 0, 14)
          cy(g, 0.54, 0.54, 0.12, p.dark, 0, -0.45, -1.35, 0, 0, 0, 14)
          fx.flames.push(flame(g, 0, -0.52, -1.35, 0.85))
          for (const k of SIDES) {
            cy(g, 0.15, 0.22, 0.36, p.mid, k * 0.98, -0.02, -0.55, 0, 0, 0, 10)
            fx.flames.push(flame(g, k * 0.98, -0.22, -0.55, 0.38))
          }
          marker(g, 0, -0.4, 0, fx.feet)
        })
      }
      break
    case 'gauntlets':
      hide.pack = false
      for (const s of SIDES) {
        add(BONES.lower(s), [s * 2.0, 3.72, 0], (g) => {
          rb(g, 1.55, 0.5, 1.65, p.dark)
          cy(g, 0.5, 0.5, 1.7, p.dark, 0, 0, 0, 0, 0, Math.PI / 2, 16)
          cy(g, 0.26, 0.26, 1.76, p.mid, 0, 0, 0, 0, 0, Math.PI / 2, 12)
        })
        add(BONES.lower(s), [s * 2.0, 2.85, 0.05], (g) => {
          rb(g, 2.15, 1.95, 2.25, p.main, 0, 0, 0, 0, 0, 0, 0.4)
          rb(g, 2.2, 0.36, 2.3, p.trim, 0, 0.84, 0)
          lens(g, 0, -0.05, 1.15, 0.44, p, 'z')
          for (let i = 0; i < 3; i++) rb(g, 0.12, 1.0, 0.18, p.dark, s * 1.1, -0.1, -0.55 + i * 0.4)
          rb(g, 1.5, 0.18, 1.5, p.dark, 0, -0.98, 0)
          for (let i = 0; i < 4; i++) cy(g, 0.17, 0.17, 1.9, p.mid, 0, -1.02, -0.75 + i * 0.5, 0, 0, Math.PI / 2, 10) // rollers
          rb(g, 0.08, 1.2, 0.08, lit(p.glow, 2.6), -s * 1.1, 0, 0.6, 0, 0, 0, 0.02)
        })
        add(BONES.lower(s), [s * 2.0, 1.55, 0.3], (g) => fist(g, p, s, 1.32, fx))
      }
      break
    case 'arms':
      add(BONES.torso, [0, 3.95, -1.7], (g) => {
        rb(g, 2.5, 2.7, 1.4, p.main, 0, 0, 0, 0, 0, 0, 0.4)
        rb(g, 1.75, 1.75, 0.22, p.dark, 0, 0, -0.72, 0, 0, 0, 0.2)
        lens(g, 0, 0, -0.86, 0.55, p, 'z-')
        for (const s of SIDES) {
          rb(g, 0.36, 2.3, 1.2, p.dark, s * 1.26, 0, 0)
          rb(g, 0.48, 0.28, 1.6, p.dark, s * 0.8, 1.2, 0.95) // straps
          rb(g, 0.48, 0.28, 1.6, p.dark, s * 0.8, -1.0, 0.95)
          mesh(g, sphereGeo(0.42), p.dark, s * 1.05, 1.1, -0.25, 0, 0, 0)
          mesh(g, sphereGeo(0.42), p.dark, s * 1.2, -0.95, -0.25, 0, 0, 0)
          roboArm(g, p, s, true, fx, s * 1.05, 1.15, -0.25)
          roboArm(g, p, s, false, fx, s * 1.2, -0.95, -0.25)
        }
      })
      break
    case 'mech':
      parts.push(...suit(p, fx, { head: 'mech', fist: 1.2 }))
      break
    case 'blackmech':
      parts.push(...suit(p, fx, { head: 'mech', fist: 1.22, footJets: true, backJets: true }))
      break
    case 'titan':
      parts.push(...suit(p, fx, { head: 'titan', core: true, fist: 1.1, footJets: true, backJets: true, palmJets: true }))
      break
    case 'mixer':
      parts.push(
        ...suit(p, fx, {
          head: 'visor',
          shoulderWheel: true,
          chest: (g) => {
            for (const s of SIDES) rb(g, 0.6, 0.32, 0.1, mats.lamp(), s * 0.75, 0.62, 1.29, 0, 0, 0, 0.05)
            for (let i = 0; i < 4; i++) rb(g, 1.7, 0.1, 0.08, p.mid, 0, 0.22 - i * 0.18, 1.29, 0, 0, 0, 0.03)
          },
          back: (g) => {
            // A cement drum on the back that keeps turning.
            const pts = [new Vector2(0.01, 0), new Vector2(0.55, 0.15), new Vector2(0.95, 0.9), new Vector2(1.0, 2.0), new Vector2(0.75, 3.0), new Vector2(0.4, 3.5), new Vector2(0.01, 3.55)]
            const drum = new Group()
            drum.userData.live = true
            const shell = new Mesh(once('drumGeo', () => new LatheGeometry(pts, 16)), paint('#f2f4f7', 0.15, 0.35))
            shell.castShadow = true
            drum.add(shell)
            for (let i = 0; i < 3; i++) {
              const ring = new Mesh(once(`drumRing${i}`, () => new TorusGeometry(0.97 - Math.abs(i - 1) * 0.06, 0.08, 6, 20)), paint('#ff7a1a'))
              ring.rotation.x = Math.PI / 2
              ring.position.y = 1.0 + i * 0.7
              ring.rotation.y = i * 0.6
              drum.add(ring)
            }
            drum.rotation.x = -Math.PI / 2 + 0.55
            drum.position.set(0, 0.2, -1.7)
            g.add(drum)
            fx.spin.push(drum)
          },
        }),
      )
      break
    case 'truck':
      parts.push(
        ...suit(p, fx, {
          head: 'visor',
          stacks: true,
          chest: (g) => {
            rb(g, 1.5, 1.05, 0.14, chrome(), 0, -0.05, 1.3, 0, 0, 0, 0.05)
            for (let i = 0; i < 5; i++) bx(g, 0.08, 0.9, 0.06, p.dark, -0.56 + i * 0.28, -0.05, 1.39)
            for (const s of SIDES) {
              rb(g, 0.95, 0.55, 0.1, glass(), s * 0.72, 0.72, 1.3, 0, 0, 0, 0.04)
              rb(g, 0.38, 0.22, 0.08, mats.lamp(), s * 1.0, 0.0, 1.32, 0, 0, 0, 0.04)
            }
          },
        }),
      )
      break
    case 'jet':
      parts.push(
        ...suit(p, fx, {
          head: 'visor',
          footJets: true,
          backJets: true,
          chest: (g) => {
            rb(g, 1.3, 0.85, 0.3, glass(), 0, 0.35, 1.3, 0, 0, 0, 0.12)
            for (const s of SIDES) rb(g, 0.5, 0.12, 0.08, lit(p.glow, 2.6), s * 0.95, 0.35, 1.3, 0, 0, 0, 0.03)
          },
          back: (g) => {
            for (const s of SIDES) {
              const wing = new Group()
              wing.position.set(s * 0.9, 0.4, -1.7)
              wing.rotation.set(0, s * 0.35, s * 0.4)
              g.add(wing)
              rb(wing, 4.4, 0.16, 1.7, p.main, s * 2.2, 0, 0, 0, 0, 0, 0.06)
              rb(wing, 1.3, 0.18, 1.72, p.trim, s * 3.75, 0, 0, 0, 0, 0, 0.06)
              rb(wing, 0.14, 0.7, 1.0, p.main, s * 4.35, 0.32, -0.3, 0, 0, 0, 0.05)
              rb(wing, 0.5, 0.1, 0.06, lit('#ff3a3a', 3), s * 4.1, 0.1, 0.86, 0, 0, 0, 0.03)
            }
            rb(g, 0.16, 1.7, 1.2, p.main, 0, 1.55, -1.8, -0.35, 0, 0, 0.06)
          },
        }),
      )
      break
  }
  return { parts, hide }
}

// Dresses `root` (an avatar with `nodes`) in a gear piece. Returns
// { id, assemble(k), landed(), finalize(), update(dt, ctx), setVisible(on), remove(), points }.
// assemble(k): 0 = every part away from the body, 1 = all in place (each part lands in turn).
// finalize(): merge the static meshes (call once assembled). `merge` does both straight away.
export function wearGear(root, id, { merge = false } = {}) {
  const fx = { flames: [], arms: [], spin: [], fists: [], feet: [], claws: [] }
  const { parts, hide } = gearParts(id, fx)
  const placed = []
  const holders = new Map()
  const hasHelmet = parts.some((pt) => pt.bones === BONES.head)
  const hasChest = parts.some((pt) => pt.bones === BONES.torso && pt.at[1] === 3.65 && pt.at[2] === 0)
  const centre = new Vector3(0, 3.2, 0)
  // Attach against the bind pose even if the avatar is mid-animation (characters.js dressWorker
  // records it); the pose is put back right after.
  const rest = root.userData.restPose
  const posed = []
  if (rest) {
    for (const [bone, q] of rest) {
      posed.push([bone, bone.quaternion.clone()])
      bone.quaternion.copy(q)
    }
  }
  root.updateMatrixWorld(true)
  const rootInv = new Matrix4().copy(root.matrixWorld).invert()
  for (const pt of parts) {
    const bone = pt.bones.map((n) => root.nodes?.[n]).find(Boolean)
    if (!bone) continue
    let holder = holders.get(bone)
    if (!holder) {
      // One holder per bone, set so that its local space is the root's bind-pose space.
      holder = new Group()
      const inRoot = rootInv.clone().multiply(bone.matrixWorld)
      inRoot.invert().decompose(holder.position, holder.quaternion, holder.scale)
      bone.add(holder)
      holders.set(bone, holder)
    }
    const sub = new Group()
    sub.position.set(...pt.at)
    const inner = new Group()
    sub.add(inner)
    pt.build(inner)
    holder.add(sub)
    const at = new Vector3(...pt.at)
    const away = at.clone().sub(centre)
    away.y *= 0.4
    if (away.lengthSq() < 0.01) away.set(0, 0, 1)
    away.normalize().multiplyScalar(4.5).add(new Vector3(0, 3.2, 0))
    placed.push({ inner, from: away, delay: 0, done: true })
  }
  for (const [bone, q] of posed) bone.quaternion.copy(q)
  // Torso first, then shoulders/arms, then legs, helmet last.
  placed.forEach((pl, i) => (pl.delay = (i / Math.max(1, placed.length)) * 0.55))
  const hat = root.getObjectByName('hardHat')
  const vest = root.getObjectByName('workVest')
  const pack = root.getObjectByName('workPack')
  if (hasHelmet && hat) hat.visible = false
  if (hasChest && vest) vest.visible = false
  if (hide.pack && pack) pack.visible = false
  let landedNow = 0
  let merged = false
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  const api = {
    id,
    count: placed.length,
    points: fx,
    assemble(k) {
      if (merged) return
      for (const pl of placed) {
        const t = Math.min(1, Math.max(0, (k - pl.delay) / 0.45))
        const e = ease(t)
        pl.inner.position.copy(pl.from).multiplyScalar(1 - e)
        pl.inner.scale.setScalar(Math.max(0.001, t === 0 ? 0.001 : 0.35 + 0.65 * e))
        pl.inner.rotation.y = (1 - e) * 2.5
        const done = t >= 1
        if (done && !pl.done) landedNow++
        pl.done = done
      }
    },
    // How many parts locked into place since the last call (for clanks and sparks).
    landed() {
      const n = landedNow
      landedNow = 0
      return n
    },
    finalize() {
      if (merged) return
      api.assemble(1)
      merged = true
      for (const h of holders.values()) mergeStatic(h)
    },
    // ctx: { t, thrust 0..1, building, speed m/s, step (walk phase, rad) }
    update(dt, ctx) {
      const t = ctx.t
      for (const f of fx.flames) {
        const on = ctx.thrust > 0.04
        f.visible = on
        if (on) {
          const s = f.userData.size * (0.35 + ctx.thrust * 0.8) * (0.85 + Math.random() * 0.3)
          const w = f.userData.size * (0.8 + ctx.thrust * 0.3)
          f.scale.set(w, s, w)
        }
      }
      for (const d of fx.spin) d.rotateY(dt * 2.2)
      const walking = (ctx.speed ?? 0) > 1 && !ctx.building
      for (const a of fx.arms) {
        const step = walking ? Math.max(0, Math.sin((ctx.step ?? 0) + a.phase)) : 0
        const breathe = Math.sin(t * 1.6 + a.phase) * 0.03
        const reach = ctx.building && a.upper
        const lift = reach ? 0.95 + Math.sin(t * 5 + a.phase) * 0.12 : (a.upper ? 0.12 : 0.55) + step * 0.3 + breathe
        a.joints.forEach((j, i) => {
          if (i === 0) {
            j.rotation.x = lift
            return
          }
          const arch = a.upper ? 6 : 5
          let bend = i <= arch ? (a.upper ? 0.4 : 0.43) : 0.03
          if (reach) bend = i <= arch ? 0.14 : 0.06
          j.rotation.x = bend + (i <= arch ? step * 0.04 - breathe * 0.5 : 0)
          j.rotation.z = Math.sin(t * 1.3 + i * 0.4 + a.phase) * 0.02
        })
        const grip = ctx.building ? 0.25 + 0.45 * Math.abs(Math.sin(t * 7 + a.phase)) : 0.55 + 0.1 * Math.sin(t * 2 + a.phase) - step * 0.3
        for (const f of a.fingers) f.rotation.x = grip
      }
    },
    setVisible(on) {
      for (const h of holders.values()) h.visible = on
    },
    remove() {
      for (const h of holders.values()) h.parent?.remove(h)
      if (hat) hat.visible = true
      if (vest) vest.visible = true
      if (pack) pack.visible = true
    },
  }
  if (merge) api.finalize()
  return api
}

// --- Vehicles (metres, base at y = 0, front +Z) -----------------------------------------------------------
function wheel(g, x, y, z, r = 0.6, w = 0.45) {
  cy(g, r, r, w, mats.tyre(), x, y, z, 0, 0, Math.PI / 2, 16)
  cy(g, r * 0.55, r * 0.55, w + 0.04, chrome(), x, y, z, 0, 0, Math.PI / 2, 10)
}

function makeBigRig() {
  const g = new Group()
  const body = paint('#7a3dd1', 0.45, 0.32)
  const dark = paint('#24202e', 0.4, 0.5)
  bx(g, 2.3, 0.5, 9.0, dark, 0, 0.85, -0.6) // chassis
  bx(g, 2.4, 1.5, 2.8, body, 0, 1.85, 3.1) // hood
  bx(g, 2.6, 2.6, 2.3, body, 0, 2.55, 0.85) // cab
  bx(g, 2.6, 3.0, 1.8, body, 0, 2.75, -1.2) // sleeper
  bx(g, 2.5, 0.6, 2.8, body, 0, 4.4, -0.4, -0.12) // roof fairing
  bx(g, 2.2, 1.0, 0.08, glass(), 0, 3.15, 2.02, -0.15) // windscreen
  for (const s of SIDES) {
    bx(g, 0.08, 0.7, 1.1, glass(), s * 1.31, 3.1, 1.05)
    bx(g, 0.06, 0.28, 6.2, paint('#f2f4f7', 0.2, 0.4), s * 1.31, 2.0, 0.3) // stripe
    cy(g, 0.18, 0.18, 3.6, chrome(), s * 1.42, 3.0, -0.25, 0, 0, 0, 12) // smokestacks
    cy(g, 0.42, 0.42, 1.6, chrome(), s * 1.3, 1.05, 1.0, Math.PI / 2, 0, 0, 14) // fuel tanks
    bx(g, 0.5, 0.3, 0.08, mats.lamp(), s * 0.85, 1.75, 4.52)
  }
  bx(g, 1.7, 1.25, 0.12, chrome(), 0, 1.95, 4.5) // grille
  for (let i = 0; i < 6; i++) bx(g, 0.08, 1.1, 0.06, dark, -0.62 + i * 0.25, 1.95, 4.58)
  bx(g, 2.6, 0.42, 0.3, chrome(), 0, 0.95, 4.65) // bumper
  bx(g, 1.8, 0.2, 1.8, dark, 0, 1.2, -3.2) // fifth wheel
  for (const s of SIDES) {
    wheel(g, s * 1.2, 0.6, 3.2)
    for (const z of [-2.4, -3.8]) {
      wheel(g, s * 1.05, 0.6, z)
      wheel(g, s * 1.48, 0.6, z, 0.6, 0.35)
    }
  }
  return g
}

function makeJet(flames) {
  const g = new Group()
  const white = paint('#f2f4f7', 0.3, 0.3)
  const gold = paint('#ffb21f', 0.35, 0.35)
  const dark = paint('#3a3f4a', 0.45, 0.4)
  cy(g, 0.85, 0.95, 8, white, 0, 1.7, -0.6, Math.PI / 2, 0, 0, 16) // fuselage
  const nose = new Mesh(once('jetNose', () => new ConeGeometry(0.85, 2.6, 16)), white)
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.7, 4.7)
  nose.castShadow = true
  g.add(nose)
  const canopy = new Mesh(sphereGeo(0.8), glass())
  canopy.scale.set(0.75, 0.6, 1.9)
  canopy.position.set(0, 2.35, 2.0)
  g.add(canopy)
  for (const s of SIDES) {
    const wing = new Group()
    wing.position.set(s * 0.8, 1.5, -0.6)
    wing.rotation.y = s * -0.42
    g.add(wing)
    bx(wing, 4.6, 0.18, 2.5, white, s * 2.3, 0, 0)
    bx(wing, 1.0, 0.2, 2.52, gold, s * 4.1, 0, 0)
    bx(g, 0.18, 1.9, 1.6, white, s * 0.75, 2.8, -4.0, 0.25, 0, s * -0.3) // tail fins
    bx(g, 2.2, 0.12, 1.2, white, s * 1.6, 1.85, -4.2, 0, s * -0.3) // stabilisers
    cy(g, 0.5, 0.5, 2.0, dark, s * 1.15, 1.35, -3.6, Math.PI / 2, 0, 0, 12) // engines
    flames.push(flame(g, s * 1.15, 1.35, -4.6, 1.2, 'back'))
    bx(g, 0.12, 0.7, 0.12, dark, s * 1.4, 0.55, -0.6) // landing gear
    cy(g, 0.28, 0.28, 0.2, mats.tyre(), s * 1.4, 0.28, -0.6, 0, 0, Math.PI / 2, 10)
  }
  bx(g, 0.12, 0.9, 0.12, dark, 0, 0.6, 3.6)
  cy(g, 0.26, 0.26, 0.2, mats.tyre(), 0, 0.26, 3.6, 0, 0, Math.PI / 2, 10)
  bx(g, 0.06, 0.25, 5.5, gold, 0.86, 1.8, 0.4)
  bx(g, 0.06, 0.25, 5.5, gold, -0.86, 1.8, 0.4)
  return g
}

// Returns { group, update(dt, ctx) }; ctx: { speed m/s, thrust 0..1 }.
export function makeVehicle(kind, scale = 0.55) {
  const fx = { flames: [], spin: [], wheels: [] }
  let model
  if (kind === 'mixer') {
    model = makeMixerTruck('#2f6fd0')
    fx.spin.push(model.userData.drum)
  } else if (kind === 'truck') model = makeBigRig()
  else model = makeJet(fx.flames)
  const group = new Group()
  model.scale.setScalar(scale)
  group.add(model)
  model.traverse((o) => {
    if (o.isMesh) o.castShadow = true
  })
  return {
    group,
    model,
    update(dt, ctx) {
      for (const d of fx.spin) d.rotateY(dt * 1.8)
      for (const f of fx.flames) {
        const on = ctx.thrust > 0.04
        f.visible = on
        if (on) {
          const s = f.userData.size * (0.4 + ctx.thrust * 0.9) * (0.85 + Math.random() * 0.3)
          f.scale.set(f.userData.size, s, f.userData.size)
        }
      }
    },
  }
}

// --- Dropship (Titan Armor's delivery), metres, front +Z --------------------------------------------------
export function makeDropship() {
  const g = new Group()
  const red = paint('#d61f2c', 0.55, 0.3)
  const dark = paint('#2a1014', 0.5, 0.45)
  const gold = paint('#ffb21f', 0.35, 0.35)
  bx(g, 5.2, 2.2, 8.5, red, 0, 0, 0)
  bx(g, 4.0, 1.5, 2.6, red, 0, -0.25, 5.2, 0.12)
  bx(g, 3.0, 0.9, 1.8, glass(), 0, 0.85, 4.4, -0.25)
  bx(g, 3.6, 1.2, 3.0, red, 0, 1.4, -2.2)
  bx(g, 5.3, 0.3, 8.6, gold, 0, -1.0, 0)
  bx(g, 0.3, 2.4, 2.4, red, 0, 2.2, -3.6) // fin
  for (let i = 0; i < 5; i++) bx(g, 4.0, 0.12, 0.3, dark, 0, -1.15, -3 + i * 1.5) // vents underneath
  const rotors = []
  for (const [x, z] of [[-4.6, 3], [4.6, 3], [-4.6, -3], [4.6, -3]]) {
    bx(g, Math.abs(x) - 2.2, 0.5, 0.7, dark, Math.sign(x) * (2.6 + (Math.abs(x) - 2.6) / 2), 0.2, z)
    const duct = new Mesh(once('duct', () => new TorusGeometry(1.8, 0.38, 8, 26)), red)
    duct.rotation.x = Math.PI / 2
    duct.position.set(x, 0.3, z)
    duct.castShadow = true
    g.add(duct)
    const rotor = new Group()
    rotor.position.set(x, 0.3, z)
    g.add(rotor)
    bx(rotor, 3.4, 0.08, 0.36, dark, 0, 0, 0, 0, 0, 0, false)
    bx(rotor, 0.36, 0.08, 3.4, dark, 0, 0, 0, 0, 0, 0, false)
    const glowDisc = new Mesh(cylGeo(1.5, 1.5, 0.04, 20), flameMat('#ffb36b', 0.22))
    glowDisc.position.y = -0.2
    rotor.add(glowDisc)
    rotors.push(rotor)
  }
  for (const s of SIDES) {
    bx(g, 0.3, 1.8, 0.3, dark, s * 1.6, -1.9, 1.2, 0, 0, s * 0.2) // claws
    bx(g, 0.3, 1.8, 0.3, dark, s * 1.6, -1.9, -1.2, 0, 0, s * 0.2)
    bx(g, 0.8, 0.24, 0.1, lit('#ffd23a', 3), s * 1.8, 0.2, 4.31)
  }
  return {
    group: g,
    update(dt) {
      for (const r of rotors) r.rotateY(dt * 22)
    },
  }
}

// The armour pod a dropship lets go of: a red and gold capsule.
export function makePod() {
  const g = new Group()
  const red = paint('#d61f2c', 0.55, 0.3)
  const gold = paint('#ffb21f', 0.35, 0.35)
  cy(g, 0.9, 1.1, 2.6, red, 0, 1.3, 0, 0, 0, 0, 16)
  cy(g, 1.15, 1.15, 0.3, gold, 0, 0.6, 0, 0, 0, 0, 16)
  cy(g, 0.95, 0.95, 0.3, gold, 0, 2.3, 0, 0, 0, 0, 16)
  const cap = new Mesh(sphereGeo(0.9), red)
  cap.scale.y = 0.6
  cap.position.y = 2.6
  g.add(cap)
  bx(g, 0.5, 0.9, 0.08, lit('#7ff3ff', 3), 0, 1.4, 1.0)
  return g
}

