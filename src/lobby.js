import { BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry } from 'three'
import { INSIDE, TOWER } from './config.js'
import { RAPIER, addFixed, world } from './physics.js'
import { bake } from './bake.js'
import { box, cyl, flatText, label, neon, put, std, yawQuat } from './propkit.js'
import { capGeometry, offset, pointInPolygon, southEdgeAt } from './shapes.js'
import { mulberry32, paintCarpet, paintCoffers, paintMullions, paintPlanks, toTexture } from './textures.js'
import { makePalm } from './world.js'
import { player, resetPlayer } from './player.js'
import { syncYawToPlayer } from './camera.js'

// The finished building's lobby. While a building is open (tower.lobby), its two lowest
// floors are one tall glass hall (tower.js cuts the doorway and swaps the colliders); this
// furnishes it in the building's own look (BUILDINGS[].lobby: carpet, walls, accent, light
// fittings): coffered ceiling, window mullions, columns, sofa lounges on rugs, potted palms,
// chandeliers, a runner from the door to the elevator core, and the door outside with its
// canopy, steps and a "GO INSIDE!" sign. The core's express elevator (E) rides to a hut on
// the roof and back: doors close, a short ride, and you step out at the other end (both
// cabs look the same inside, so the swap is seamless). Main reads contains() to pay the
// 5X stats and spots() for the guide arrow.

const DEFAULT_LOOK = { name: 'SKY LOUNGE', carpet: '#123a36', wall: '#16302c', accent: '#3fd3e6', wood: '#8a5a32', sofa: '#f4f1ea', lights: 'chandelier' }
const smooth = (t) => t * t * (3 - 2 * t)

export function createLobby(scene, tower, { onRide } = {}) {
  const C = tower.center
  const CAB = INSIDE.cab
  const CORE = INSIDE.core
  let built = null // the furnished lobby of building `n`
  const ride = { state: 'idle', t: 0, from: 'lobby' } // idle | closing | riding | opening

  // --- Shared bits -------------------------------------------------------------------------------
  const planks = toTexture(paintPlanks(256, 6, 77).color, { srgb: true })
  const cabWood = std('#ffffff', { map: planks, roughness: 0.7 })
  const cabFloor = std('#2a2c31', { roughness: 0.5, metalness: 0.3 })
  const chrome = std('#e8ebf0', { metalness: 0.85, roughness: 0.2 })
  const cabLight = neon('#fff1c9', 1.6)
  const doorMat = std('#d9c08a', { metalness: 0.6, roughness: 0.3 })
  const marble = std('#ece6da', { roughness: 0.35 })
  const gold = std('#e0b44c', { metalness: 0.75, roughness: 0.3 })
  const crystal = neon('#fff6dc', 2.2)
  const shared = new Set([cabWood, cabFloor, chrome, cabLight, doorMat, marble, gold, crystal])

  // --- Builders (local: base at y = 0, facing +z) -----------------------------------------------
  // An elevator cab: wood-panelled walls, light panel, rail and two sliding door leaves.
  function makeCab(parent) {
    const g = new Group()
    box(g, CAB.w, 0.02, CAB.d, cabFloor, 0, 0, 0, false)
    box(g, 0.06, CAB.h, CAB.d, cabWood, -CAB.w / 2 + 0.03, 0, 0, false)
    box(g, 0.06, CAB.h, CAB.d, cabWood, CAB.w / 2 - 0.03, 0, 0, false)
    box(g, CAB.w, CAB.h, 0.06, cabWood, 0, 0, -CAB.d / 2 + 0.03, false)
    box(g, CAB.w, 0.1, CAB.d, cabFloor, 0, CAB.h, 0, false)
    box(g, CAB.w - 0.6, 0.04, CAB.d - 0.6, cabLight, 0, CAB.h - 0.04, 0, false)
    box(g, CAB.w - 0.4, 0.06, 0.06, chrome, 0, 1.0, -CAB.d / 2 + 0.12, false)
    for (const x of [-1, 1]) box(g, 0.06, 0.06, CAB.d - 0.5, chrome, x * (CAB.w / 2 - 0.12), 1.0, 0, false)
    parent.add(g)
    const leaves = [-1, 1].map((s) => {
      const m = box(parent, CAB.w / 2, CAB.h, 0.08, doorMat, 0, 0, CAB.d / 2 - 0.04, false)
      m.userData.side = s
      return m
    })
    return { group: g, leaves, open: 1 }
  }
  // Door leaves fold to the sides as `open` goes 0 -> 1 (they never poke out of the frame).
  function setDoors(cab, open) {
    cab.open = open
    for (const m of cab.leaves) {
      const w = 1 - 0.9 * open
      m.scale.x = w
      m.position.x = m.userData.side * (CAB.w / 2 - (CAB.w / 4) * w)
    }
  }
  function makeSofa(g, mat, cushion, x, z, yaw) {
    const s = new Group()
    box(s, 3, 0.45, 1, mat, 0, 0, 0)
    box(s, 3, 0.85, 0.28, mat, 0, 0.3, -0.36)
    for (const k of [-1, 1]) box(s, 0.28, 0.75, 1, mat, k * 1.36, 0, 0)
    for (const k of [-1, 1]) box(s, 1.2, 0.14, 0.72, mat, k * 0.62, 0.45, 0.08)
    for (const k of [-1, 1]) box(s, 0.5, 0.42, 0.14, cushion, k * 0.75, 0.6, -0.16)
    s.position.set(x, 0, z)
    s.rotation.y = yaw
    g.add(s)
  }

  // --- Build / tear down ------------------------------------------------------------------------
  function build() {
    const L = tower.lobby
    const spec = tower.spec
    const T = { ...DEFAULT_LOOK, ...(spec.def.lobby ?? {}) }
    const pts = spec.pts
    const y0 = L.y0
    const y1 = L.y1
    const H = y1 - y0
    const D = L.door
    const rand = mulberry32(4200 + spec.n)
    const own = [] // materials / textures this lobby made (disposed on teardown)
    const mat = (m) => (own.push(m), m)
    const colliders = []
    const solid = (hx, hy, hz, lx, ly, lz, yaw = 0) => colliders.push(addFixed(RAPIER.ColliderDesc.cuboid(hx, hy, hz), { x: C.x + lx, y: ly, z: C.z + lz }, yawQuat(yaw)))
    const pole = (r, h, lx, ly, lz) => colliders.push(addFixed(RAPIER.ColliderDesc.cylinder(h / 2, r), { x: C.x + lx, y: ly + h / 2, z: C.z + lz }))

    const root = new Group() // tower-local (the tower group is at the centre and sinks)
    root.name = 'lobby'
    const deco = new Group() // static, baked to a few meshes
    deco.position.y = y0

    const wall = mat(std(T.wall, { roughness: 0.5 }))
    const accent = mat(neon(T.accent, 2.4))
    const sofa = mat(std(T.sofa, { roughness: 0.8 }))
    const cushion = mat(std(T.accent, { roughness: 0.8 }))
    const wood = mat(std(T.wood, { roughness: 0.7 }))
    const rugMat = mat(std(T.wood, { roughness: 0.9, map: planks }))

    // Floor and ceiling.
    const inner = offset(pts, -0.1)
    const carpetTex = toTexture(paintCarpet(T.carpet), { srgb: true })
    own.push(carpetTex)
    const floor = new Mesh(capGeometry(inner, 4), mat(new MeshStandardMaterial({ map: carpetTex, roughness: 0.95 })))
    floor.position.y = 0.012
    deco.add(floor)
    const cofTex = toTexture(paintCoffers(), { srgb: true })
    own.push(cofTex)
    const ceil = new Mesh(capGeometry(inner, 3.2), mat(new MeshBasicMaterial({ map: cofTex, side: DoubleSide })))
    ceil.position.y = H - 0.03
    deco.add(ceil)

    // Window mullions (inside the glass, the doorway left open) and a skirting band.
    const mullTex = toTexture(paintMullions(T.sofa))
    own.push(mullTex)
    const mullMat = mat(new MeshStandardMaterial({ map: mullTex, alphaTest: 0.5, side: DoubleSide, roughness: 0.5 }))
    const ring = offset(pts, -0.2)
    const pos = []
    const uv = []
    const skirt = []
    let u = 0
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]
      const [bx, bz] = ring[(i + 1) % ring.length]
      const len = Math.hypot(bx - ax, bz - az)
      if (!D.edges.has(i)) {
        pos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, 0, az, bx, H, bz, ax, H, az)
        const u0 = u / 2.6
        const u1 = (u + len) / 2.6
        uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1)
        skirt.push(ax, 0, az, bx, 0, bz, bx, 0.3, bz, ax, 0, az, bx, 0.3, bz, ax, 0.3, az)
      }
      u += len
    }
    const mg = new BufferGeometry()
    mg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    mg.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    mg.computeVertexNormals()
    deco.add(new Mesh(mg, mullMat))
    const sg = new BufferGeometry()
    sg.setAttribute('position', new BufferAttribute(new Float32Array(skirt), 3))
    sg.setAttribute('uv', new BufferAttribute(new Float32Array(skirt.length / 1.5), 2))
    sg.computeVertexNormals()
    const sk = new Mesh(sg, mat(std(T.wall, { side: DoubleSide })))
    sk.position.y = 0.01
    deco.add(sk)

    // Elevator core: dark blocks round the cab, pilasters, a sign over the door.
    const cz = 0
    const front = cz + CORE.d / 2
    const sideW = (CORE.w - CAB.w) / 2
    for (const s of [-1, 1]) {
      box(deco, sideW, H, CORE.d, wall, s * (CAB.w / 2 + sideW / 2), 0, cz, false)
      solid(sideW / 2, H / 2, CORE.d / 2, s * (CAB.w / 2 + sideW / 2), y0 + H / 2, cz)
      box(deco, 0.5, H, 0.3, marble, s * (CORE.w / 2 - 0.25), 0, front + 0.15, false)
      box(deco, 0.12, H - 0.6, 0.12, accent, s * (CAB.w / 2 + 0.35), 0.3, front + 0.06, false)
    }
    const backD = CORE.d - CAB.d
    box(deco, CAB.w, H, backD, wall, 0, 0, cz - CORE.d / 2 + backD / 2, false)
    solid(CAB.w / 2, H / 2, backD / 2, 0, y0 + H / 2, cz - CORE.d / 2 + backD / 2)
    box(deco, CAB.w, H - CAB.h, CAB.d, wall, 0, CAB.h, front - CAB.d / 2, false)
    solid(CAB.w / 2, (H - CAB.h) / 2, CAB.d / 2, 0, y0 + CAB.h + (H - CAB.h) / 2, front - CAB.d / 2)
    box(deco, CAB.w + 0.5, 0.25, 0.25, gold, 0, CAB.h, front + 0.1, false)
    box(deco, CORE.w, 0.3, 0.2, gold, 0, 0, front + 0.1, false)
    const top = flatText('▲ TOP', 0.42, { color: '#ffe8a8', outline: '#2a1d05', outlineWidth: 10 })
    top.position.set(0, y0 + CAB.h + 0.62, front + 0.03)
    root.add(top)
    const sign = flatText(T.name, 0.95, { color: '#ffffff', outline: '#0b1a1a', outlineWidth: 12 })
    sign.position.set(0, y0 + CAB.h + 2.1, front + 0.03)
    root.add(sign)
    const lobbyCab = makeCab(root)
    lobbyCab.group.position.set(0, y0, front - CAB.d / 2)
    for (const m of lobbyCab.leaves) {
      m.position.y += y0
      m.position.z += front - CAB.d / 2
    }
    lobbyCab.spot = { x: 0, y: y0, z: front - CAB.d / 2, facing: 0 }

    // Runner from the door to the elevator.
    const runFrom = front + 0.4
    const runTo = D.z - 0.6
    if (runTo > runFrom) {
      const runner = mat(std(T.accent, { roughness: 0.95 }))
      runner.color.multiplyScalar(0.3)
      box(deco, 3, 0.02, runTo - runFrom, runner, D.x * 0.5, 0.015, (runFrom + runTo) / 2, false)
      box(deco, 3.3, 0.018, runTo - runFrom, gold, D.x * 0.5, 0.012, (runFrom + runTo) / 2, false)
    }

    // Lounges (sofa pairs on a rug under a light) round the hall, palms between them.
    const walkable = offset(pts, -1.6)
    const fits = (x, z, r) => [0, 1, 2, 3, 4, 5, 6, 7].every((k) => pointInPolygon(x + Math.cos((k * Math.PI) / 4) * r, z + Math.sin((k * Math.PI) / 4) * r, walkable))
    const clearOfDoor = (x, z, r) => !(Math.abs(x - D.x) < 2.6 + r && z > front)
    const clearOfCore = (x, z, r) => !(Math.abs(x) < CORE.w / 2 + 1.5 + r && Math.abs(z - cz) < CORE.d / 2 + 2.5 + r)
    let rMin = Infinity
    for (const [x, z] of pts) rMin = Math.min(rMin, Math.hypot(x, z))
    const lounges = []
    for (const rf of [0.62, 0.4]) {
      const r = rMin * rf
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * Math.PI * 2 + rf
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        if (!fits(x, z, 3.4) || !clearOfDoor(x, z, 3.2) || !clearOfCore(x, z, 3.2)) continue
        if (lounges.some((l) => Math.hypot(l.x - x, l.z - z) < 8)) continue
        lounges.push({ x, z, yaw: -a })
      }
    }
    for (const l of lounges) {
      const g = new Group()
      g.position.set(l.x, 0, l.z)
      g.rotation.y = l.yaw
      box(g, 6, 0.03, 4.6, rugMat, 0, 0.012, 0, false)
      makeSofa(g, sofa, cushion, 0, -1.55, 0)
      makeSofa(g, sofa, cushion, 0, 1.55, Math.PI)
      box(g, 1.7, 0.08, 0.85, wood, 0, 0.4, 0, false)
      box(g, 1.3, 0.4, 0.5, mat(std('#2b2d33')), 0, 0, 0, false)
      put(g, new SphereGeometry(0.16, 8, 6), mat(std('#e8344a')), 0.4, 0.62, 0, false)
      for (const s of [-1, 1]) {
        cyl(g, 0.32, 0.55, marble, s * 2.15, 0, -1.55, 10, false)
        cyl(g, 0.05, 0.6, gold, s * 2.15, 0.55, -1.55, 6, false)
        put(g, new CylinderGeometry(0.18, 0.3, 0.32, 10), mat(std('#fff4d8', { emissive: '#ffd98a', emissiveIntensity: 0.8 })), s * 2.15, 1.3, -1.55, false)
      }
      deco.add(g)
      const c = Math.cos(l.yaw)
      const s = Math.sin(l.yaw)
      for (const sz of [-1.55, 1.55]) solid(1.5, 0.6, 0.55, l.x + sz * s, y0 + 0.6, l.z + sz * c, l.yaw)
      // A light over it.
      hangLight(deco, T.lights, l.x, H, l.z, accent, rand)
    }
    // Palms in pots and marble columns on an inner ring, clear of everything else.
    const placed = lounges.map((l) => ({ x: l.x, z: l.z, r: 3.6 }))
    const free = (x, z, r) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r) && fits(x, z, r) && clearOfDoor(x, z, r) && clearOfCore(x, z, r)
    const potMat = mat(std(T.sofa, { roughness: 0.4 }))
    let palms = 0
    for (let k = 0; k < 16 && palms < 6; k++) {
      const a = (k / 16) * Math.PI * 2
      const r = rMin * (k % 2 ? 0.72 : 0.5)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (!free(x, z, 1.4)) continue
      placed.push({ x, z, r: 1.4 })
      cyl(deco, 0.7, 0.9, potMat, x, 0, z, 12, false)
      cyl(deco, 0.74, 0.1, gold, x, 0.85, z, 12, false)
      const palm = makePalm(rand, 5)
      palm.scale.setScalar(0.7)
      palm.position.set(x, 0.9, z)
      deco.add(palm)
      pole(0.75, 1.2, x, y0, z)
      palms++
    }
    const colRing = offset(pts, -3.4)
    let acc = 0
    for (let i = 0; i < colRing.length; i++) {
      const [ax, az] = colRing[i]
      const [bx, bz] = colRing[(i + 1) % colRing.length]
      acc += Math.hypot(bx - ax, bz - az)
      if (acc < 9) continue
      if (!free(bx, bz, 0.9)) continue
      acc = 0
      placed.push({ x: bx, z: bz, r: 0.9 })
      cyl(deco, 0.5, H, marble, bx, 0, bz, 14, false)
      box(deco, 1.25, 0.45, 1.25, marble, bx, 0, bz, false)
      box(deco, 1.25, 0.4, 1.25, marble, bx, H - 0.4, bz, false)
      box(deco, 1.3, 0.08, 1.3, gold, bx, 0.45, bz, false)
      pole(0.6, H, bx, y0, bz)
    }

    // --- The door (outside): frame, header over the cut-out glass, canopy, steps, sign.
    const door = new Group()
    door.position.set(D.x, 0, D.z)
    door.rotation.y = D.yaw
    const w = D.width
    const dh = 4.3
    const frameMat = mat(std(spec.def.frame, { roughness: 0.4 }))
    for (const s of [-1, 1]) {
      box(door, 0.5, dh + 0.6, 0.7, frameMat, s * (w / 2 + 0.05), y0, 0.05)
      box(door, 0.1, dh, 0.1, accent, s * (w / 2 - 0.25), y0, 0.42, false)
      // Wooden door leaves swung open against the facade.
      const leaf = new Group()
      leaf.position.set(s * (w / 2 - 0.2), y0, 0.45)
      leaf.rotation.y = s * 1.45
      box(leaf, 0.08, dh - 0.1, w / 2 - 0.3, wood, 0, 0, w / 4 - 0.15, false)
      box(leaf, 0.1, 0.08, 0.6, gold, 0, 1.1, w / 4 - 0.45, false)
      door.add(leaf)
    }
    box(door, w + 0.6, 0.6, 0.7, frameMat, 0, y0 + dh, 0.05)
    box(door, w + 0.1, H - dh - 0.6, 0.3, wall, 0, y0 + dh + 0.6, 0)
    solid(w / 2 + 0.3, (H - dh - 0.6) / 2, 0.15, D.x, y0 + dh + 0.6 + (H - dh - 0.6) / 2, D.z, D.yaw)
    box(door, w + 2, 0.25, 2.4, frameMat, 0, y0 + dh + 0.6, 1.2)
    box(door, w + 2, 0.08, 0.08, accent, 0, y0 + dh + 0.6, 2.4, false)
    const doorSign = flatText(T.name, 0.6, { color: '#ffffff', outline: '#0b1a1a', outlineWidth: 10 })
    doorSign.position.set(0, y0 + dh + 1.45, 0.17)
    door.add(doorSign)
    box(door, w, 0.04, 0.5, accent, 0, y0 - 0.02, -0.1, false) // glowing threshold
    // Steps up from the foundation to the lobby floor.
    const stepY = (TOWER.foundation + y0) / 2
    box(door, w + 1, stepY, 0.9, marble, 0, 0, 0.8)
    const c = Math.cos(D.yaw)
    const s = Math.sin(D.yaw)
    solid(w / 2 + 0.5, stepY / 2, 0.45, D.x + 0.8 * s, stepY / 2, D.z + 0.8 * c, D.yaw)
    root.add(door)
    const goSign = label(`GO INSIDE! ${INSIDE.mult}X`, 1.3, { color: '#7dff6b', outline: '#0b2a05', outlineWidth: 16 })
    goSign.position.set(D.x + 2.6 * s, y1 + 2.2, D.z + 2.6 * c)
    root.add(goSign)

    // --- Roof hut: the top end of the express elevator, its door facing the crown.
    const roofY = tower.roofY
    const hx = INSIDE.doorX
    const hd = CAB.d + 0.3
    const hz = (southEdgeAt(pts, hx) ?? 10) - 0.9 - hd / 2
    const hut = new Group()
    hut.position.set(hx, roofY, hz)
    hut.rotation.y = Math.PI
    const hw = CAB.w + 0.6
    for (const sx of [-1, 1]) box(hut, 0.3, CAB.h + 0.3, hd, frameMat, sx * (hw / 2 - 0.15), 0, -0.15)
    box(hut, hw, CAB.h + 0.3, 0.3, frameMat, 0, 0, -hd / 2)
    box(hut, hw + 0.4, 0.35, hd + 0.4, wall, 0, CAB.h + 0.3, -0.15)
    box(hut, hw + 0.42, 0.08, hd + 0.42, accent, 0, CAB.h + 0.5, -0.15, false)
    const hutSign = flatText('▼ LOBBY', 0.5, { color: '#ffe8a8', outline: '#2a1d05', outlineWidth: 10 })
    hutSign.position.set(0, CAB.h + 0.85, CAB.d / 2 + 0.05)
    hut.add(hutSign)
    const topCab = makeCab(hut)
    root.add(hut)
    topCab.spot = { x: hx, y: roofY, z: hz, facing: Math.PI }
    for (const sx of [-1, 1]) solid(0.15, (CAB.h + 0.3) / 2, hd / 2, hx - sx * (hw / 2 - 0.15), roofY + (CAB.h + 0.3) / 2, hz + 0.15)
    solid(hw / 2, (CAB.h + 0.3) / 2, 0.15, hx, roofY + (CAB.h + 0.3) / 2, hz + hd / 2)
    solid(hw / 2 + 0.2, 0.2, hd / 2 + 0.2, hx, roofY + CAB.h + 0.5, hz + 0.15)

    const baked = bake(deco)
    baked.position.y = y0
    baked.traverse((o) => {
      if (o.isMesh) {
        o.userData.own = true
        o.receiveShadow = false
      }
    })
    root.add(baked)
    // The pieces live on in the baked meshes (box() geometries are a shared cache).
    deco.traverse((o) => {
      if (o.isMesh && !o.geometry.isBoxGeometry) o.geometry.dispose()
    })
    tower.group.add(root)
    setDoors(lobbyCab, 1)
    setDoors(topCab, 1)
    built = { n: spec.n, root, colliders, own, lobbyCab, topCab, goSign, y0, y1, pts, door: D, front, hasColliders: true }
  }

  function hangLight(g, kind, x, H, z, accent, rand, scale = 1) {
    const l = new Group()
    l.position.set(x, H, z)
    l.scale.setScalar(scale)
    if (kind === 'ring') {
      put(l, new TorusGeometry(1.6, 0.12, 8, 36), accent, 0, -1.1, 0, false).rotation.x = Math.PI / 2
      put(l, new TorusGeometry(0.9, 0.08, 8, 28), accent, 0, -1.5, 0, false).rotation.x = Math.PI / 2
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        box(l, 0.03, 1.1, 0.03, chrome, Math.cos(a) * 1.6, -1.1, Math.sin(a) * 1.6, false)
      }
    } else if (kind === 'pendant') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        const drop = 1 + i * 0.35
        box(l, 0.03, drop, 0.03, chrome, Math.cos(a) * 0.7, -drop, Math.sin(a) * 0.7, false)
        put(l, new SphereGeometry(0.36, 12, 8), crystal, Math.cos(a) * 0.7, -drop - 0.3, Math.sin(a) * 0.7, false)
      }
    } else {
      box(l, 0.05, 1.3, 0.05, gold, 0, -1.3, 0, false)
      put(l, new TorusGeometry(1.25, 0.06, 6, 32), gold, 0, -1.75, 0, false).rotation.x = Math.PI / 2
      put(l, new TorusGeometry(0.75, 0.05, 6, 24), gold, 0, -1.35, 0, false).rotation.x = Math.PI / 2
      put(l, new SphereGeometry(0.28, 10, 8), crystal, 0, -1.6, 0, false)
      const drop = new ConeGeometry(0.09, 0.42, 5)
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rand() * 0.1
        const m = put(l, drop, crystal, Math.cos(a) * 1.25, -2.05 - rand() * 0.15, Math.sin(a) * 1.25, false)
        m.rotation.x = Math.PI
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        put(l, drop, crystal, Math.cos(a) * 0.75, -1.6, Math.sin(a) * 0.75, false).rotation.x = Math.PI
      }
    }
    g.add(l)
  }

  function dropColliders() {
    if (!built?.hasColliders) return
    for (const c of built.colliders) world.removeCollider(c, false)
    built.colliders.length = 0
    built.hasColliders = false
  }
  function teardown() {
    if (!built) return
    dropColliders()
    tower.group.remove(built.root)
    // Everything this lobby made (box() geometries and the module's own materials are shared).
    const mats = new Set()
    built.root.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      if (o.isMesh && !o.geometry.isBoxGeometry) o.geometry.dispose()
      for (const m of [o.material].flat()) if (!shared.has(m)) mats.add(m)
    })
    for (const m of mats) {
      if (m.map && m.map !== planks) m.map.dispose()
      m.dispose()
    }
    for (const t of built.own) t.dispose?.()
    built = null
    ride.state = 'idle'
  }

  // --- Elevator ride ----------------------------------------------------------------------------
  function board(from) {
    if (!built || ride.state !== 'idle' || player.locked) return
    const cab = from === 'lobby' ? built.lobbyCab : built.topCab
    const p = { x: C.x + cab.spot.x, y: cab.spot.y + 0.02, z: C.z + cab.spot.z }
    resetPlayer(p, cab.spot.facing)
    syncYawToPlayer()
    player.locked = true
    player.hold = { ...p }
    ride.state = 'closing'
    ride.t = 0
    ride.from = from
  }
  function step(dt) {
    if (!built || ride.state === 'idle') return null
    const from = ride.from === 'lobby' ? built.lobbyCab : built.topCab
    const to = ride.from === 'lobby' ? built.topCab : built.lobbyCab
    ride.t += dt
    const dir = ride.from === 'lobby' ? 'up' : 'down'
    if (ride.state === 'closing') {
      const k = Math.min(1, ride.t / INSIDE.doors)
      setDoors(from, 1 - smooth(k))
      setDoors(to, Math.min(to.open, 1 - smooth(k)))
      if (k >= 1) {
        ride.state = 'riding'
        ride.t = 0
        onRide?.('start', dir)
      }
      return { boarding: k, riding: false, progress: 0, dir }
    }
    if (ride.state === 'riding') {
      const k = Math.min(1, ride.t / INSIDE.ride)
      if (k >= 1) {
        // Swap cabs behind closed doors.
        const p = { x: C.x + to.spot.x, y: to.spot.y + 0.02, z: C.z + to.spot.z }
        player.hold = p
        player.facing = to.spot.facing
        resetPlayer(p, to.spot.facing)
        syncYawToPlayer()
        ride.state = 'opening'
        ride.t = 0
        onRide?.('arrive', dir)
      }
      return { boarding: 0, riding: true, progress: k, dir }
    }
    // opening
    const k = Math.min(1, ride.t / INSIDE.doors)
    setDoors(to, smooth(k))
    setDoors(from, smooth(k))
    if (k >= 1) {
      ride.state = 'idle'
      player.locked = false
      player.hold = null
    }
    return null
  }

  // --- Prompts (main attaches them once the prompt layer exists) --------------------------------
  const far = -1e5
  function attach(interact) {
    interact.add({
      x: () => (built ? C.x + built.lobbyCab.spot.x : far),
      y: () => (built ? built.y0 + 1.6 : far),
      z: () => (built ? C.z + built.front + 0.4 : far),
      r: 3.4,
      info: () => (built?.hasColliders && ride.state === 'idle' && !player.locked ? { title: 'Elevator', verb: 'Ride to the Top' } : null),
      run: () => board('lobby'),
    })
    interact?.add({
      x: () => (built ? C.x + built.topCab.spot.x : far),
      y: () => (built ? built.topCab.spot.y + 1.6 : far),
      z: () => (built ? C.z + built.topCab.spot.z - CAB.d / 2 - 0.4 : far),
      r: 3.4,
      info: () => (built?.hasColliders && ride.state === 'idle' && !player.locked ? { title: 'Elevator', verb: 'Ride to the Lobby' } : null),
      run: () => board('top'),
    })
  }

  // --- Frame ------------------------------------------------------------------------------------
  function update(dt, elapsed) {
    const open = tower.lobby
    if (built && (tower.spec.n !== built.n || tower.phase === 'building')) teardown()
    if (built && !open) {
      // Sinking: nobody stays in (main moves the player out), the rooms go down with it.
      dropColliders()
      if (ride.state !== 'idle') ride.state = 'idle'
    }
    if (!built && open) build()
    if (!built) return null
    built.goSign.visible = !!open
    if (open) built.goSign.position.y = built.y1 + 2.2 + Math.sin(elapsed * 2.5) * 0.3
    return step(dt)
  }

  return {
    update,
    attach,
    get riding() {
      return ride.state !== 'idle'
    },
    // Inside the open lobby (pays the 5X stats).
    contains(p) {
      if (!built?.hasColliders) return false
      return p.y > built.y0 - 0.6 && p.y < built.y1 && pointInPolygon(p.x - C.x, p.z - C.z, built.pts)
    },
    // Anywhere in the building's footprint below the roof (cleared when it sinks).
    within(p) {
      if (!built) return false
      return p.y < tower.roofY + 6 && pointInPolygon(p.x - C.x, p.z - C.z, offset(built.pts, 1.2))
    },
    // World spots for the guide arrow.
    spots() {
      if (!built?.hasColliders) return null
      const D = built.door
      const c = Math.cos(D.yaw)
      const s = Math.sin(D.yaw)
      return {
        y: built.y0,
        out: { x: C.x + D.x + 3.2 * s, z: C.z + D.z + 3.2 * c },
        in: { x: C.x + D.x - 2.5 * s, z: C.z + D.z - 2.5 * c },
        top: { x: C.x + D.x, y: built.y1 + 1, z: C.z + D.z + 1.5 },
      }
    },
  }
}
