import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry } from 'three'
import { PET } from './config.js'
import { bake } from './bake.js'
import { neon, put, setNeonColor, std } from './propkit.js'
import { petDef } from './stats.js'

// Pets in the world: a blocky little model per pet `kind` (pets.js builds it from the
// PETS colours; Golden pets are gold metal, Rainbow pets glow through the colours) and the
// followers that trot after you: one per equipped pet, fanned out behind you, hopping while
// you move and bobbing while you stand.

const matCache = new Map()
const mat = (key, make) => {
  if (!matCache.has(key)) matCache.set(key, make())
  return matCache.get(key)
}
const paint = (c) => mat(`p${c}`, () => std(c, { roughness: 0.55 }))
const gold = () => mat('gold', () => std('#ffcf3a', { metalness: 0.85, roughness: 0.22 }))
const goldLight = () => mat('goldL', () => std('#fff1a8', { metalness: 0.6, roughness: 0.3 }))
const black = () => mat('black', () => std('#16161c', { roughness: 0.4 }))
const hatMat = () => mat('hat', () => std('#ffd21a', { roughness: 0.35 }))
const rainbowMats = [] // neon materials whose colour cycles

const bx = (g, w, h, d, m, x, y, z) => put(g, new BoxGeometry(w, h, d), m, x, y, z)

// A pet model about 1.1 m tall, front +Z, feet at y 0.
export function makePetMesh(def, tier = 0) {
  const g = new Group()
  let c0
  let c1
  let c2
  if (tier === 1) {
    c0 = gold()
    c1 = goldLight()
    c2 = gold()
  } else if (tier === 2) {
    c0 = neon('#ff4d6d', 1.6)
    rainbowMats.push(c0)
    c1 = paint('#ffffff')
    c2 = paint(def.c[2])
  } else {
    c0 = paint(def.c[0])
    c1 = paint(def.c[1])
    c2 = paint(def.c[2])
  }
  const k = def.kind
  const robot = k === 'robot'
  const bird = k === 'bird'
  // Body, legs, head.
  bx(g, 0.62, 0.5, 0.72, c0, 0, 0.5, 0)
  bx(g, 0.42, 0.3, 0.06, c1, 0, 0.47, 0.37)
  if (bird) {
    for (const x of [-0.15, 0.15]) bx(g, 0.08, 0.3, 0.08, c2, x, 0.15, 0)
  } else {
    for (const [x, z] of [[-0.2, 0.22], [0.2, 0.22], [-0.2, -0.22], [0.2, -0.22]]) bx(g, 0.17, 0.3, 0.17, robot ? black() : c0, x, 0.15, z)
  }
  const head = new Group()
  head.position.set(0, 1.0, 0.18)
  g.add(head)
  bx(head, 0.72, 0.58, 0.58, c0, 0, 0, 0)
  if (robot) {
    for (const x of [-0.17, 0.17]) bx(head, 0.18, 0.1, 0.04, neon(def.c[2], 2.6), x, 0.05, 0.3)
    bx(head, 0.3, 0.08, 0.04, c1, 0, -0.14, 0.3)
    put(head, new CylinderGeometry(0.03, 0.03, 0.3, 6), black(), 0, 0.42, 0)
    put(head, new SphereGeometry(0.08, 10, 8), neon(def.c[2], 2.6), 0, 0.6, 0)
  } else {
    for (const x of [-0.17, 0.17]) bx(head, 0.1, 0.14, 0.04, black(), x, 0.06, 0.3)
    if (bird) {
      const beak = put(head, new ConeGeometry(0.1, 0.24, 4), c2, 0, -0.08, 0.38)
      beak.rotation.x = Math.PI / 2
    } else {
      bx(head, 0.36, 0.2, 0.1, c1, 0, -0.13, 0.32)
      bx(head, 0.1, 0.06, 0.04, black(), 0, -0.06, 0.38)
    }
  }
  // Ears, horns, wings, tails.
  const ear = (geo, m, x, y, z, rz = 0, rx = 0) => {
    const e = put(head, geo, m, x, y, z)
    e.rotation.set(rx, 0, rz)
  }
  if (k === 'cat') for (const s of [-1, 1]) ear(new ConeGeometry(0.13, 0.26, 4), c0, s * 0.23, 0.38, 0, -s * 0.2)
  if (k === 'fox') for (const s of [-1, 1]) ear(new ConeGeometry(0.15, 0.36, 4), c0, s * 0.24, 0.42, 0, -s * 0.25)
  if (k === 'bunny') for (const s of [-1, 1]) bx(head, 0.12, 0.5, 0.08, c0, s * 0.15, 0.5, -0.05)
  if (k === 'bear') for (const s of [-1, 1]) put(head, new CylinderGeometry(0.12, 0.12, 0.08, 10), c0, s * 0.27, 0.32, 0).rotation.x = Math.PI / 2
  if (k === 'mouse') for (const s of [-1, 1]) put(head, new CylinderGeometry(0.2, 0.2, 0.05, 12), c2, s * 0.34, 0.3, -0.05).rotation.x = Math.PI / 2
  if (k === 'dog') for (const s of [-1, 1]) bx(head, 0.1, 0.34, 0.22, c2, s * 0.4, -0.04, -0.02)
  if (k === 'dragon') {
    for (const s of [-1, 1]) {
      ear(new ConeGeometry(0.07, 0.3, 5), c1, s * 0.2, 0.42, -0.08, -s * 0.3)
      const wing = bx(g, 0.62, 0.05, 0.4, c2, s * 0.6, 0.75, -0.1)
      wing.rotation.z = s * 0.45
    }
  }
  if (bird) {
    for (const s of [-1, 1]) {
      const wing = bx(g, 0.1, 0.34, 0.5, c0, s * 0.36, 0.45, -0.02)
      wing.rotation.z = -s * 0.2
    }
    bx(head, 0.08, 0.2, 0.2, c2, 0, 0.38, 0)
  }
  // Tails.
  if (k === 'fox' || k === 'dragon') {
    const tail = bx(g, 0.2, 0.2, 0.55, k === 'fox' ? c0 : c2, 0, 0.55, -0.55)
    tail.rotation.x = -0.6
    if (k === 'fox') bx(g, 0.2, 0.2, 0.16, c1, 0, 0.84, -0.78)
  } else if (k === 'cat' || k === 'dog' || k === 'mouse') {
    const tail = bx(g, 0.08, 0.08, 0.45, k === 'mouse' ? c2 : c0, 0, 0.62, -0.45)
    tail.rotation.x = -0.7
  } else if (k === 'bunny' || k === 'bear') {
    put(g, new SphereGeometry(0.12, 8, 6), c1, 0, 0.55, -0.38)
  }
  if (def.hat) {
    const dome = put(head, new SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(), 0, 0.29, 0)
    dome.scale.set(1.05, 0.75, 1)
    put(head, new CylinderGeometry(0.44, 0.44, 0.05, 16), hatMat(), 0, 0.29, 0.04)
  }
  // Rainbow + robot bits stay separate (they glow / change colour); everything else is merged.
  const out = bake(g, true)
  return out
}

// Followers: sync(list of equipped pets) rebuilds what changed; update() moves them.
export function createPetFollowers(scene) {
  const root = new Group()
  root.name = 'pets'
  scene.add(root)
  let follow = [] // { key, mesh, x, y, z, yaw, phase }
  const key = (p) => `${p.uid}|${p.id}|${p.tier}`

  function sync(pets) {
    const want = pets.map(key)
    const keep = []
    for (const f of follow) {
      if (want.includes(f.key)) keep.push(f)
      else root.remove(f.mesh)
    }
    follow = pets.map((p) => {
      const old = keep.find((f) => f.key === key(p))
      if (old) return old
      const def = petDef(p.id)
      const mesh = makePetMesh(def, p.tier)
      root.add(mesh)
      return { key: key(p), mesh, x: NaN, y: 0, z: 0, yaw: 0, phase: Math.random() * 6 }
    })
  }

  // Slots fanned out behind the player: (side, back) in metres.
  const SLOTS = [[0, -2.4], [-1.9, -1.7], [1.9, -1.7], [-1.3, -3.6], [1.3, -3.6]]
  return {
    sync,
    get count() {
      return follow.length
    },
    update(dt, elapsed, pos, facing, moving, visible = true) {
      root.visible = visible
      const s = Math.sin(facing)
      const c = Math.cos(facing)
      follow.forEach((f, i) => {
        const [side, back] = SLOTS[i % SLOTS.length]
        // Player-local (side = +X right of facing, back along -forward) -> world.
        const tx = pos.x + back * s - side * c
        const tz = pos.z + back * c + side * s
        if (Number.isNaN(f.x) || Math.hypot(tx - f.x, tz - f.z) > 30 || Math.abs(pos.y - f.y) > 6) {
          f.x = tx
          f.z = tz
          f.y = pos.y
        }
        const k = 1 - Math.exp(-dt * 6)
        const dx = tx - f.x
        const dz = tz - f.z
        f.x += dx * k
        f.z += dz * k
        f.y += (pos.y - f.y) * (1 - Math.exp(-dt * 10))
        const speed = Math.hypot(dx, dz)
        const want = speed > 0.4 ? Math.atan2(dx, dz) : facing
        let d = want - f.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        f.yaw += d * (1 - Math.exp(-dt * 8))
        f.phase += dt * (moving || speed > 0.4 ? 11 : 2.4)
        const hop = moving || speed > 0.4 ? Math.abs(Math.sin(f.phase)) * 0.45 : 0.12 + Math.sin(f.phase) * 0.12
        f.mesh.position.set(f.x, f.y + hop, f.z)
        f.mesh.rotation.y = f.yaw
      })
      if (rainbowMats.length) {
        const h = (elapsed * 0.25) % 1
        for (const m of rainbowMats) setNeonColor(m, `hsl(${Math.round(h * 360)}, 90%, 60%)`)
      }
    },
  }
}

export { PET }
