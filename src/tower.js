import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { BUILDING_SCALE, BUILDINGS, ELEVATOR, INSIDE, LAYOUT, STAIRS, TOWER } from './config.js'
import { RAPIER, addFixed, world } from './physics.js'
import { neon } from './propkit.js'
import { blockMaterial } from './site.js'
import { capGeometry, floorGeometry, footprint, offset, pointInPolygon, prismTrimesh, ringGeometry, southEdgeAt, southEdgeMax } from './shapes.js'
import { mulberry32, paintConcrete, paintWindows, toTexture } from './textures.js'

// The shared skyscraper everyone on the server builds. Building n has a look from
// BUILDINGS, a number of floors and a block count per floor (BUILDING_SCALE). Finished
// floors are one InstancedMesh (slab band + curtain-wall glass), the roof is a concrete cap
// with a glowing green edge, and the floor in progress shows as stone blocks popping onto
// the roof, filling it from the elevator side outward. Collision: a trimesh prism up to
// the roof plus an invisible parapet with gaps at the elevator and stair exits.
// When the last floor is done the crown goes on and the building stays open for
// INSIDE.time: its two lowest floors turn into a lobby with a doorway on the south face
// (lobby.js furnishes it), then it sinks into the sand and the next one starts.

// Which BUILDINGS entry building n uses: the first is always BUILDINGS[0]; after that a
// weighted roll on `chance` (never the same as the one before), seeded by n so everyone (and
// a reload) gets the same pick.
const picks = [0]
function rollBuilding(n, prev) {
  const rand = mulberry32(7919 * n + 1013)
  rand()
  const w = (i) => (i === prev ? 0 : (BUILDINGS[i].chance ?? 1))
  let total = 0
  for (let i = 0; i < BUILDINGS.length; i++) total += w(i)
  let r = rand() * total
  for (let i = 0; i < BUILDINGS.length; i++) {
    r -= w(i)
    if (r < 0) return i
  }
  return prev === 0 ? 1 : 0
}
export function pickBuilding(n) {
  if (n <= 0) return 0
  for (let k = picks.length; k <= n; k++) picks[k] = rollBuilding(k, picks[k - 1])
  return picks[n]
}

export function buildingSpec(n) {
  const S = BUILDING_SCALE
  const def = BUILDINGS[pickBuilding(n)]
  const floors = Math.min(S.floorsMax, S.floorsBase + n * S.floorsPer)
  const perFloor = []
  let total = 0
  for (let f = 0; f < floors; f++) {
    const b = Math.round((S.blocksBase * Math.pow(S.blockGrowth, n) * (1 + f * S.floorGrowth)) / 10) * 10
    perFloor.push(b)
    total += b
  }
  const size = def.size + Math.min(6, Math.floor(n / BUILDINGS.length) * 2)
  return { n, def, floors, perFloor, total, size, pts: footprint(def.shape, size) }
}

const easeOutBack = (t) => {
  const c = 1.70158
  const u = t - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

export function createTower(scene, saved) {
  const C = LAYOUT.tower
  const group = new Group() // everything that sinks
  group.name = 'tower'
  scene.add(group)

  const listeners = { floor: [], complete: [], building: [], height: [] }
  const emit = (name, data) => listeners[name].forEach((fn) => fn(data))

  // --- Progress ------------------------------------------------------------------------
  let spec = null
  let floors = 0 // finished floors
  const contrib = new Map() // id -> { id, name, blocks } placed on the current building
  let floorBlocks = 0 // blocks in the floor being built
  let phase = 'building' // 'building' | 'celebrate' | 'sinking'
  let phaseTime = 0
  let sink = 0 // m sunk so far
  let holdLeft = 0 // s the sunk building waits before the next one rises (`hold`)

  // --- Shared mode: ONE tower per room, owned by the server (sync() drives everything below) -------------
  // While `shared`, the displayed progress (floors, floorBlocks, phase, the next building rising) only ever
  // follows the server's state; addBlocks just does the optimistic accounting and reports the blocks.
  // Not shared (offline, not seeded yet, connection lost) the original local state machine runs as before.
  let shared = false
  let reporter = null // fn(n): blocks this player placed (net.sendBuild)
  let builders = null // { n, list } the `built` message: top builders of the building that just finished
  const srv = { ok: false, n: -1, floors: 0, blocks: 0, phase: '', phaseAt: 0 } // the last server state applied
  let inflight = [] // { t, n } blocks reported but not yet in the server's state: caps what you may place
  const INFLIGHT_MS = 1500 // ...for this long (a refused report must not block placing for ever)

  // --- Shared materials ------------------------------------------------------------------
  const concreteTex = toTexture(paintConcrete(256, '#b9bcc0', '#8f9399', 626), { srgb: true })
  const roofMat = new MeshStandardMaterial({ map: concreteTex, roughness: 0.9 })
  const foundationTop = new MeshStandardMaterial({ map: concreteTex, roughness: 0.9 })
  const edgeMat = neon('#3bff6e', 2.6)
  const ghostMat = neon('#7dffa0', 1.6, { transparent: true, opacity: 0.35, depthWrite: false })
  const blockGeo = new BoxGeometry(TOWER.block, TOWER.block, TOWER.block)
  blockGeo.translate(0, TOWER.block / 2, 0)

  // Per-building pieces (rebuilt by setBuilding).
  let floorsMesh = null
  let slabMat = null
  let glassMat = null
  let foundation = null
  let roof = null
  let edge = null
  let blocks = null
  let crown = null
  const ghost = new Mesh(new BoxGeometry(TOWER.block * 1.08, TOWER.block * 1.08, TOWER.block * 1.08), ghostMat)
  ghost.geometry.translate(0, TOWER.block * 0.54, 0)
  group.add(ghost)
  let cells = [] // { x, z, m: Matrix4 } local, in fill order
  let shown = 0 // blocks visible on the roof
  const popping = [] // { i, t }
  let rising = null // { t } newest floor growing in
  const anchors = {}
  // The lobby (open phase): floor top, ceiling, the glass panels cut away for the door.
  const lobbyY0 = TOWER.foundation + TOWER.slab
  const lobbyY1 = TOWER.foundation + INSIDE.floors * TOWER.floorHeight
  let lobbyShell = null
  const door = { edges: new Set(), x: 0, z: 0, ax: 0, az: 0, bx: 0, bz: 0, width: 0, yaw: 0 }
  let crownR = 8

  // --- Colliders -----------------------------------------------------------------------------
  let colliders = []
  function clearColliders() {
    for (const c of colliders) world.removeCollider(c, false)
    colliders = []
  }
  function buildColliders() {
    clearColliders()
    if (phase === 'sinking') return
    const pts = spec.pts
    const y = roofY()
    const fnd = prismTrimesh(offset(pts, 1.6), -0.5, TOWER.foundation, C.x, C.z)
    colliders.push(addFixed(RAPIER.ColliderDesc.trimesh(fnd.vertices, fnd.indices), { x: 0, y: 0, z: 0 }))
    const trimesh = (t) => colliders.push(addFixed(RAPIER.ColliderDesc.trimesh(t.vertices, t.indices), { x: 0, y: 0, z: 0 }))
    if (lobbyShell) {
      // Open: a floor plate, glass walls (a gap at the door), a ceiling and the rest on top.
      trimesh(prismTrimesh(offset(pts, 0.35), 0, lobbyY0, C.x, C.z))
      const h = lobbyY1 - lobbyY0
      for (let i = 0; i < pts.length; i++) {
        if (door.edges.has(i)) continue
        const [ax, az] = pts[i]
        const [bx, bz] = pts[(i + 1) % pts.length]
        const len = Math.hypot(bx - ax, bz - az)
        const yaw = Math.atan2(-(bz - az), bx - ax)
        colliders.push(
          addFixed(RAPIER.ColliderDesc.cuboid(len / 2 + 0.15, h / 2, 0.15), { x: C.x + (ax + bx) / 2, y: lobbyY0 + h / 2, z: C.z + (az + bz) / 2 }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
        )
      }
      trimesh(prismTrimesh(pts, lobbyY1 - 0.05, lobbyY1, C.x, C.z))
      trimesh(prismTrimesh(pts, lobbyY1, y, C.x, C.z))
      // The crown stands on the roof: walk round it.
      const kind = spec.def.crown
      if (kind === 'ring') {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2
          colliders.push(addFixed(RAPIER.ColliderDesc.cylinder(4, 0.5), { x: C.x + Math.cos(a) * crownR, y: y + 4, z: C.z + Math.sin(a) * crownR }))
        }
      } else {
        const ch = kind === 'spire' ? 6 : crownR * 0.75
        colliders.push(addFixed(RAPIER.ColliderDesc.cylinder(ch / 2, crownR * (kind === 'spire' ? 1 : 0.92)), { x: C.x, y: y + ch / 2, z: C.z }))
      }
    } else if (floors > 0) {
      trimesh(prismTrimesh(pts, 0, y, C.x, C.z))
    }
    if (floors > 0) {
      // Parapet: an invisible wall round the roof edge, open at the exits.
      const H = 2.4
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i]
        const [bx, bz] = pts[(i + 1) % pts.length]
        const mx = (ax + bx) / 2
        const mz = (az + bz) / 2
        if (anchors.exits.some((e) => Math.hypot(mx - e.x, mz - e.z) < e.r)) continue
        const len = Math.hypot(bx - ax, bz - az)
        const yaw = Math.atan2(-(bz - az), bx - ax)
        colliders.push(
          addFixed(RAPIER.ColliderDesc.cuboid(len / 2 + 0.15, H / 2, 0.15), { x: C.x + mx, y: y + H / 2, z: C.z + mz }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
        )
      }
    }
  }

  // --- Building swap ------------------------------------------------------------------------
  function disposeBuilding() {
    for (const m of [floorsMesh, foundation, roof, edge, blocks, crown, lobbyShell]) {
      if (!m) continue
      group.remove(m)
      m.traverse?.((o) => {
        if (o.isMesh && o.geometry !== blockGeo) o.geometry.dispose()
      })
    }
    slabMat?.dispose()
    glassMat?.dispose()
    glassMat?.map?.dispose()
    glassMat?.emissiveMap?.dispose()
    crown = null
    lobbyShell = null
  }

  function computeAnchors() {
    const pts = spec.pts
    const half = ELEVATOR.mast * 1.5 + ELEVATOR.cage
    const x0 = ELEVATOR.centerX - half
    const x1 = ELEVATOR.centerX + half
    const wall = southEdgeMax(pts, x0, x1)
    anchors.cageZ = wall + 0.7 + ELEVATOR.cage / 2
    anchors.liftX = ELEVATOR.centerX + (ELEVATOR.mast + ELEVATOR.cage) / 2
    anchors.botX = ELEVATOR.centerX - (ELEVATOR.mast + ELEVATOR.cage) / 2
    anchors.liftWall = southEdgeAt(pts, anchors.liftX) ?? wall
    anchors.botWall = southEdgeAt(pts, anchors.botX) ?? wall
    const sx0 = STAIRS.x0 - STAIRS.landing
    const sx1 = STAIRS.x0 + STAIRS.flight + STAIRS.landing
    anchors.stairsZ = southEdgeMax(pts, sx0, sx1) + 0.7 // inner edge of the inner lane
    anchors.stairsExitX = STAIRS.x0 - STAIRS.landing / 2
    anchors.stairsWall = southEdgeAt(pts, anchors.stairsExitX) ?? anchors.stairsZ
    anchors.exits = [
      { x: anchors.liftX, z: anchors.liftWall, r: ELEVATOR.cage / 2 + 0.4 },
      { x: anchors.botX, z: anchors.botWall, r: ELEVATOR.cage / 2 + 0.4 },
      { x: anchors.stairsExitX, z: anchors.stairsWall, r: STAIRS.landing / 2 + 0.6 },
    ]
    // The spot on the roof just inside the elevator exit (where the fill starts).
    anchors.roofEntry = { x: anchors.liftX, z: anchors.liftWall - 2 }

    // Lobby door: the south-face wall panels whose middle is within half a door of doorX.
    const dz = southEdgeAt(pts, INSIDE.doorX) ?? 0
    door.edges.clear()
    let a = null
    let b = null
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      if (Math.abs((p[0] + q[0]) / 2 - INSIDE.doorX) < INSIDE.doorW / 2 && (p[1] + q[1]) / 2 > dz - 2) {
        door.edges.add(i)
        for (const v of [p, q]) {
          if (!a || v[0] < a[0]) a = v
          if (!b || v[0] > b[0]) b = v
        }
      }
    }
    if (!a) a = b = [INSIDE.doorX, dz]
    door.ax = a[0]
    door.az = a[1]
    door.bx = b[0]
    door.bz = b[1]
    door.x = (a[0] + b[0]) / 2
    door.z = (a[1] + b[1]) / 2
    door.width = Math.hypot(b[0] - a[0], b[1] - a[1])
    door.yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
    // The crown leaves room for the roof hut and a walkway along the south edge.
    let rMin = Infinity
    for (const [x, z] of pts) rMin = Math.min(rMin, Math.hypot(x, z))
    const room = Math.max(4, rMin - INSIDE.hutClear)
    const k = { spire: 0.5, dome: 0.7, ring: 0.6 }[spec.def.crown] ?? 0.5
    crownR = Math.min(spec.size * k, room)
  }

  // Finished: the two lowest floors become one tall glass lobby with the doorway cut out.
  function openLobby() {
    if (lobbyShell || floors < spec.floors) return
    const zero = new Matrix4().makeScale(0, 0, 0)
    for (let f = 0; f < INSIDE.floors; f++) floorsMesh.setMatrixAt(f, zero)
    floorsMesh.instanceMatrix.needsUpdate = true
    const geo = floorGeometry(spec.pts, INSIDE.floors * TOWER.floorHeight, TOWER.slab, 0.35, 0.12, (i) => door.edges.has(i))
    lobbyShell = new Mesh(geo, [slabMat, glassMat])
    lobbyShell.position.y = TOWER.foundation
    lobbyShell.castShadow = true
    lobbyShell.receiveShadow = true
    group.add(lobbyShell)
  }

  function computeCells() {
    const inner = offset(spec.pts, -1.2)
    const rand = mulberry32(1000 + spec.n)
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of inner) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    const s = TOWER.cell
    const out = []
    const h = TOWER.block * 0.45
    for (let x = minX + s / 2; x <= maxX; x += s) {
      for (let z = minZ + s / 2; z <= maxZ; z += s) {
        if (!pointInPolygon(x, z, inner)) continue
        if (![[-h, -h], [h, -h], [-h, h], [h, h]].every(([dx, dz]) => pointInPolygon(x + dx, z + dz, inner))) continue
        const d = Math.hypot(x - anchors.roofEntry.x, z - anchors.roofEntry.z) + rand() * 2.2
        const sy = 0.55 + rand() * 0.45
        const m = new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromEuler(new Euler((rand() - 0.5) * 0.06, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.06)), new Vector3(1, sy, 1))
        out.push({ x, z, d, m, sy })
      }
    }
    out.sort((a, b) => a.d - b.d)
    cells = out
  }

  function makeCrown() {
    const def = spec.def
    const g = new Group()
    const frame = new MeshStandardMaterial({ color: def.frame, roughness: 0.4, metalness: 0.3 })
    const light = neon('#ff3030', 3)
    if (def.crown === 'spire') {
      const base = new Mesh(new CylinderGeometry(crownR * 0.7, crownR, 6, 8), glassMat)
      base.position.y = 3
      const cone = new Mesh(new ConeGeometry(crownR * 0.66, 16, 8), frame)
      cone.position.y = 14
      const mast = new Mesh(new CylinderGeometry(0.25, 0.4, 22, 6), frame)
      mast.position.y = 31
      const tip = new Mesh(new SphereGeometry(0.7, 10, 8), light)
      tip.position.y = 42.5
      tip.name = 'beacon'
      g.add(base, cone, mast, tip)
    } else if (def.crown === 'dome') {
      const dome = new Mesh(new SphereGeometry(crownR, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glassMat)
      const ring = new Mesh(new TorusGeometry(crownR * 1.03, 0.5, 8, 40), frame)
      ring.rotation.x = Math.PI / 2
      const mast = new Mesh(new CylinderGeometry(0.2, 0.35, 14, 6), frame)
      mast.position.y = crownR + 6
      const tip = new Mesh(new SphereGeometry(0.6, 10, 8), light)
      tip.position.y = crownR + 13.5
      tip.name = 'beacon'
      g.add(dome, ring, mast, tip)
    } else {
      const halo = new Mesh(new TorusGeometry(crownR, 0.9, 10, 48), neon(def.glass, 3))
      halo.rotation.x = Math.PI / 2
      halo.position.y = 8
      halo.name = 'halo'
      const posts = new Group()
      for (let i = 0; i < 6; i++) {
        const p = new Mesh(new CylinderGeometry(0.4, 0.4, 8, 6), frame)
        const a = (i / 6) * Math.PI * 2
        p.position.set(Math.cos(a) * crownR, 4, Math.sin(a) * crownR)
        posts.add(p)
      }
      g.add(halo, posts)
    }
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
    return g
  }

  function setBuilding(n, keep = null) {
    disposeBuilding()
    contrib.clear()
    builders = null
    spec = buildingSpec(n)
    floors = keep ? Math.min(keep.floors, spec.floors) : 0
    floorBlocks = keep ? Math.min(keep.blocks, spec.perFloor[floors] ?? 0) : 0
    phase = floors >= spec.floors ? 'celebrate' : 'building'
    phaseTime = 0
    sink = 0
    group.position.set(C.x, 0, C.z)
    const def = spec.def

    const win = paintWindows(def.glass, def.frame, 6, 800 + n)
    const map = toTexture(win.color, { srgb: true })
    const emap = toTexture(win.emissive, { srgb: true })
    map.repeat.set(1 / 9, 1)
    emap.repeat.copy(map.repeat)
    glassMat = new MeshStandardMaterial({ map, emissiveMap: emap, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.12, metalness: 0.35, envMapIntensity: 1.5 })
    slabMat = new MeshStandardMaterial({ color: def.slab, roughness: 0.5 })
    const geo = floorGeometry(spec.pts, TOWER.floorHeight, TOWER.slab)
    floorsMesh = new InstancedMesh(geo, [slabMat, glassMat], spec.floors)
    floorsMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    const m = new Matrix4()
    for (let f = 0; f < spec.floors; f++) floorsMesh.setMatrixAt(f, m.makeTranslation(0, TOWER.foundation + f * TOWER.floorHeight, 0))
    floorsMesh.count = floors
    floorsMesh.castShadow = true
    floorsMesh.receiveShadow = true
    floorsMesh.frustumCulled = false
    group.add(floorsMesh)

    // Foundation: a coloured plinth (the building's base band) with a concrete top.
    const fShape = new Shape(offset(spec.pts, 1.6).map(([x, z]) => ({ x, y: -z })))
    const fGeo = new ExtrudeGeometry(fShape, { depth: TOWER.foundation + 0.5, bevelEnabled: false })
    fGeo.rotateX(-Math.PI / 2)
    fGeo.translate(0, -0.5, 0)
    foundation = new Mesh(fGeo, [foundationTop, new MeshStandardMaterial({ color: def.base, roughness: 0.35, metalness: 0.2 })])
    foundation.receiveShadow = true
    group.add(foundation)

    roof = new Mesh(capGeometry(spec.pts), roofMat)
    roof.receiveShadow = true
    group.add(roof)
    edge = new Mesh(ringGeometry(spec.pts, 0.35), edgeMat)
    group.add(edge)

    computeAnchors()
    computeCells()
    blocks = new InstancedMesh(blockGeo, blockMaterial(), Math.max(1, cells.length))
    blocks.instanceMatrix.setUsage(DynamicDrawUsage)
    blocks.castShadow = true
    blocks.receiveShadow = true
    blocks.frustumCulled = false
    cells.forEach((c, i) => blocks.setMatrixAt(i, c.m))
    blocks.count = 0
    group.add(blocks)
    shown = 0
    popping.length = 0
    rising = null
    syncRoof()
    syncBlocks(true)
    if (phase !== 'building') {
      crown = makeCrown()
      crown.position.y = roofY()
      group.add(crown)
      openLobby()
    }
    buildColliders()
    emit('building', api)
    emit('height', api)
  }

  // --- Roof + blocks ------------------------------------------------------------------------------
  const roofY = () => TOWER.foundation + floors * TOWER.floorHeight
  function syncRoof() {
    const y = roofY()
    roof.position.y = y + 0.02
    edge.position.y = y + 0.05
    blocks.position.y = y + 0.02
    roof.visible = floors > 0
  }
  function needNow() {
    return spec.perFloor[floors] ?? 1
  }
  // Number of roof blocks that should show for the current floor.
  function syncBlocks(instant = false) {
    const want = phase === 'building' ? Math.min(cells.length, Math.floor((floorBlocks / needNow()) * cells.length)) : 0
    if (want < shown) {
      shown = want
      blocks.count = shown
      popping.length = 0
      return
    }
    for (let i = shown; i < want; i++) {
      if (instant) continue
      popping.push({ i, t: 0 })
    }
    shown = want
    blocks.count = shown
    if (popping.length > 40) finishPops(popping.length - 40)
    if (instant) for (let i = 0; i < shown; i++) blocks.setMatrixAt(i, cells[i].m)
    blocks.instanceMatrix.needsUpdate = true
  }
  function finishPops(n) {
    for (let k = 0; k < n; k++) {
      const p = popping.shift()
      blocks.setMatrixAt(p.i, cells[p.i].m)
    }
  }

  // --- Building logic --------------------------------------------------------------------------------
  // Adds blocks to the floor in progress; completes floors (and the building). Returns the
  // number of blocks it took (0 once the building is done).
  // `who` = { id, name } of whoever placed them (the finale's Top Builders, `contributors()`).
  function addBlocks(n, who = null) {
    if (shared) return addBlocksShared(n, who)
    if (phase !== 'building' || n <= 0) return 0
    let left = n
    let taken = 0
    while (left > 0 && phase === 'building') {
      const room = needNow() - floorBlocks
      const put = Math.min(room, left)
      floorBlocks += put
      left -= put
      taken += put
      // Credited before completeFloor: the last block can finish the building, and the
      // 'complete' listeners read the final tally.
      if (who && put > 0) {
        const c = contrib.get(who.id)
        if (c) c.blocks += put
        else contrib.set(who.id, { id: who.id, name: who.name, blocks: put })
      }
      if (floorBlocks >= needNow()) completeFloor()
    }
    syncBlocks()
    return taken
  }
  // Blocks of the current building placed up to (finished floors f, `b` blocks into the next one).
  function placedAt(f, b) {
    let p = b
    for (let i = 0; i < f; i++) p += spec.perFloor[i] ?? 0
    return p
  }
  // Shared mode: the number of blocks that still fit in the building (per the latest server state minus
  // what was reported but is not in it yet) goes to the caller for its bag / cash accounting and up to the
  // server; the DISPLAYED progress changes only when the server's state comes back (~100 ms later).
  function addBlocksShared(n, who) {
    if (phase !== 'building' || !(n > 0)) return 0
    const now = performance.now()
    inflight = inflight.filter((e) => now - e.t < INFLIGHT_MS)
    let pending = 0
    for (const e of inflight) pending += e.n
    const take = Math.min(Math.floor(n), Math.max(0, Math.floor(spec.total - placedAt(floors, floorBlocks) - pending)))
    if (take <= 0) return 0
    inflight.push({ t: now, n: take })
    // Kept locally too: the fallback list when the server's `built` message does not arrive.
    if (who) {
      const c = contrib.get(who.id)
      if (c) c.blocks += take
      else contrib.set(who.id, { id: who.id, name: who.name, blocks: take })
    }
    reporter?.(take)
    return take
  }
  // Who placed blocks on the current building, most first. Shared: the server's top builders (`built`).
  const contributors = () => (shared && builders && spec && builders.n === spec.n ? builders.list.slice() : [...contrib.values()].sort((a, b) => b.blocks - a.blocks))

  function completeFloor() {
    floors++
    floorBlocks = 0
    shown = 0
    blocks.count = 0
    popping.length = 0
    floorsMesh.count = floors
    rising = { t: 0, f: floors - 1 }
    syncRoof()
    const done = floors >= spec.floors
    if (done) {
      phase = 'celebrate'
      phaseTime = 0
      crown = makeCrown()
      crown.position.y = roofY()
      crown.scale.setScalar(0.01)
      group.add(crown)
      openLobby()
    }
    buildColliders()
    emit('floor', { floor: floors, of: spec.floors, done })
    emit('height', api)
    if (done) emit('complete', { n: spec.n, name: spec.def.name })
  }

  // --- Queries ------------------------------------------------------------------------------------
  const local = (x, z) => [x - C.x, z - C.z]
  function onRoof(x, y, z) {
    if (phase === 'sinking') return false
    const [lx, lz] = local(x, z)
    return Math.abs(y - roofY()) < 1.6 && pointInPolygon(lx, lz, spec.pts)
  }
  // World position of the next block to place (where you need to be within range of).
  const cursorV = new Vector3()
  function cursor() {
    const c = cells[Math.min(shown, cells.length - 1)] ?? { x: anchors.roofEntry.x, z: anchors.roofEntry.z }
    return cursorV.set(C.x + c.x, roofY(), C.z + c.z)
  }

  // The closest of the next `n` open cells (the build front) to (x, z), in world space,
  // with its distance: you build when you are within Build Range of the front, not just of
  // the single next block (the front moves fast when the room is busy).
  const frontV = new Vector3()
  function nearestFront(x, z, n = 40) {
    let best = null
    let bd = Infinity
    const end = Math.min(cells.length, shown + n)
    for (let i = shown; i < end; i++) {
      const c = cells[i]
      const d = Math.hypot(C.x + c.x - x, C.z + c.z - z)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    if (!best) {
      const c = cursor()
      return { pos: frontV.copy(c), d: Math.hypot(c.x - x, c.z - z) }
    }
    return { pos: frontV.set(C.x + best.x, roofY(), C.z + best.z), d: bd }
  }

  const progress = () => {
    let placed = floorBlocks
    for (let f = 0; f < floors; f++) placed += spec.perFloor[f]
    return { placed, total: spec.total, floor: Math.min(floors + 1, spec.floors), floors: spec.floors, floorBlocks, floorNeed: needNow(), done: phase !== 'building' }
  }

  // --- Frame ----------------------------------------------------------------------------------------
  const tmpM = new Matrix4()
  const tmpP = new Vector3()
  const tmpQ = new Quaternion()
  const tmpS = new Vector3()
  function update(dt, elapsed, night) {
    phaseTime += dt
    glassMat.emissiveIntensity = night * 1.3
    // Blocks popping in: drop from above with an overshoot.
    if (popping.length) {
      for (let k = popping.length - 1; k >= 0; k--) {
        const p = popping[k]
        p.t += dt
        const c = cells[p.i]
        const t = Math.min(1, p.t / 0.32)
        const s = Math.max(0.01, easeOutBack(t))
        c.m.decompose(tmpP, tmpQ, tmpS)
        tmpP.y = (1 - t) * 2.2
        tmpS.set(s, c.sy * s, s)
        blocks.setMatrixAt(p.i, tmpM.compose(tmpP, tmpQ, tmpS))
        if (t >= 1) {
          blocks.setMatrixAt(p.i, c.m)
          popping.splice(k, 1)
        }
      }
      blocks.instanceMatrix.needsUpdate = true
    }
    // The newest floor grows up out of the roof.
    if (rising) {
      rising.t += dt
      const t = Math.min(1, rising.t / 0.55)
      const s = easeOutBack(t)
      tmpM.makeScale(1 + (1 - t) * 0.04, Math.max(0.01, s), 1 + (1 - t) * 0.04)
      tmpM.setPosition(0, TOWER.foundation + rising.f * TOWER.floorHeight, 0)
      floorsMesh.setMatrixAt(rising.f, tmpM)
      floorsMesh.instanceMatrix.needsUpdate = true
      if (t >= 1) rising = null
    }
    // Ghost block where the next one goes.
    const show = phase === 'building'
    ghost.visible = show
    if (show) {
      const c = cells[Math.min(shown, cells.length - 1)]
      if (c) ghost.position.set(c.x, roofY() + 0.02 + Math.sin(elapsed * 4) * 0.08, c.z)
      ghost.material.opacity = 0.25 + Math.sin(elapsed * 4) * 0.12
    }
    edge.visible = phase === 'building'
    if (crown) {
      const t = Math.min(1, phaseTime / 0.8)
      if (phase === 'celebrate') crown.scale.setScalar(Math.max(0.01, easeOutBack(t)))
      const beacon = crown.getObjectByName('beacon')
      if (beacon) beacon.visible = Math.sin(elapsed * 5) > -0.2
      const halo = crown.getObjectByName('halo')
      if (halo) halo.rotation.z = elapsed * 0.6
    }
    // (Shared: the server decides when the open time is over, see sync.)
    if (!shared && phase === 'celebrate' && phaseTime > INSIDE.time) {
      phase = 'sinking'
      phaseTime = 0
      clearColliders()
      emit('height', api)
    }
    if (phase === 'sinking') {
      const height = roofY() + 50
      const t = Math.min(1, phaseTime / TOWER.sinkTime)
      sink = height * t * t
      group.position.y = -sink
      group.position.x = C.x + Math.sin(elapsed * 40) * 0.15 * (1 - t) // rumble
      emit('height', api)
      // Sunk: the next one rises once the Next Building reel is done (`hold`). Shared: it rises when the
      // server says so (a new `n` in sync); the sunk building just waits.
      if (t >= 1 && !shared) {
        if (holdLeft > 0) holdLeft -= dt
        else setBuilding(spec.n + 1)
      }
    }
  }

  // --- Shared tower: following the server's state ---------------------------------------------------------
  // `ts` = { n, floors, blocks, phase ('building' | 'celebrate' | 'sinking'), phaseAt (server ms) } or null
  // (not connected / not seeded: local mode), `now` = the server's clock (ms). Call it every frame: it does
  // nothing unless the state changed. Everything the local game emitted before still fires ('floor',
  // 'complete', 'building', 'height'), so the elevator, stairs, cranes, lobby, finale and main.js are unaware.
  function setShared(on) {
    on = !!on
    if (on === shared) return
    shared = on
    srv.ok = false
    inflight = []
  }

  // Raises the shown progress to the server's (`f` finished floors, `b` blocks into the next one), with the
  // normal floor visuals / events for every floor on the way (the last one finishes the building).
  function advanceTo(f, b) {
    while (floors < f && phase === 'building') {
      floorBlocks = needNow()
      completeFloor()
    }
    if (phase === 'building') {
      floorBlocks = Math.min(b, needNow())
      syncBlocks()
    }
  }

  function enterSinking(age) {
    if (phase === 'celebrate') {
      phase = 'sinking'
      clearColliders()
      emit('height', api)
    }
    if (phase === 'sinking') phaseTime = age
  }

  // The server's building is not the one shown (a new n, or a different room / reseed behind us): build it
  // at the server's progress. A finished one (celebrate / sinking) shows its crown with the right age.
  function rebuild(ts, age) {
    const building = ts.phase === 'building'
    setBuilding(ts.n, { floors: building ? ts.floors : 1e9, blocks: building ? ts.blocks : 0 })
    if (!building) {
      phaseTime = age
      if (ts.phase === 'sinking') enterSinking(age)
    }
  }

  function sync(ts, now) {
    if (!!ts !== shared) setShared(!!ts)
    if (!ts) return
    if (srv.ok && ts.n === srv.n && ts.floors === srv.floors && ts.blocks === srv.blocks && ts.phase === srv.phase && ts.phaseAt === srv.phaseAt) return
    // Blocks of ours the server has counted since the last state are no longer "in flight".
    if (srv.ok && ts.n === srv.n && ts.n === spec.n) {
      let d = placedAt(ts.floors, ts.blocks) - placedAt(srv.floors, srv.blocks)
      while (d > 0 && inflight.length) {
        const e = inflight[0]
        if (e.n <= d) {
          d -= e.n
          inflight.shift()
        } else {
          e.n -= d
          d = 0
        }
      }
    } else inflight = []
    srv.ok = true
    srv.n = ts.n
    srv.floors = ts.floors
    srv.blocks = ts.blocks
    srv.phase = ts.phase
    srv.phaseAt = ts.phaseAt
    const age = Math.max(0, (now - ts.phaseAt) / 1000)
    // A different building, or one behind what we show (another room): rebuild it.
    if (ts.n !== spec.n || ts.floors < floors || (ts.phase === 'building' && ts.floors === floors && phase === 'building' && ts.blocks < floorBlocks)) {
      rebuild(ts, age)
      return
    }
    if (ts.phase === 'building') {
      if (phase !== 'building') return rebuild(ts, age) // the server's building is still open: ours was finished early
      advanceTo(ts.floors, ts.blocks)
      return
    }
    // celebrate / sinking: the building is finished (the last floor goes through the normal visuals if it was not).
    advanceTo(spec.floors, 0)
    if (phase === 'celebrate' || phase === 'sinking') {
      if (ts.phase === 'sinking') enterSinking(age)
      else if (phase === 'celebrate') phaseTime = age
    }
  }

  // Visible roof height (sinks with the building) for the elevator, stairs and cranes.
  const visibleTop = () => (phase === 'sinking' ? Math.max(0, roofY() - sink) : roofY())

  const api = {
    get spec() {
      return spec
    },
    get floors() {
      return floors
    },
    get phase() {
      return phase
    },
    get roofY() {
      return roofY()
    },
    get visibleTop() {
      return visibleTop()
    },
    get sinking() {
      return phase === 'sinking'
    },
    get openLeft() {
      return phase === 'celebrate' ? Math.max(0, INSIDE.time - phaseTime) : 0
    },
    // The open lobby (null unless the finished building is open): floor and ceiling y and
    // the doorway (local to the centre: the chord ax,az -> bx,bz across the cut-out glass).
    get lobby() {
      return lobbyShell && phase === 'celebrate' ? { y0: lobbyY0, y1: lobbyY1, door, crownR } : null
    },
    group,
    center: C,
    anchors,
    addBlocks,
    contributors,
    // Shared tower (one per room, the server's): see sync(). `shared` is true while it follows the server.
    get shared() {
      return shared
    },
    sync,
    setShared,
    // fn(n) gets the blocks this player places while shared (net.sendBuild).
    setReporter(fn) {
      reporter = fn
    },
    // The server's `built` message for building n: its top builders ({ id, name, blocks }, most first).
    setBuilders(n, list) {
      builders = { n, list: Array.isArray(list) ? list : [] }
    },
    onRoof,
    cursor,
    nearestFront,
    progress,
    update,
    on(name, fn) {
      listeners[name].push(fn)
    },
    // Lift anything standing on the roof when a floor completes (callers pass their own).
    toSave: () => ({ n: spec.n, floors, blocks: floorBlocks }),
    setBuilding,
    // Keeps the next building from rising for `s` more seconds after this one has sunk.
    hold(s) {
      holdLeft = Math.max(0, s)
    },
  }
  const s = saved && Number.isFinite(saved.n) ? saved : null
  setBuilding(s ? s.n : 0, s)
  return api
}
