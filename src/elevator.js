import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SphereGeometry } from 'three'
import { ELEVATOR } from './config.js'
import { RAPIER, addFixed } from './physics.js'
import { box, label, neon, std } from './propkit.js'
import { mats } from './props.js'
import { paintHazard, paintLattice, toTexture } from './textures.js'

// The construction hoist on the tower's south face: three yellow lattice masts as tall as
// the building, your cage between the east pair; the west pair is an empty, closed shaft (scenery).
// Stand in your cage for a moment and it rides to the other end (Elevator Speed upgrade);
// stand near the shaft at the end it is not at and it comes to fetch you. Gates close the
// shaft at the ground and the roof while the cage is away, and a bridge joins the cage to
// the roof at the top.

const smooth = (t) => t * t * (3 - 2 * t)

export function createElevator(scene, tower, { liftSpeed, onRide }) {
  const C = tower.center
  const root = new Group()
  root.name = 'elevator'
  scene.add(root)

  const latticeTex = toTexture(paintLattice('#ffc81a'), { srgb: true })
  latticeTex.wrapS = latticeTex.wrapT = RepeatWrapping
  const latticeMat = new MeshStandardMaterial({ map: latticeTex, alphaTest: 0.5, side: DoubleSide, roughness: 0.45, metalness: 0.3 })
  const hazardTex = toTexture(paintHazard(), { srgb: true })
  hazardTex.repeat.set(3, 0.5)
  const hazardMat = std('#ffffff', { map: hazardTex })
  const cageFloorMat = std('#3a3d44', { roughness: 0.6, metalness: 0.4 })
  const yellow = mats.yellow()
  const meshTex = toTexture(paintLattice('#d9dde3'), { srgb: true })
  meshTex.repeat.set(3, 3)
  const meshMat = new MeshStandardMaterial({ map: meshTex, alphaTest: 0.5, side: DoubleSide, metalness: 0.5, roughness: 0.4 })

  const S = ELEVATOR.cage
  const M = ELEVATOR.mast

  // --- Masts ---------------------------------------------------------------------------------
  const mastGeo = new BoxGeometry(M, 1, M)
  mastGeo.translate(0, 0.5, 0)
  const masts = []
  const beaconMat = neon('#ff2a2a', 3)
  const beacons = []
  for (let i = -1; i <= 1; i++) {
    const m = new Mesh(mastGeo, latticeMat)
    m.castShadow = true
    root.add(m)
    masts.push(m)
    const b = new Mesh(new SphereGeometry(0.35, 8, 6), beaconMat)
    root.add(b)
    beacons.push(b)
  }

  // --- A cage -----------------------------------------------------------------------------------
  function makeCage(paint) {
    const g = new Group()
    box(g, S, 0.3, S, cageFloorMat, 0, -0.3, 0)
    box(g, S, 0.12, 0.25, hazardMat, 0, 0, S / 2 - 0.12, false)
    box(g, S, 0.12, 0.25, hazardMat, 0, 0, -S / 2 + 0.12, false)
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) box(g, 0.18, 3.2, 0.18, paint, (x * (S - 0.2)) / 2, 0, (z * (S - 0.2)) / 2)
    box(g, S, 0.25, S, paint, 0, 3.2, 0)
    box(g, S * 0.4, 0.1, S * 0.4, mats.lamp(), 0, 3.12, 0, false)
    for (const x of [-1, 1]) {
      const wall = new Mesh(new BoxGeometry(0.04, 2.6, S - 0.3), meshMat)
      wall.position.set((x * (S - 0.2)) / 2, 1.5, 0)
      g.add(wall)
      box(g, 0.1, 0.1, S, paint, (x * (S - 0.2)) / 2, 1.1, 0) // hand rail
    }
    // Gates (bars that drop down when the doors close), front (south) and back (north).
    const gates = []
    for (const z of [S / 2 - 0.1, -S / 2 + 0.1]) {
      const gate = new Group()
      for (let i = 0; i < 9; i++) box(gate, 0.07, 2.4, 0.07, paint, -S / 2 + 0.3 + (i * (S - 0.6)) / 8, 0, 0, false)
      box(gate, S - 0.4, 0.12, 0.1, hazardMat, 0, 2.3, 0, false)
      box(gate, S - 0.4, 0.12, 0.1, hazardMat, 0, 1.1, 0, false)
      gate.position.z = z
      g.add(gate)
      gates.push(gate)
    }
    g.userData.gates = gates
    root.add(g)
    return g
  }
  const lift = makeCage(yellow)

  // Bridge from your cage to the roof, and the ground pad in front of the shaft.
  const bridge = new Group()
  const bridgeDeck = box(bridge, S - 0.2, 0.25, 1, std('#4a4e57', { metalness: 0.4 }), 0, -0.25, 0)
  const railL = box(bridge, 0.08, 1.1, 1, yellow, -S / 2 + 0.15, 0, 0)
  const railR = box(bridge, 0.08, 1.1, 1, yellow, S / 2 - 0.15, 0, 0)
  root.add(bridge)

  const pad = new Group()
  box(pad, S * 2 + M * 3 + 2, 0.12, 7, std('#5a5e66', { roughness: 0.8 }), 0, 0, 0)
  box(pad, S, 0.13, 0.4, hazardMat, 0, 0, -1.5)
  root.add(pad)
  const sign = label('ELEVATOR', 1.3, { color: '#ffd23a', outline: '#2a1a00', outlineWidth: 16 })
  root.add(sign)
  const hint = label('STAND INSIDE TO RIDE', 0.55, { color: '#ffffff', outline: '#1b1b1b', outlineWidth: 10 })
  root.add(hint)

  // --- Colliders (moved / toggled as the building changes) --------------------------------------
  const id = { x: 0, y: 0, z: 0, w: 1 }
  const mastColliders = masts.map(() => addFixed(RAPIER.ColliderDesc.cuboid(M / 2, 1, M / 2), { x: 0, y: -50, z: 0 }))
  const cageFloor = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 0.15, S / 2), { x: 0, y: -50, z: 0 })
  const bridgeCol = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 0.12, 1), { x: 0, y: -50, z: 0 })
  const gateBottom = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 1.6, 0.15), { x: 0, y: -50, z: 0 })
  const gateTop = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 1.6, 0.15), { x: 0, y: -50, z: 0 })
  // The empty west shaft is never open to players.
  const shaftBlockS = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 2, 0.15), { x: 0, y: -50, z: 0 })
  const shaftBlockN = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 1.6, 0.15), { x: 0, y: -50, z: 0 })
  const shaftBack = addFixed(RAPIER.ColliderDesc.cuboid(S / 2, 1, 0.15), { x: 0, y: -50, z: 0 })
  void id

  // --- State ------------------------------------------------------------------------------------
  // armed: the rider has to step out after arriving before the cage will take them again.
  const L = { y: 0, from: 0, to: 0, t: 0, dur: 0, state: 'bottom', doors: 1, boardT: 0, carrying: false, offX: 0, offZ: 0, armed: true }
  let top = 0 // roof y the cages serve
  let A = tower.anchors

  function layout() {
    A = tower.anchors
    const h = tower.visibleTop
    top = tower.roofY
    const mastH = h + 6
    latticeTex.repeat.set(1, mastH / 1.6)
    meshTex.repeat.set(3, 3)
    const xs = [A.botX - (S + M) / 2, (A.botX + A.liftX) / 2, A.liftX + (S + M) / 2]
    masts.forEach((m, i) => {
      m.position.set(C.x + xs[i], 0, C.z + A.cageZ)
      m.scale.y = mastH
      beacons[i].position.set(C.x + xs[i], mastH + 0.4, C.z + A.cageZ)
      mastColliders[i].setTranslation({ x: C.x + xs[i], y: mastH / 2, z: C.z + A.cageZ })
      mastColliders[i].setHalfExtents({ x: M / 2, y: mastH / 2, z: M / 2 })
    })
    const zs = C.z + A.cageZ
    pad.position.set(C.x + (A.botX + A.liftX) / 2, 0, zs + S / 2 + 3.4)
    sign.position.set(C.x + A.liftX, 4.6, zs + S / 2 + 0.2)
    hint.position.set(C.x + A.liftX, 3.75, zs + S / 2 + 0.2)
    // Bridges reach from the cage's north face to the wall.
    const span = (wall) => Math.max(0.6, A.cageZ - S / 2 - wall + 0.6)
    const ls = span(A.liftWall)
    bridge.position.set(C.x + A.liftX, top, C.z + A.cageZ - S / 2 - ls / 2 + 0.1)
    bridgeDeck.scale.z = ls
    railL.scale.z = railR.scale.z = ls
    bridgeCol.setTranslation({ x: C.x + A.liftX, y: top - 0.12, z: C.z + A.cageZ - S / 2 - ls / 2 + 0.1 })
    bridgeCol.setHalfExtents({ x: S / 2, y: 0.12, z: ls / 2 + 0.05 })
    bridge.visible = !tower.sinking && tower.floors > 0
    bridgeCol.setEnabled(bridge.visible)
    gateBottom.setTranslation({ x: C.x + A.liftX, y: 1.6, z: zs + S / 2 + 0.15 })
    gateTop.setTranslation({ x: C.x + A.liftX, y: top + 1.6, z: C.z + A.liftWall + 0.3 })
    shaftBlockS.setTranslation({ x: C.x + A.botX, y: 2, z: zs + S / 2 + 0.15 })
    shaftBlockN.setTranslation({ x: C.x + A.botX, y: top + 1.6, z: C.z + A.botWall + 0.3 })
    shaftBack.setTranslation({ x: C.x + A.botX, y: 1, z: zs - S / 2 - 0.15 })
    // The cage never hangs above the (sinking) top.
    if (L.state === 'top' || L.y > h) L.y = Math.min(h, top)
    if (tower.sinking) {
      L.state = 'bottom'
      L.y = 0
    }
  }
  tower.on('height', layout)
  tower.on('building', layout)
  layout()

  const inCage = (p, y) => Math.abs(p.x - (C.x + A.liftX)) < S / 2 - 0.35 && Math.abs(p.z - (C.z + A.cageZ)) < S / 2 - 0.35 && Math.abs(p.y - y) < 1.2

  function startRide(to, carrying) {
    L.from = L.y
    L.to = to
    L.t = 0
    const speed = carrying ? liftSpeed() : Math.max(liftSpeed(), 30)
    L.dur = Math.max(0.6, Math.abs(to - L.y) / speed + 0.5)
    L.state = to > L.y ? 'up' : 'down'
    L.carrying = carrying
    L.boardT = 0
    onRide?.(carrying ? 'start' : 'call', L.state)
  }

  // player: the player singleton (player.js); returns ride info for the HUD.
  function update(dt, elapsed, player) {
    const p = player.position
    const busy = L.state === 'up' || L.state === 'down'
    // Doors: open at rest, shut while moving.
    L.doors += ((busy ? 0 : 1) - L.doors) * Math.min(1, dt / ELEVATOR.doors * 2.5)
    if (!busy && !tower.sinking) {
      const atY = L.state === 'top' ? top : 0
      const inside = inCage(p, atY)
      if (!inside) L.armed = true
      if (inside && !player.locked && L.armed) {
        L.boardT += dt
        if (L.boardT >= ELEVATOR.board && top > 1) {
          L.offX = Math.max(-1.2, Math.min(1.2, p.x - (C.x + A.liftX)))
          L.offZ = Math.max(-1.2, Math.min(1.2, p.z - (C.z + A.cageZ)))
          player.locked = true
          player.hold = { x: p.x, y: atY, z: p.z }
          startRide(L.state === 'top' ? 0 : top, true)
        }
      } else if (!inside) {
        L.boardT = 0
        // Fetch: the player waits at the end the cage is not at.
        const nearBottom = Math.hypot(p.x - (C.x + A.liftX), p.z - (C.z + A.cageZ + S / 2 + 2)) < 5 && p.y < 2
        const nearTop = tower.onRoof(p.x, p.y, p.z) && Math.hypot(p.x - (C.x + A.liftX), p.z - (C.z + A.liftWall)) < 7
        if (L.state === 'top' && nearBottom) startRide(0, false)
        else if (L.state === 'bottom' && nearTop && top > 1) startRide(top, false)
      }
    }
    if (L.state === 'up' || L.state === 'down') {
      L.t += dt
      const k = Math.min(1, L.t / L.dur)
      L.y = L.from + (L.to - L.from) * smooth(k)
      if (L.carrying && player.hold) {
        player.hold.x = C.x + A.liftX + L.offX
        player.hold.z = C.z + A.cageZ + L.offZ
        player.hold.y = L.y
      }
      if (k >= 1) {
        L.state = L.to > 1 ? 'top' : 'bottom'
        L.y = L.to
        if (L.carrying) {
          player.locked = false
          player.hold = null
          L.armed = false
        }
        onRide?.('arrive', L.state, L.carrying)
        L.carrying = false
      }
    }
    // A floor finished while the cage was up: keep it level with the roof (and its rider).
    if (L.state === 'top' && Math.abs(L.y - top) > 0.01) L.y = top

    // Visuals.
    lift.position.set(C.x + A.liftX, L.y, C.z + A.cageZ)
    for (const g of lift.userData.gates) {
      g.position.y = L.doors * 2.35
      g.scale.y = 1 - L.doors * 0.9
    }
    for (const b of beacons) b.visible = Math.sin(elapsed * 3) > 0
    hint.visible = L.state === 'bottom' && top > 1
    // Colliders: the cage floor follows the cage; gates shut whatever end it is not at.
    cageFloor.setTranslation({ x: C.x + A.liftX, y: L.y - 0.15, z: C.z + A.cageZ })
    gateBottom.setEnabled(L.state !== 'bottom' && !player.locked)
    gateTop.setEnabled(L.state !== 'top' && tower.floors > 0 && !tower.sinking)
    shaftBlockN.setEnabled(tower.floors > 0 && !tower.sinking)
    return {
      boarding: L.boardT > 0 ? Math.min(1, L.boardT / ELEVATOR.board) : 0,
      riding: L.carrying,
      progress: L.dur ? Math.min(1, L.t / L.dur) : 0,
      dir: L.state,
    }
  }

  return {
    update,
    get lift() {
      return L
    },
    // World spots (the guide arrow).
    spots() {
      return {
        liftBottom: { x: C.x + A.liftX, z: C.z + A.cageZ + S / 2 + 2.5 },
      }
    },
  }
}
