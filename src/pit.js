import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Euler, Vector3 } from 'three'
import { LAYOUT } from './config.js'
import { bake } from './bake.js'
import { box, flatText, label, neon, solidBox, std } from './propkit.js'
import { makeForklift, makeMixerTruck, mats } from './props.js'
import { blockMaterial } from './site.js'
import { mulberry32, paintConcrete, paintHazard, toTexture } from './textures.js'

// The Blocks pit: a walled concrete yard full of stacked stone blocks. Stand inside the
// glowing yellow zone and blocks fly off the stacks into your bag (Block Grab upgrade).
// Entrance on the east side, facing the plaza.

export function createPit(scene) {
  const P = LAYOUT.pit
  const root = new Group()
  root.name = 'pit'
  const statics = new Group()
  const rand = mulberry32(777)
  const x0 = P.x - P.w / 2
  const x1 = P.x + P.w / 2
  const z0 = P.z - P.d / 2
  const z1 = P.z + P.d / 2
  const gate = 5 // half width of the entrance

  // Floor slab and low walls.
  const conc = toTexture(paintConcrete(256, '#c9cbcd', '#a3a7ab', 818), { srgb: true })
  conc.repeat.set(P.w / 8, P.d / 8)
  const floor = new Mesh(new PlaneGeometry(P.w, P.d), new MeshStandardMaterial({ map: conc, roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(P.x, 0.05, P.z)
  floor.receiveShadow = true
  root.add(floor)
  const wallMat = std('#b8bcc2', { roughness: 0.85 })
  const capMat = std('#ffc21a', { roughness: 0.5 })
  const WH = 1.1
  const wall = (x, z, w, d) => {
    box(statics, w, WH, d, wallMat, x, 0, z)
    box(statics, w + 0.1, 0.12, d + 0.1, capMat, x, WH, z)
    solidBox(w / 2, WH, d / 2, x, WH, z)
  }
  wall(P.x, z0, P.w, 0.6)
  wall(P.x, z1, P.w, 0.6)
  wall(x0, P.z, 0.6, P.d)
  wall(x1, z0 + (P.d / 2 - gate) / 2, 0.6, P.d / 2 - gate)
  wall(x1, z1 - (P.d / 2 - gate) / 2, 0.6, P.d / 2 - gate)
  // Hazard stripe across the entrance and lamp posts on its sides.
  const hz = toTexture(paintHazard(), { srgb: true })
  hz.repeat.set(4, 1)
  const stripe = new Mesh(new PlaneGeometry(1.4, gate * 2), std('#ffffff', { map: hz }))
  stripe.rotation.x = -Math.PI / 2
  stripe.position.set(x1, 0.07, P.z)
  root.add(stripe)

  // The collection zone: glowing yellow outline + a soft fill.
  const zw = P.zoneW
  const zd = P.zoneD
  const zx = P.x + 4
  const lineMat = neon('#ffd21a', 2.4)
  const edge = (x, z, w, d) => {
    const m = new Mesh(new BoxGeometry(w, 0.06, d), lineMat)
    m.position.set(x, 0.09, z)
    root.add(m)
  }
  edge(zx, P.z - zd / 2, zw, 0.35)
  edge(zx, P.z + zd / 2, zw, 0.35)
  edge(zx - zw / 2, P.z, 0.35, zd)
  edge(zx + zw / 2, P.z, 0.35, zd)
  const fill = new Mesh(new PlaneGeometry(zw, zd), new MeshStandardMaterial({ color: '#fff6c8', transparent: true, opacity: 0.18, roughness: 1 }))
  fill.rotation.x = -Math.PI / 2
  fill.position.set(zx, 0.08, P.z)
  root.add(fill)
  const word = flatText('BLOCKS', 3.2, { color: '#2fa8ff', outline: '#ffffff', outlineWidth: 18 })
  word.rotation.x = -Math.PI / 2
  word.rotation.z = Math.PI / 2
  word.position.set(zx + zw / 2 - 2.6, 0.1, P.z)
  root.add(word)

  // Block stacks round the sides (instanced), each with a collider.
  const blockGeo = new BoxGeometry(1.9, 1.9, 1.9)
  blockGeo.translate(0, 0.95, 0)
  const spots = []
  const mats4 = []
  const stack = (x, z, h) => {
    for (let i = 0; i < h; i++) {
      const e = new Euler(0, (rand() - 0.5) * 0.25, 0)
      mats4.push(new Matrix4().compose(new Vector3(x + (rand() - 0.5) * 0.2, i * 1.9, z + (rand() - 0.5) * 0.2), new Quaternion().setFromEuler(e), new Vector3(1, 1, 1)))
    }
    spots.push({ x, y: h * 1.9, z })
  }
  // North and south rows, west column (leaving room to walk around the zone).
  for (let x = x0 + 2; x < x1 - 3; x += 2.3) {
    stack(x, z0 + 2, 1 + Math.floor(rand() * 3))
    stack(x, z1 - 2, 1 + Math.floor(rand() * 3))
  }
  for (let z = z0 + 4.5; z < z1 - 4; z += 2.3) stack(x0 + 2, z, 1 + Math.floor(rand() * 3))
  solidBox((x1 - 3 - (x0 + 1)) / 2, 2.8, 1.1, (x0 + 1 + x1 - 3) / 2, 2.8, z0 + 2)
  solidBox((x1 - 3 - (x0 + 1)) / 2, 2.8, 1.1, (x0 + 1 + x1 - 3) / 2, 2.8, z1 - 2)
  solidBox(1.1, 2.8, (z1 - 4 - (z0 + 3.5)) / 2, x0 + 2, 2.8, (z0 + 3.5 + z1 - 4) / 2)
  const blocks = new InstancedMesh(blockGeo, blockMaterial(), mats4.length)
  mats4.forEach((m, i) => blocks.setMatrixAt(i, m))
  blocks.castShadow = true
  blocks.receiveShadow = true
  root.add(blocks)

  // Vehicles parked in the yard and a floodlight mast.
  const truck = makeMixerTruck('#1aa3b8')
  truck.position.set(x0 + 6, 0, P.z)
  root.add(truck)
  solidBox(1.4, 2, 4.6, x0 + 6, 2, P.z - 0.6)
  const fork = makeForklift(0.9, blockMaterial())
  fork.position.set(x1 + 4, 0, z1 - 1)
  fork.rotation.y = -Math.PI * 0.6
  statics.add(fork)
  solidBox(1, 1.5, 1.4, x1 + 4, 1.5, z1 - 1, -Math.PI * 0.6)
  const mast = new Group()
  box(mast, 0.3, 9, 0.3, mats.dark(), 0, 0, 0)
  box(mast, 2.4, 0.9, 0.5, mats.dark(), 0, 9, 0)
  const bulbs = std('#fff6d8', { emissive: '#fff1c0', emissiveIntensity: 0.3 })
  box(mast, 2.2, 0.7, 0.06, bulbs, 0, 9.1, 0.27, false)
  mast.position.set(x0 + 1, 0, z1 - 1)
  mast.rotation.y = Math.PI * 0.75
  statics.add(mast)

  root.add(bake(statics, true))
  const sign = label('BLOCKS', 2.6, { color: '#3fb8ff', outline: '#08224a', outlineWidth: 20 })
  sign.position.set(P.x, 9.5, P.z)
  root.add(sign)
  scene.add(root)

  const inZone = (x, z) => Math.abs(x - zx) < zw / 2 && Math.abs(z - P.z) < zd / 2
  return {
    inZone,
    spots,
    bulbs,
    zone: { x: zx, z: P.z, w: zw, d: zd },
    update(dt, elapsed) {
      truck.userData.drum.rotateY(dt * 1.4)
      lineMat.opacity = 1
      sign.position.y = 9.5 + Math.sin(elapsed * 1.6) * 0.25
    },
  }
}
