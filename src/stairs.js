import { BoxGeometry, BufferGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RepeatWrapping, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STAIRS, TOWER } from './config.js'
import { RAPIER, addFixed, world } from './physics.js'
import { label, std } from './propkit.js'
import { mats } from './props.js'
import { paintHazard, paintLattice, toTexture } from './textures.js'

// A switchback scaffold stair tower beside the elevator that is always exactly as tall as
// the building: every finished floor adds two flights (out along the outer lane, back along
// the inner one) and two landings, and the top landing bridges onto the roof. Walking up is
// free but slow; the elevator is the fast way. Collision: one sloped box per flight, boxes
// for the landings and invisible walls round the outside so nobody falls off.

const MAX = 80 // floors' worth of instances

function boxAt(w, h, d, x, y, z) {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

// One flight along +X from x = 0 to `run`, rising 0 -> 1 (scaled per instance), lane width w.
function flightGeometry(run, w, steps = 11) {
  const parts = []
  const sx = run / steps
  for (let i = 0; i < steps; i++) parts.push(boxAt(sx + 0.02, 0.08, w - 0.1, sx * (i + 0.5), (i + 1) / steps - 0.04, 0))
  // Stringers + rail on both sides as sloped bars (affine scaling keeps them on the slope).
  const len = run
  const strGeo = (z, y, t) => {
    const g = new BoxGeometry(len, t, 0.08)
    const shear = new Matrix4().set(1, 0, 0, 0, 1 / len, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
    g.applyMatrix4(shear)
    g.translate(len / 2, y + 0.5, z)
    return g
  }
  parts.push(strGeo(w / 2, -0.12, 0.18), strGeo(-w / 2, -0.12, 0.18))
  return mergeGeometries(parts)
}

export function createStairs(scene, tower) {
  const C = tower.center
  const W = STAIRS.width
  const F = STAIRS.flight
  const L = STAIRS.landing
  const root = new Group()
  root.name = 'stairs'
  scene.add(root)

  const steel = std('#7c838d', { metalness: 0.5, roughness: 0.4 })
  const flights = new InstancedMesh(flightGeometry(F, W), steel, MAX * 2)
  const hazard = toTexture(paintHazard(), { srgb: true })
  hazard.repeat.set(2, 0.25)
  const landingGeo = mergeGeometries([boxAt(L, 0.22, W * 2, L / 2, -0.11, 0)])
  const landings = new InstancedMesh(landingGeo, std('#5f6670', { metalness: 0.45, roughness: 0.45 }), MAX * 2)
  // Scaffold: corner tubes and netting on the outside faces.
  const tubeGeo = new BoxGeometry(0.16, 1, 0.16)
  tubeGeo.translate(0, 0.5, 0)
  const tubes = new InstancedMesh(tubeGeo, mats.yellow(), 6)
  const ledgerGeo = new BoxGeometry(1, 0.12, 0.12)
  const ledgers = new InstancedMesh(ledgerGeo, mats.yellow(), MAX * 2)
  const netTex = toTexture(paintLattice('#ffb21a'), { srgb: true })
  netTex.wrapS = netTex.wrapT = RepeatWrapping
  const netMat = new MeshStandardMaterial({ map: netTex, alphaTest: 0.5, side: DoubleSide, roughness: 0.6 })
  const netOuter = new Mesh(new BoxGeometry(1, 1, 0.02), netMat)
  const netEnd = new Mesh(new BoxGeometry(0.02, 1, 1), netMat)
  for (const m of [flights, landings, tubes, ledgers]) {
    m.castShadow = true
    m.receiveShadow = true
    m.frustumCulled = false
    m.count = 0
    root.add(m)
  }
  root.add(netOuter, netEnd)
  const bridge = new Mesh(new BoxGeometry(1, 0.22, 1), std('#4a4e57', { metalness: 0.4 }))
  bridge.castShadow = true
  root.add(bridge)
  const sign = label('STAIRS', 1.1, { color: '#ffffff', outline: '#3a2a00', outlineWidth: 14 })
  root.add(sign)

  let colliders = []
  const m4 = new Matrix4()
  const q = new Quaternion()
  const v = new Vector3()
  const s = new Vector3()
  const yAxis = new Vector3(0, 1, 0)

  function level(k) {
    return k === 0 ? 0 : TOWER.foundation + k * TOWER.floorHeight
  }

  function rebuild() {
    for (const c of colliders) world.removeCollider(c, false)
    colliders = []
    const A = tower.anchors
    const floors = tower.sinking ? 0 : tower.floors
    const x0 = C.x + STAIRS.x0
    const zIn = C.z + A.stairsZ // inner edge of the inner lane (tower side)
    const zInner = zIn + W / 2 // inner lane centre
    const zOuter = zIn + W * 1.5 // outer lane centre
    const top = level(floors)
    const visible = floors > 0
    let fi = 0
    let li = 0
    let gi = 0
    for (let k = 0; k < floors; k++) {
      const y0 = level(k)
      const y2 = level(k + 1)
      const y1 = (y0 + y2) / 2
      // Flight out (outer lane, +X) and back (inner lane, -X).
      flights.setMatrixAt(fi++, m4.compose(v.set(x0, y0, zOuter), q.identity(), s.set(1, y1 - y0, 1)))
      flights.setMatrixAt(fi++, m4.compose(v.set(x0 + F, y1, zInner), q.setFromAxisAngle(yAxis, Math.PI), s.set(1, y2 - y1, 1)))
      // Mid landing (far end) and the floor landing above.
      landings.setMatrixAt(li++, m4.compose(v.set(x0 + F, y1, zIn + W), q.identity(), s.set(1, 1, 1)))
      landings.setMatrixAt(li++, m4.compose(v.set(x0 - L, y2, zIn + W), q.identity(), s.set(1, 1, 1)))
      ledgers.setMatrixAt(gi++, m4.compose(v.set(x0 + F / 2, y2 + 1, zIn + W * 2), q.identity(), s.set(F + L * 2, 1, 1)))
      ledgers.setMatrixAt(gi++, m4.compose(v.set(x0 + F / 2, y1 + 1, zIn + W * 2), q.identity(), s.set(F + L * 2, 1, 1)))
      // Colliders: a ramp per flight and the two landings.
      const ramp = (xa, ya, xb, yb, z) => {
        const len = Math.hypot(xb - xa, yb - ya)
        const ang = Math.atan2(yb - ya, xb - xa)
        const qq = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), ang)
        // Push the box down along the slope's upward normal so its top face is the ramp.
        const up = Math.cos(ang) >= 0 ? 1 : -1
        const nx = -Math.sin(ang) * 0.12 * up
        const ny = Math.cos(ang) * 0.12 * up
        colliders.push(addFixed(RAPIER.ColliderDesc.cuboid(len / 2 + 0.05, 0.12, W / 2 - 0.05), { x: (xa + xb) / 2 - nx, y: (ya + yb) / 2 - ny, z }, qq))
      }
      ramp(x0, y0, x0 + F, y1, zOuter)
      ramp(x0 + F, y1, x0, y2, zInner)
      colliders.push(addFixed(RAPIER.ColliderDesc.cuboid(L / 2, 0.11, W), { x: x0 + F + L / 2, y: y1 - 0.11, z: zIn + W }))
      colliders.push(addFixed(RAPIER.ColliderDesc.cuboid(L / 2, 0.11, W), { x: x0 - L / 2, y: y2 - 0.11, z: zIn + W }))
    }
    flights.count = fi
    landings.count = li
    ledgers.count = gi
    for (const m of [flights, landings, ledgers]) m.instanceMatrix.needsUpdate = true
    // Corner tubes + netting as tall as the stairs.
    const H = top + 1.4
    const corners = [[x0 - L, zIn + W * 2], [x0 + F + L, zIn + W * 2], [x0 + F + L, zIn], [x0 + F / 2, zIn + W * 2], [x0 - L, zIn], [x0 + F / 2, zIn]]
    corners.forEach(([x, z], i) => tubes.setMatrixAt(i, m4.compose(v.set(x, 0, z), q.identity(), s.set(1, H, 1))))
    tubes.count = visible ? corners.length : 0
    tubes.instanceMatrix.needsUpdate = true
    netTex.repeat.set((F + L * 2) / 2, H / 2)
    netOuter.visible = netEnd.visible = visible
    netOuter.scale.set(F + L * 2, H, 1)
    netOuter.position.set(x0 + F / 2, H / 2, zIn + W * 2 + 0.05)
    netEnd.scale.set(1, H, W * 2)
    netEnd.position.set(x0 + F + L + 0.05, H / 2, zIn + W)
    // The top landing's bridge onto the roof.
    const wall = C.z + A.stairsWall
    const gap = Math.max(0.6, zIn - wall + 0.6)
    bridge.visible = visible
    bridge.scale.set(L, 1, gap)
    bridge.position.set(x0 - L / 2, top - 0.11, zIn - gap / 2 + 0.05)
    sign.visible = visible
    sign.position.set(x0 - L / 2 - 0.6, 3.2, zIn + W * 2 + 0.4)
    if (visible) {
      colliders.push(addFixed(RAPIER.ColliderDesc.cuboid(L / 2, 0.11, gap / 2), { x: x0 - L / 2, y: top - 0.11, z: zIn - gap / 2 + 0.05 }))
      // Invisible walls: outside, the far end, the tower side of the flights, the lane divider
      // and the west end above the ground entrance.
      const wallBox = (hx, hy, hz, x, y, z) => colliders.push(addFixed(RAPIER.ColliderDesc.cuboid(hx, hy, hz), { x, y, z }))
      wallBox((F + L * 2) / 2, H / 2, 0.12, x0 + F / 2, H / 2, zIn + W * 2 + 0.12)
      wallBox(0.12, H / 2, W, x0 + F + L + 0.12, H / 2, zIn + W)
      wallBox((F + L) / 2, H / 2, 0.12, x0 + (F + L) / 2, H / 2, zIn - 0.12)
      wallBox(F / 2 - 0.1, H / 2, 0.06, x0 + F / 2, H / 2, zIn + W)
      if (H > 3.6) wallBox(0.12, (H - 3.4) / 2, W, x0 - L - 0.12, 3.4 + (H - 3.4) / 2, zIn + W)
    }
  }
  tower.on('height', rebuild)
  tower.on('building', rebuild)
  rebuild()
  return { rebuild }
}

export { BufferGeometry }
