import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, RepeatWrapping } from 'three'
import { RAPIER, addFixed } from './physics.js'
import { box, neon, std } from './propkit.js'
import { makePallet, mats } from './props.js'
import { blockMaterial } from './site.js'
import { paintLattice, toTexture } from './textures.js'

// Two yellow tower cranes beside the building. Their masts climb with the tower (always a
// little taller than the roof), the jibs slew round, the trolley runs in and out and a pallet
// of blocks rides up and down on the hook. Purely decorative apart from the mast colliders.

function latticeMat(repeatX, repeatY) {
  const t = toTexture(paintLattice('#ffc21a'), { srgb: true })
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  return new MeshStandardMaterial({ map: t, alphaTest: 0.5, side: DoubleSide, roughness: 0.45, metalness: 0.3 })
}

function makeCrane(jibLen, seed) {
  const root = new Group()
  const T = 2.2 // mast width
  // Concrete footing.
  box(root, 6, 1.2, 6, std('#9a9ea4', { roughness: 0.9 }), 0, 0, 0)
  const mastMat = latticeMat(1, 1)
  const mastGeo = new BoxGeometry(T, 1, T)
  mastGeo.translate(0, 0.5, 0)
  const mast = new Mesh(mastGeo, mastMat)
  mast.position.y = 1.2
  mast.castShadow = true
  root.add(mast)
  // Slewing top: cab, jib, counter-jib, peak and ties.
  const top = new Group()
  root.add(top)
  box(top, T + 0.6, 1.2, T + 0.6, mats.yellow(), 0, 0, 0)
  const cab = new Group()
  box(cab, 2.0, 2.0, 2.2, mats.white(), 0, 0, 0)
  box(cab, 0.05, 1.1, 1.8, mats.glass(), 1.01, 0.7, 0)
  box(cab, 1.6, 1.1, 0.05, mats.glass(), 0.1, 0.7, 1.11)
  cab.position.set(T * 0.5 + 1, 0.6, T * 0.5 + 0.6)
  top.add(cab)
  const jibMat = latticeMat(jibLen / 1.8, 1)
  const jib = new Mesh(new BoxGeometry(jibLen, 1.8, 1.8), jibMat)
  jib.geometry.translate(jibLen / 2, 0, 0)
  jib.position.y = 2.1
  jib.castShadow = true
  top.add(jib)
  const cj = jibLen * 0.35
  const cjMesh = new Mesh(new BoxGeometry(cj, 1.4, 1.8), latticeMat(cj / 1.6, 1))
  cjMesh.geometry.translate(-cj / 2, 0, 0)
  cjMesh.position.y = 2.0
  top.add(cjMesh)
  for (let i = 0; i < 3; i++) box(top, 1.2, 2.2, 2.2, std('#8d939b', { roughness: 0.8 }), -cj + 0.8 + i * 1.3, 0.2, 0)
  const peakH = 9
  const peak = new Mesh(new CylinderGeometry(0.2, T * 0.6, peakH, 4, 1, true), latticeMat(2, peakH / 2))
  peak.rotation.y = Math.PI / 4
  peak.position.y = 2.8 + peakH / 2
  top.add(peak)
  const tieMat = mats.dark()
  const tie = (x, y) => {
    const len = Math.hypot(x, peakH + 2.8 - y)
    const t = new Mesh(new CylinderGeometry(0.06, 0.06, len, 4), tieMat)
    t.position.set(x / 2, (peakH + 2.8 + y) / 2, 0)
    t.rotation.z = Math.atan2(x, peakH + 2.8 - y)
    top.add(t)
  }
  tie(jibLen * 0.7, 3)
  tie(-cj, 2.8)
  const light = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), neon('#ff2a2a', 3))
  light.position.set(0, peakH + 3, 0)
  light.name = 'beacon'
  top.add(light)
  // Trolley + hook + load.
  const trolley = new Group()
  box(trolley, 1.6, 0.5, 2.0, mats.dark(), 0, 0.6, 0)
  trolley.position.y = 0.6
  top.add(trolley)
  const cable = new Mesh(new CylinderGeometry(0.05, 0.05, 1, 4), mats.dark())
  cable.geometry.translate(0, -0.5, 0)
  trolley.add(cable)
  const hook = new Group()
  box(hook, 0.8, 0.9, 0.5, mats.orange(), 0, -0.9, 0)
  const load = makePallet(blockMaterial(), 1)
  load.position.y = -3.2
  hook.add(load)
  trolley.add(hook)
  return { root, mast, top, trolley, cable, hook, light, jibLen, phase: seed, slew: seed * 2, slewTarget: seed * 3, reach: 0.6, drop: 10 }
}

export function createCranes(scene, tower) {
  const group = new Group()
  group.name = 'cranes'
  scene.add(group)
  const cranes = [makeCrane(44, 1.3), makeCrane(38, 4.1)]
  for (const c of cranes) group.add(c.root)
  const colliders = cranes.map(() => addFixed(RAPIER.ColliderDesc.cuboid(3, 1, 3), { x: 0, y: -40, z: 0 }))
  let height = 30

  function layout() {
    const C = tower.center
    const s = tower.spec.size
    const spots = [
      [C.x - s - 12, C.z - 6],
      [C.x + s + 12, C.z - 14],
    ]
    cranes.forEach((c, i) => {
      c.root.position.set(spots[i][0], 0, spots[i][1])
      colliders[i].setTranslation({ x: spots[i][0], y: 3, z: spots[i][1] })
      colliders[i].setHalfExtents({ x: 3, y: 3, z: 3 })
    })
    height = Math.max(26, tower.visibleTop + 22 + 0)
    cranes.forEach((c, i) => {
      const h = height + i * 8
      c.mast.scale.y = h
      c.mast.material.map.repeat.set(1, h / 2.2)
      c.top.position.y = 1.2 + h
    })
  }
  tower.on('height', layout)
  tower.on('building', layout)
  layout()

  return {
    update(dt, elapsed) {
      for (const c of cranes) {
        // Slew toward a target, pick a new one when there.
        const d = c.slewTarget - c.slew
        c.slew += Math.sign(d) * Math.min(Math.abs(d), dt * 0.12)
        if (Math.abs(d) < 0.01) c.slewTarget = c.slew + (Math.sin(elapsed * 0.37 + c.phase) > 0 ? 1 : -1) * (0.6 + Math.abs(Math.sin(elapsed + c.phase)) * 1.4)
        c.top.rotation.y = c.slew
        c.reach = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed * 0.11 + c.phase))
        c.trolley.position.x = c.jibLen * c.reach
        const drop = 6 + (0.5 + 0.5 * Math.sin(elapsed * 0.17 + c.phase * 2)) * Math.max(4, height * 0.6)
        c.cable.scale.y = drop
        c.hook.position.y = -drop
        c.hook.rotation.y = Math.sin(elapsed * 0.5 + c.phase) * 0.3
        c.light.visible = Math.sin(elapsed * 2.6 + c.phase) > 0
      }
    },
  }
}
