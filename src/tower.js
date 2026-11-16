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
// BUILDINGS and a number of floors (BUILDING_SCALE); each floor's block count is set when it
// starts, from the bags of whoever is building (floorNeed: the server's, or yours offline). Finished
// floors are one InstancedMesh (slab band + curtain-wall glass), the roof is a concrete cap
// with a glowing green edge, and the floor in progress shows as stone blocks popping onto
// the roof, filling it from the elevator side outward. Collision: a trimesh prism up to
// the roof (no parapet: the edge is open on every side).
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
  const size = def.size + Math.min(6, Math.floor(n / BUILDINGS.length) * 2)
  return { n, def, floors, size, pts: footprint(def.shape, size) }
}
// Blocks floor `floor` of building n needs when the builders' bags (blocks one full bag places) add up to
// `trip`: about BUILDING_SCALE trips of them, never under the minimum. Same rule as the backend tower.ts.
export function floorNeed(n, floor, trip) {
  const S = BUILDING_SCALE
  const trips = Math.min(S.tripsMax, S.tripsBase + n * S.tripsPer)
  const min = Math.max(1, Math.round(S.minBase * Math.pow(S.minGrowth, n) * (1 + floor * S.floorGrowth)))
  return Math.max(min, Math.round(Math.min(trips * Math.max(0, trip || 0) * (1 + floor * S.floorGrowth), 1e15)))
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
  let need = 1 // blocks the floor being built needs (sized when it starts: floorNeed / the server's `need`)
  let placedAll = 0 // blocks placed on this building (all floors)
  let tripOf = () => 0 // fn(): blocks one full bag of yours places (main.js): sizes the floors in local play
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
  const srv = { ok: false, n: -1, floors: 0, blocks: 0, need: 0, placed: 0, phase: '', phaseAt: 0 } // the last server state applied
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

  // --- Brick piles (TOWER.pile) -----------------------------------------------------------------------
  // Feedback that does not depend on the floor's size: every block thrown (yours, or what the server says
  // others placed) lands as a brick on a pallet pile near the build front; a full pile is "laid" (flattens
  // into the slab) and starts again. Purely visual: the real progress is floorBlocks / the roof blocks.
  const P = TOWER.pile
  const perPile = P.cols * P.rows * P.layers
  const [BX, BY, BZ] = P.brick
  const brickGeo = new BoxGeometry(BX * 0.97, BY * 0.95, BZ * 0.97)
  brickGeo.translate(0, BY / 2, 0)
  const palletGeo = new BoxGeometry(P.cols * BX + 0.3, 0.18, P.rows * BZ + 0.3)
  palletGeo.translate(0, 0.09, 0)
  const pileRoot = new Group()
  group.add(pileRoot)
  const bricks = new InstancedMesh(brickGeo, new MeshStandardMaterial({ color: '#c8693f', roughness: 0.8 }), P.count * perPile)
  bricks.instanceMatrix.setUsage(DynamicDrawUsage)
  bricks.castShadow = true
  bricks.frustumCulled = false
  bricks.count = P.count * perPile
  const pallets = new InstancedMesh(palletGeo, new MeshStandardMaterial({ color: '#9a6a3a', roughness: 0.9 }), P.count)
  pallets.instanceMatrix.setUsage(DynamicDrawUsage)
  pallets.receiveShadow = true
  pallets.frustumCulled = false
  pileRoot.add(pallets, bricks)
  // { cell (index into cells), n (bricks on it), due: [s until each incoming brick lands], pop: [age of each brick], lay (s into laying, -1 = not) }
  const piles = []
  for (let i = 0; i < P.count; i++) piles.push({ cell: -1, n: 0, due: [], pop: new Float32Array(perPile).fill(9), lay: -1, x: 0, z: 0, yaw: 0 })
  const pileListeners = [] // fn({ x, y, z }) world position of a pile that was just laid
  const pileJit = [] // a fixed small offset / turn per brick slot so piles look hand-stacked
  {
    const r = mulberry32(4242)
    for (let i = 0; i < perPile; i++) pileJit.push([(r() - 0.5) * 0.06, (r() - 0.5) * 0.06, (r() - 0.5) * 0.12])
  }
  // Puts every pile on its cell past the build front (a pile the front has reached moves on, laid).
  function placePiles(reset = false) {
    const last = cells.length - 1
    for (let k = 0; k < piles.length; k++) {
      const p = piles[k]
      let want
      if (reset) want = Math.min(last, shown + P.ahead + k * P.spacing)
      else {
        // Moves only once the build front has reached it, to the far end of the row of piles.
        if (p.cell > shown || last < 0) continue
        let far = shown + P.ahead - P.spacing
        for (const o of piles) if (o !== p) far = Math.max(far, o.cell)
        want = Math.min(last, far + P.spacing)
        if (want === p.cell) continue
        // It counts as laid where it stood.
        if (p.n > 0 && p.lay < 0) for (const fn of pileListeners) fn({ x: C.x + p.x, y: roofY(), z: C.z + p.z })
      }
      p.n = 0
      p.due.length = 0
      p.lay = -1
      p.cell = want
      const c = cells[want]
      if (c) {
        p.x = c.x
        p.z = c.z
        p.yaw = ((k * 1.7) % 1) * 0.5 - 0.25
      }
    }
  }
  // The pile nearest (lx, lz) (local), skipping one being laid when another is free.
  function nearestPile(lx, lz) {
    let best = null
    let bd = Infinity
    for (const p of piles) {
      if (p.cell < 0) continue
      const d = Math.hypot(p.x - lx, p.z - lz) + (p.lay >= 0 ? 1e3 : 0) + (p.n + p.due.length >= perPile ? 50 : 0)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }
  // Local position of brick slot i on a pile (rows x cols per layer, alternate layers shifted a little).
  const slotV = new Vector3()
  function slotPos(p, i) {
    const layer = Math.floor(i / (P.cols * P.rows))
    const j = i % (P.cols * P.rows)
    const cx = (j % P.cols) - (P.cols - 1) / 2
    const cz = Math.floor(j / P.cols) - (P.rows - 1) / 2
    const sx = cx * BX + (layer % 2 ? 0.05 : -0.05) + pileJit[i][0]
    const sz = cz * BZ + pileJit[i][1]
    const cs = Math.cos(p.yaw)
    const sn = Math.sin(p.yaw)
    return slotV.set(p.x + sx * cs - sz * sn, 0.18 + layer * BY, p.z + sx * sn + sz * cs)
  }
  // A brick headed for the pile nearest world (x, z), landing in `delay` s. Returns the world point it lands
  // on (the top of that pile) for the flying-block effect, or null when there is nothing to build.
  const dropV = new Vector3()
  function dropBrick(x, z, delay = 0) {
    if (phase !== 'building' || !spec) return null
    const p = nearestPile(x - C.x, z - C.z)
    if (!p) return null
    const i = Math.min(perPile - 1, p.n + p.due.length)
    p.due.push(delay)
    const s = slotPos(p, i)
    return dropV.set(C.x + s.x, roofY() + s.y + BY / 2, C.z + s.z)
  }
  // Blocks other players placed (shared mode): a few bricks drop onto a random pile from above.
  function othersPlaced(n) {
    if (!(n > 0) || phase !== 'building') return
    const k = Math.min(6, Math.ceil(Math.log2(n + 1)))
    const free = piles.filter((p) => p.cell >= 0 && p.lay < 0)
    if (!free.length) return
    const p = free[Math.floor(Math.random() * free.length)]
    for (let i = 0; i < k; i++) p.due.push(i * 0.08)
  }
  const pm = new Matrix4()
  const pq = new Quaternion()
  const pe = new Euler()
  const ps = new Vector3()
  const hidden = new Matrix4().makeScale(0, 0, 0)
  function updatePiles(dt) {
    const on = phase === 'building' && !!spec
    pileRoot.visible = on
    if (!on) return
    for (let k = 0; k < piles.length; k++) {
      const p = piles[k]
      // Incoming bricks land.
      for (let d = p.due.length - 1; d >= 0; d--) {
        p.due[d] -= dt
        if (p.due[d] > 0) continue
        p.due.splice(d, 1)
        if (p.lay >= 0) continue
        if (p.n < perPile) p.pop[p.n++] = 0
        if (p.n >= perPile) p.lay = 0
      }
      // Laying: the pile flattens into the slab, then it is empty again.
      let squash = 1
      if (p.lay >= 0) {
        p.lay += dt
        const t = Math.min(1, p.lay / P.layTime)
        squash = 1 - t * t
        if (t >= 1) {
          for (const fn of pileListeners) fn({ x: C.x + p.x, y: roofY(), z: C.z + p.z })
          p.n = 0
          p.lay = -1
          squash = 1
        }
      }
      pq.setFromEuler(pe.set(0, p.yaw, 0))
      pallets.setMatrixAt(k, p.cell < 0 ? hidden : pm.compose(ps.set(p.x, 0, p.z), pq, tmpS1.set(1, 1, 1)))
      for (let i = 0; i < perPile; i++) {
        const idx = k * perPile + i
        if (i >= p.n || p.cell < 0) {
          bricks.setMatrixAt(idx, hidden)
          continue
        }
        p.pop[i] += dt
        const t = Math.min(1, p.pop[i] / 0.22)
        const s = Math.max(0.01, easeOutBack(t))
        const at = slotPos(p, i)
        at.y = at.y * squash + (1 - t) * 0.9
        pq.setFromEuler(pe.set(0, p.yaw + pileJit[i][2], 0))
        bricks.setMatrixAt(idx, pm.compose(at, pq, tmpS1.set(s, s * Math.max(0.05, squash), s)))
      }
    }
    pallets.instanceMatrix.needsUpdate = true
    bricks.instanceMatrix.needsUpdate = true
  }
  const tmpS1 = new Vector3()
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
    // No parapet: the roof edge is open on every side, so players can step off anywhere
    // and drop to the ground (parachute / landing handle the fall).
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
    // The floor's size: the server's (shared), else sized to your bag now; a saved floor bigger than that
    // just needs one more block.
    need = keep?.need > 0 ? keep.need : floorNeed(n, floors, tripOf())
    floorBlocks = keep ? Math.max(0, Math.min(keep.blocks || 0, keep?.need > 0 ? need : need - 1)) : 0
    placedAll = keep?.placed > 0 ? keep.placed : floorBlocks
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
    shown = 0
    placePiles(true)
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
    pileRoot.position.y = y + 0.02
    roof.visible = floors > 0
  }
  function needNow() {
    return Math.max(1, need)
  }
  // Number of roof blocks that should show for the current floor.
  function syncBlocks(instant = false) {
    // Floors are sized to the builders' bags (floorNeed), so the roof fills in true proportion: one bag of
    // yours covers a big, visible share of it. At least one block shows once any is placed.
    const frac = Math.min(1, floorBlocks / needNow())
    const want = phase === 'building' && floorBlocks > 0 ? Math.min(cells.length, Math.max(1, Math.ceil(frac * cells.length - 1e-6))) : 0
    if (want < shown) {
      shown = want
      blocks.count = shown
      popping.length = 0
      placePiles(true)
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
    placePiles()
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
      placedAll += put
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
  // Shared mode: the number of blocks that still fit in the building (per the latest server state minus
  // what was reported but is not in it yet; floors not started yet are counted at this floor's size, the
  // server clamps exactly) goes to the caller for its bag / cash accounting and up to the server; the
  // DISPLAYED progress changes only when the server's state comes back (~100 ms later).
  function addBlocksShared(n, who) {
    if (phase !== 'building' || !(n > 0)) return 0
    const now = performance.now()
    inflight = inflight.filter((e) => now - e.t < INFLIGHT_MS)
    let pending = 0
    for (const e of inflight) pending += e.n
    const left = needNow() - floorBlocks + Math.max(0, spec.floors - floors - 1) * needNow()
    const take = Math.min(Math.floor(n), Math.max(0, Math.floor(left - pending)))
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
    // The next floor is sized to who is building now (shared: sync() sets the server's size right after).
    need = floorNeed(spec.n, floors, tripOf())
    shown = 0
    blocks.count = 0
    popping.length = 0
    floorsMesh.count = floors
    rising = { t: 0, f: floors - 1 }
    placePiles(true) // the piles were built into the floor that just rose
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

  // `frac` = how much of the building is up (finished floors + the floor in progress), `floorFrac` = the floor
  // in progress (one bag of yours is a big share of it: floors are sized to the builders' bags).
  const progress = () => {
    const floorFrac = phase === 'building' ? Math.min(1, floorBlocks / needNow()) : 1
    const frac = phase === 'building' ? Math.min(1, (floors + floorFrac) / spec.floors) : 1
    return { placed: placedAll, frac, floorFrac, floor: Math.min(floors + 1, spec.floors), floors: spec.floors, floorBlocks, floorNeed: needNow(), done: phase !== 'building' }
  }

  // --- Frame ----------------------------------------------------------------------------------------
  const tmpM = new Matrix4()
  const tmpP = new Vector3()
  const tmpQ = new Quaternion()
  const tmpS = new Vector3()
  function update(dt, elapsed, night) {
    phaseTime += dt
    glassMat.emissiveIntensity = night * 1.3
    updatePiles(dt)
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
  function advanceTo(f, b, n = 0) {
    while (floors < f && phase === 'building') {
      floorBlocks = needNow()
      completeFloor()
    }
    if (phase === 'building') {
      if (n > 0) need = n // the server's size for this floor (it can shrink when the room gets weaker)
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
    setBuilding(ts.n, { floors: building ? ts.floors : 1e9, blocks: building ? ts.blocks : 0, need: building ? ts.need : 0, placed: ts.placed })
    if (!building) {
      phaseTime = age
      if (ts.phase === 'sinking') enterSinking(age)
    }
  }

  function sync(ts, now) {
    if (!!ts !== shared) setShared(!!ts)
    if (!ts) return
    if (srv.ok && ts.n === srv.n && ts.floors === srv.floors && ts.blocks === srv.blocks && ts.need === srv.need && ts.phase === srv.phase && ts.phaseAt === srv.phaseAt) return
    // Blocks of ours the server has counted since the last state are no longer "in flight".
    if (srv.ok && ts.n === srv.n && ts.n === spec.n) {
      let d = (ts.placed || 0) - (srv.placed || 0)
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
      // Whatever is left was placed by other players: bricks land on the piles for them too.
      othersPlaced(d)
    } else inflight = []
    srv.ok = true
    srv.n = ts.n
    srv.floors = ts.floors
    srv.blocks = ts.blocks
    srv.need = ts.need
    srv.placed = ts.placed
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
      advanceTo(ts.floors, ts.blocks, ts.need)
      placedAll = ts.placed || placedAll
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
    // fn() -> blocks one full bag of yours places: sizes each new floor in local play (shared: the server's).
    setTripSource(fn) {
      tripOf = typeof fn === 'function' ? fn : () => 0
    },
    // The server's `built` message for building n: its top builders ({ id, name, blocks }, most first).
    setBuilders(n, list) {
      builders = { n, list: Array.isArray(list) ? list : [] }
    },
    onRoof,
    cursor,
    nearestFront,
    // Brick piles: dropBrick(x, z, delay) -> world landing point (or null); onPileLaid(fn({ x, y, z })).
    dropBrick,
    onPileLaid(fn) {
      pileListeners.push(fn)
    },
    progress,
    update,
    on(name, fn) {
      listeners[name].push(fn)
    },
    // Lift anything standing on the roof when a floor completes (callers pass their own).
    toSave: () => ({ n: spec.n, floors, blocks: floorBlocks }),
    get floorNeedNow() {
      return needNow()
    },
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
