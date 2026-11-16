import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { COMPOUND, LAYOUT } from './config.js'
import { bake } from './bake.js'
import { box, cyl, flatText, label, neon, put, solidBox, solidFootprint, solidPole, std } from './propkit.js'
import {
  makeBanner,
  makeBarrel,
  makeBarrier,
  makeCabin,
  makeCone,
  makeContainer,
  makeFlatbed,
  makeGenerator,
  makeLamp,
  makeMixerTruck,
  makePallet,
  makePile,
  makePipes,
  makeWaterTank,
  mats,
} from './props.js'
import { mulberry32, paintAsphalt, paintBlock, paintConcrete, paintPavers, toTexture } from './textures.js'

// The fenced construction compound around the tower: asphalt roads, paved walkways and
// the spawn plaza, a chain-link fence with banners and an entrance arch, street lamps that
// glow at night, parked trucks, containers, cabins and site clutter, and the Upgrades and
// Shop kiosks. Static meshes are baked into a few draw calls per material.

let blockMatCache = null
// The grey stone block every system shares (pit stacks, pallets, the tower's roof blocks).
export function blockMaterial() {
  if (!blockMatCache) blockMatCache = new MeshStandardMaterial({ map: toTexture(paintBlock(), { srgb: true }), roughness: 0.85 })
  return blockMatCache
}

// --- Ground overlays ----------------------------------------------------------------------
function flat(root, geo, mat, x, z, y, yaw = 0) {
  const m = new Mesh(geo, mat)
  m.rotation.set(-Math.PI / 2, 0, yaw)
  m.position.set(x, y, z)
  m.receiveShadow = true
  root.add(m)
  return m
}

function paverMaterial(repeatX, repeatY, cache) {
  const key = `${repeatX}|${repeatY}`
  if (cache.has(key)) return cache.get(key)
  const color = toTexture(cache.paint.color, { repeat: 1, srgb: true })
  const normal = toTexture(cache.paint.normal)
  color.repeat.set(repeatX, repeatY)
  normal.repeat.set(repeatX, repeatY)
  const m = new MeshStandardMaterial({ map: color, normalMap: normal, normalScale: new Vector2(0.6, 0.6), roughness: 0.9 })
  cache.set(key, m)
  return m
}

function buildGround(root) {
  const pav = new Map()
  pav.paint = paintPavers()
  const P = 8 // m per paver tile
  const rect = (x0, z0, x1, z1, y = 0.03) => {
    const w = x1 - x0
    const d = z1 - z0
    flat(root, new PlaneGeometry(w, d), paverMaterial(w / P, d / P, pav), (x0 + x1) / 2, (z0 + z1) / 2, y)
    // A low concrete kerb all round.
  }
  // Tower apron, the avenue to the plaza and walkways to the pit, gym and kiosks.
  rect(-46, -114, 46, -42, 0.03)
  rect(-18, -42, 24, -4, 0.032)
  rect(-44, 4, -10, 18, 0.034)
  rect(10, 2, 56, 14, 0.034)
  rect(-6, 20, 6, 46, 0.034)
  rect(-34, 33, 34, 46, 0.033)
  // South of the road: walks to the Egg Hall entrance and the Spin stage.
  rect(LAYOUT.eggs.x - 8, 54, LAYOUT.eggs.x + 8, LAYOUT.eggs.z - 17.5, 0.034)
  rect(LAYOUT.spin.x - 6, 54, LAYOUT.spin.x + 6, LAYOUT.spin.z - 5, 0.034)
  // Plaza: round paved pad with a concrete rim and an inlaid compass ring.
  const plaza = LAYOUT.plaza
  const conc = new MeshStandardMaterial({ map: toTexture(paintConcrete(), { repeat: 1 / 6, srgb: true }), roughness: 0.9 })
  flat(root, new CircleGeometry(plaza.r + 1.2, 48), conc, plaza.x, plaza.z, 0.036)
  flat(root, new CircleGeometry(plaza.r, 48), paverMaterial(3.5, 3.5, pav), plaza.x, plaza.z, 0.04)
  flat(root, new RingGeometry(plaza.r * 0.42, plaza.r * 0.48, 48), std('#ffc21a', { roughness: 0.5 }), plaza.x, plaza.z, 0.045)
  flat(root, new CircleGeometry(plaza.r * 0.42, 40), std('#9aa0a8', { roughness: 0.8 }), plaza.x, plaza.z, 0.044)

  // Roads.
  const asphalt = paintAsphalt()
  LAYOUT.roads.forEach(([x1, z1, x2, z2, w], i) => {
    const len = Math.hypot(x2 - x1, z2 - z1)
    const tex = toTexture(asphalt, { srgb: true })
    tex.repeat.set(len / 10, 1)
    const m = new MeshStandardMaterial({ map: tex, roughness: 0.92 })
    const yaw = Math.atan2(-(z2 - z1), x2 - x1)
    flat(root, new PlaneGeometry(len + w, w), m, (x1 + x2) / 2, (z1 + z2) / 2, 0.02 + i * 0.002, yaw)
  })
}

// --- Fence --------------------------------------------------------------------------------
function chainLinkTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  ctx.strokeStyle = 'rgba(200,205,212,0.95)'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(64, 64)
  ctx.moveTo(64, 0)
  ctx.lineTo(0, 64)
  ctx.stroke()
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  return t
}

function buildFence(root, statics) {
  const { minX, maxX, minZ, maxZ, fenceHeight: H, gateHalf } = COMPOUND
  const tex = chainLinkTexture()
  const sides = [
    [minX, minZ, maxX, minZ],
    [maxX, minZ, maxX, maxZ],
    [maxX, maxZ, gateHalf + 3, maxZ],
    [-gateHalf - 3, maxZ, minX, maxZ],
    [minX, maxZ, minX, minZ],
  ]
  const posts = []
  for (const [x1, z1, x2, z2] of sides) {
    const len = Math.hypot(x2 - x1, z2 - z1)
    const t = tex.clone()
    t.repeat.set(len / 0.9, H / 0.9)
    t.needsUpdate = true
    const m = new MeshStandardMaterial({ map: t, alphaTest: 0.35, side: DoubleSide, metalness: 0.5, roughness: 0.5 })
    const panel = new Mesh(new PlaneGeometry(len, H - 0.3), m)
    panel.position.set((x1 + x2) / 2, H / 2 + 0.1, (z1 + z2) / 2)
    panel.rotation.y = Math.atan2(-(z2 - z1), x2 - x1)
    root.add(panel)
    const n = Math.ceil(len / 6)
    for (let i = 0; i <= n; i++) posts.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n])
    // Top rail.
    const rail = new Mesh(new BoxGeometry(len, 0.08, 0.08), mats.steel())
    rail.position.set((x1 + x2) / 2, H, (z1 + z2) / 2)
    rail.rotation.y = panel.rotation.y
    statics.add(rail)
  }
  const postGeo = new CylinderGeometry(0.07, 0.07, H + 0.2, 6)
  postGeo.translate(0, (H + 0.2) / 2, 0)
  const inst = new InstancedMesh(postGeo, mats.steel(), posts.length)
  const m4 = new Matrix4()
  posts.forEach(([x, z], i) => inst.setMatrixAt(i, m4.makeTranslation(x, 0, z)))
  root.add(inst)
  // Banners every so often along the fence, like flags around a site.
  const colors = [['#1b2a6b', '#3fd3e6'], ['#1b2a6b', '#ffc21a']]
  let k = 0
  for (let i = 0; i < posts.length; i += 5) {
    const [x, z] = posts[i]
    const b = makeBanner(...colors[k++ % 2])
    b.position.set(x, 0, z)
    b.rotation.y = x === minX || x === maxX ? 0 : Math.PI / 2
    statics.add(b)
  }
  // Colliders: four long walls (the gate is closed by its barrier).
  const T = 0.4
  solidBox((maxX - minX) / 2 + 1, H, T, (minX + maxX) / 2, H, minZ)
  solidBox((maxX - minX) / 2 + 1, H, T, (minX + maxX) / 2, H, maxZ)
  solidBox(T, H, (maxZ - minZ) / 2 + 1, minX, H, (minZ + maxZ) / 2)
  solidBox(T, H, (maxZ - minZ) / 2 + 1, maxX, H, (minZ + maxZ) / 2)

  // Entrance arch over the gate road.
  const arch = new Group()
  const yel = std('#ffc21a', { roughness: 0.45, metalness: 0.2 })
  for (const x of [-gateHalf - 2, gateHalf + 2]) {
    box(arch, 1.6, 10, 1.6, yel, x, 0, 0)
    box(arch, 2.2, 0.6, 2.2, mats.dark(), x, 0, 0)
  }
  box(arch, gateHalf * 2 + 6, 3.2, 1.0, std('#1b2a6b'), 0, 9.2, 0)
  box(arch, gateHalf * 2 + 6.4, 0.35, 1.2, yel, 0, 12.4, 0)
  box(arch, gateHalf * 2 + 6.4, 0.35, 1.2, yel, 0, 8.9, 0)
  arch.position.set(0, 0, maxZ)
  statics.add(arch)
  const title = flatText('BUILD THE SKYSCRAPER', 2.4, { color: '#ffd23a', outline: '#0b1a3a', outlineWidth: 16 })
  title.position.set(0, 10.8, maxZ - 0.55)
  title.rotation.y = Math.PI
  root.add(title)
  const title2 = flatText('BUILD THE SKYSCRAPER', 2.4, { color: '#ffd23a', outline: '#0b1a3a', outlineWidth: 16 })
  title2.position.set(0, 10.8, maxZ + 0.55)
  root.add(title2)
  // Boom barrier across the gate.
  const boom = new Group()
  box(boom, 1.0, 1.3, 1.0, mats.white(), 0, 0, 0)
  const arm = box(boom, gateHalf * 2 - 1, 0.25, 0.25, mats.hazard(), gateHalf - 0.2, 1.05, 0)
  arm.castShadow = true
  boom.position.set(-gateHalf, 0, maxZ - 1.2)
  statics.add(boom)
  const booth = makeCabin('#ffc21a')
  booth.scale.set(0.5, 1, 1)
  booth.position.set(gateHalf + 6, 0, maxZ - 3)
  booth.rotation.y = Math.PI
  statics.add(booth)
}

// --- Lamps ------------------------------------------------------------------------------------
function buildLamps(root, statics, lighting) {
  const bulb = new MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf7a', emissiveIntensity: 0.3, roughness: 0.4 })
  const spots = []
  // Along the avenue and walkways, around the plaza, along the main road.
  for (let z = -38; z <= -8; z += 10) spots.push([-19, z, Math.PI / 2], [25, z, -Math.PI / 2])
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2 // none straight south of the plaza, where the camera starts
    spots.push([LAYOUT.plaza.x + Math.cos(ang) * (LAYOUT.plaza.r + 2.5), LAYOUT.plaza.z + Math.sin(ang) * (LAYOUT.plaza.r + 2.5), -ang - Math.PI / 2])
  }
  for (let x = -110; x <= 110; x += 22) spots.push([x, 43.5, 0])
  for (let x = -40; x <= -14; x += 13) spots.push([x, 2.5, 0])
  for (let x = 16; x <= 52; x += 12) spots.push([x, 15.5, Math.PI])
  for (let z = -100; z <= -50; z += 16) spots.push([-49, z, Math.PI / 2], [49, z, -Math.PI / 2])
  for (const [x, z, yaw] of spots) {
    const l = makeLamp(bulb)
    l.position.set(x, 0, z)
    l.rotation.y = yaw
    statics.add(l)
    solidPole(0.2, 6.5, x, z)
  }
  // A few real lights where people gather (point lights are costly, the rest just glow).
  for (const [x, y, z] of [[0, 7, 10], [-60, 8, 14], [80, 8, 8], [0, 8, -42], [0, 7, 40]]) lighting.addLamp(x, y, z, bulb)
  return bulb
}

// --- Props --------------------------------------------------------------------------------------
function place(statics, g, x, z, yaw = 0) {
  g.position.set(x, 0, z)
  g.rotation.y = yaw
  statics.add(g)
  return g
}

function buildProps(statics, dynamic) {
  const rand = mulberry32(5150)
  const block = blockMaterial()
  const movers = []
  // Mixer trucks (their drums keep turning) and flatbeds of blocks.
  for (const [x, z, yaw, c] of [[-92, -24, Math.PI / 2, '#1aa3b8'], [92, -64, -Math.PI / 2, '#ff8a1a'], [-30, -60, 0, '#1aa3b8']]) {
    const t = makeMixerTruck(c)
    t.position.set(x, 0, z)
    t.rotation.y = yaw
    dynamic.add(t)
    movers.push(t.userData.drum)
    solidFootprint(x, z, yaw, 0, -0.6, 1.4, 4.6, 4)
  }
  for (const [x, z, yaw] of [[-96, 76, 0], [-86, 76, 0], [96, -96, Math.PI]]) {
    place(statics, makeFlatbed('#e8ecf2', block), x, z, yaw)
    solidFootprint(x, z, yaw, 0, -1, 1.4, 4.9, 3)
  }
  // Container yard in the north-east corner and by the west road.
  const cColors = ['#d63a2a', '#2f6fd0', '#2fae5a', '#ff8a1a', '#7a3dd1']
  let ci = 0
  for (const [x, z, n] of [[96, 72, 3], [102, 72, 2], [108, 72, 3], [96, 82, 2], [102, 82, 1], [-104, -80, 2], [-104, -72, 1]]) {
    for (let i = 0; i < n; i++) {
      const c = makeContainer(cColors[ci++ % cColors.length])
      c.position.set(x, i * 2.6, z)
      statics.add(c)
    }
    solidBox(1.3, n * 1.3, 3.1, x, n * 1.3, z)
  }
  // Site offices.
  for (const [x, z, yaw, s] of [[-100, 98, 0, '#2f6fd0'], [-92, 98, 0, '#2f6fd0'], [-100, 98, 0, '#ff8a1a'], [60, -118, Math.PI, '#2fae5a']]) {
    const c = makeCabin(s)
    place(statics, c, x, z, yaw)
    if (s === '#ff8a1a') c.position.y = 3.25 // stacked
    else solidFootprint(x, z, yaw, 0, 0, 3.1, 1.4, 6.5)
  }
  place(statics, makeWaterTank(), -64, -118)
  solidPole(1.5, 5, -64, -118)
  place(statics, makeGenerator(), 34, -118)
  solidFootprint(34, -118, 0, 0, 0, 1.7, 0.9, 2)
  // Pallets of blocks around the tower apron (ready to go up).
  for (const [x, z] of [[-38, -46], [-34, -46], [36, -48], [40, -52], [-40, -104], [38, -106], [32, -106]]) {
    const p = makePallet(block, 1 + Math.floor(rand() * 2))
    place(statics, p, x, z, rand() * 0.3)
    solidBox(1.2, 1.2, 1.2, x, 1.2, z)
  }
  // Pipes, sand and gravel piles.
  place(statics, makePipes(10), -78, -96, 0.3)
  solidBox(1.4, 1, 3.2, -78, 1, -96, 0.3)
  place(statics, makePile('#e2a868', 4), -88, -50)
  place(statics, makePile('#9da3ab', 3), 86, -24)
  place(statics, makePile('#e2a868', 3), 104, 100)
  solidPole(2.6, 2.6, -88, -50)
  solidPole(2, 2, 86, -24)
  solidPole(2, 2, 104, 100)
  // Barriers and cones.
  for (let x = -100; x <= 100; x += 25) place(statics, makeBarrier(3), x, -122, 0)
  for (const [x, z] of [[-14, -44], [22, -44], [-20, 0], [24, 0], [-46, 3], [-46, 25], [8, 22], [-8, 22], [-30, -110], [30, -40], [-48, -60], [48, -80], [110, 30], [-110, 30]]) {
    place(statics, makeCone(), x, z, rand() * 3)
  }
  for (const [x, z] of [[-40, -50], [-41, -51.2], [40, -45], [-112, 60], [-111, 61.3], [114, -40], [62, -112], [63.2, -112.6]]) {
    place(statics, makeBarrel(rand() < 0.7 ? '#2e66d8' : '#e8402a'), x, z)
    solidPole(0.45, 1.1, x, z)
  }
  return movers
}

// --- Kiosks ------------------------------------------------------------------------------------------
// A booth with a canopy, a counter, a floating spinning icon and a glowing ring to stand on.
function kiosk(root, statics, { x, z, color, title, icon }) {
  const g = new Group()
  const paint = std(color, { roughness: 0.45 })
  box(g, 7, 0.3, 5, mats.white(), 0, 0, -1.2)
  box(g, 6, 2.6, 0.4, mats.white(), 0, 0.3, -3.3)
  box(g, 0.4, 3.6, 4, paint, -3.1, 0.3, -1.6)
  box(g, 0.4, 3.6, 4, paint, 3.1, 0.3, -1.6)
  box(g, 6.6, 0.4, 5, paint, 0, 3.9, -1.3)
  box(g, 6.6, 0.25, 5, mats.white(), 0, 3.75, -1.3)
  box(g, 5, 1.1, 1, mats.white(), 0, 0.3, -0.1) // counter
  box(g, 5.1, 0.12, 1.1, paint, 0, 1.4, -0.1)
  // Awning stripes.
  for (let i = 0; i < 6; i++) box(g, 1.1, 0.12, 1.2, i % 2 ? mats.white() : paint, -2.75 + i * 1.1, 3.62, 1.5)
  g.position.set(x, 0, z)
  statics.add(g)
  solidFootprint(x, z, 0, 0, -1.6, 3.4, 1.9, 4.2)
  // The spinning icon and the stand-here ring (both animated / glowing, not baked).
  const iconGroup = new Group()
  iconGroup.add(icon)
  iconGroup.position.set(x, 6.3, z - 1.4)
  root.add(iconGroup)
  const ring = new Mesh(new RingGeometry(1.7, 2.1, 40), neon(color, 3))
  ring.rotation.x = -Math.PI / 2
  ring.position.set(x, 0.06, z + 2.4)
  root.add(ring)
  const lbl = label(title, 1.6, { color: '#ffffff', colors: null, outline: '#1b0f3a', outlineWidth: 18 })
  lbl.position.set(x, 8.7, z - 1.4)
  root.add(lbl)
  // A "CLAIM!" tag over the sign while something is waiting there (setReady; the Invite Friends kiosk).
  const tag = label('CLAIM!', 1.0, { color: '#7dff6b', colors: null, outline: '#06260c', outlineWidth: 16 })
  tag.position.set(x, 10.6, z - 1.4)
  tag.visible = false
  root.add(tag)
  return { icon: iconGroup, ring, pad: { x, z: z + 2.4 }, tag, ready: false }
}

// Two figures and a plus: bring friends.
function inviteIcon() {
  const g = new Group()
  const m = neon('#3bff7a', 2.4)
  for (const [x, s] of [[-0.75, 0.85], [0.75, 1]]) {
    const head = new Mesh(new SphereGeometry(0.42 * s, 14, 10), m)
    head.position.set(x, 0.75 * s, 0)
    const body = new Mesh(new CylinderGeometry(0.28 * s, 0.7 * s, 1.2 * s, 10), m)
    body.position.set(x, -0.3 * s, 0)
    g.add(head, body)
  }
  const plus = new Group()
  const bar = new Mesh(new BoxGeometry(0.9, 0.22, 0.22), neon('#ffd23a', 2.4))
  const bar2 = new Mesh(new BoxGeometry(0.22, 0.9, 0.22), neon('#ffd23a', 2.4))
  plus.add(bar, bar2)
  plus.position.set(0, 1.55, 0)
  g.add(plus)
  return g
}

function upgradeIcon() {
  const g = new Group()
  const m = neon('#b45cff', 2.4)
  const head = new Mesh(new ConeGeometry(1.0, 1.1, 4), m)
  head.position.y = 0.9
  head.rotation.y = Math.PI / 4
  g.add(head)
  const shaft = new Mesh(new BoxGeometry(0.8, 1.2, 0.8), m)
  g.add(shaft)
  const block = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), neon('#3bd9ff', 2.4))
  block.position.set(1.2, -0.6, 0)
  g.add(block)
  return g
}

function shopIcon() {
  const g = new Group()
  const m = neon('#ff4fa8', 2.4)
  const basket = new Mesh(new CylinderGeometry(1.0, 0.75, 1.0, 8, 1, true), m)
  basket.material.side = DoubleSide
  g.add(basket)
  const handle = new Mesh(new TorusGeometry(0.75, 0.1, 6, 16, Math.PI), neon('#ffd23a', 2.4))
  handle.position.y = 0.45
  g.add(handle)
  return g
}

// Everything above. Returns { kiosks: { upgrades, shop }, update(dt, elapsed), bulb }.
export function buildSite(scene, lighting) {
  const root = new Group()
  root.name = 'site'
  const statics = new Group() // merged per material once built
  const dynamic = new Group()
  buildGround(root)
  buildFence(root, statics)
  const bulb = buildLamps(root, statics, lighting)
  const drums = buildProps(statics, dynamic)
  const upgrades = kiosk(root, statics, { ...LAYOUT.upgrades, color: '#8f3dff', title: 'UPGRADES', icon: upgradeIcon() })
  const shop = kiosk(root, statics, { ...LAYOUT.shop, color: '#ff3d8f', title: 'SHOP', icon: shopIcon() })
  const invite = kiosk(root, statics, { ...LAYOUT.invite, color: '#1fb85a', title: 'INVITE FRIENDS', icon: inviteIcon() })
  root.add(bake(statics, true))
  root.add(dynamic)
  scene.add(root)
  return {
    bulb,
    kiosks: { upgrades, shop, invite },
    // The "CLAIM!" tag over a kiosk's sign (something is waiting there): on / off.
    setReady(k, on) {
      k.ready = !!on
      k.tag.visible = k.ready
    },
    update(dt, elapsed) {
      for (const d of drums) d.rotateY(dt * 1.6)
      for (const k of [upgrades, shop, invite]) {
        k.icon.rotation.y = elapsed * 1.2
        k.icon.position.y = 6.3 + Math.sin(elapsed * 2) * 0.25
        // A ready kiosk's ring pulses harder and its tag bobs.
        k.ring.scale.setScalar(1 + Math.sin(elapsed * (k.ready ? 7 : 3)) * (k.ready ? 0.12 : 0.04))
        if (k.ready) k.tag.position.y = 10.6 + Math.sin(elapsed * 4) * 0.25
      }
    },
  }
}

export { Quaternion, Vector3, cyl, put }
