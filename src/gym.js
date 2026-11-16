import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, Vector3 } from 'three'
import { GYM, LAYOUT } from './config.js'
import { bake } from './bake.js'
import { box, cyl, flatText, label, neon, put, solidBox, std } from './propkit.js'
import { mats } from './props.js'
import { toTexture } from './textures.js'

// The gym: a walkway running east from the plaza with a neon pad every few metres on both
// sides, from the FREE pad up to the 500x LEGEND pad. Every pad has a bench press (Strength)
// and a treadmill (Speed). A pad unlocks when you have finished enough buildings, the two
// premium pads with cash. Use a machine (E / tap) and it repeats on its own; tapping makes
// you rep faster, moving gets you off.

function beltTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#26282d'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#35383f'
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 3)
  return c
}

function makeBench(tierColor, plateMat) {
  const g = new Group()
  const pad = std('#202227', { roughness: 0.6 })
  const frame = mats.dark()
  box(g, 0.75, 0.22, 2.3, pad, 0, 0.42, 0) // bench pad (feet end at +Z)
  for (const z of [-0.9, 0.9]) box(g, 0.5, 0.42, 0.12, frame, 0, 0, z)
  // Uprights at the head end (-Z) holding the bar.
  for (const x of [-0.55, 0.55]) box(g, 0.1, 1.45, 0.1, frame, x, 0, -1.0)
  const bar = new Group()
  const rod = put(bar, new CylinderGeometry(0.05, 0.05, 2.6, 8), mats.chrome(), 0, 0, 0)
  rod.rotation.z = Math.PI / 2
  for (const x of [-1.05, -0.9, 0.9, 1.05]) {
    const plate = put(bar, new CylinderGeometry(0.38, 0.38, 0.1, 18), plateMat, x, 0, 0)
    plate.rotation.z = Math.PI / 2
  }
  bar.position.set(0, 1.42, -1.0)
  g.add(bar)
  g.userData.bar = bar
  void tierColor
  return g
}

function makeTreadmill(screenMat, beltMat) {
  const g = new Group()
  const body = mats.dark()
  box(g, 1.2, 0.28, 2.6, body, 0, 0, 0)
  const belt = new Mesh(new PlaneGeometry(0.9, 2.3), beltMat)
  belt.rotation.x = -Math.PI / 2
  belt.position.set(0, 0.29, 0.1)
  g.add(belt)
  // Console at the front (-Z) with handrails.
  for (const x of [-0.58, 0.58]) {
    const post = box(g, 0.08, 1.35, 0.08, body, x, 0.28, -1.15)
    post.rotation.x = -0.12
    box(g, 0.07, 0.07, 0.9, mats.chrome(), x, 1.25, -0.75)
  }
  box(g, 1.2, 0.5, 0.25, body, 0, 1.4, -1.25)
  const screen = new Mesh(new PlaneGeometry(0.7, 0.32), screenMat)
  screen.position.set(0, 1.66, -1.11)
  screen.rotation.x = -0.4
  g.add(screen)
  return g
}

export function createGym(scene) {
  const G = LAYOUT.gym
  const root = new Group()
  root.name = 'gym'
  const statics = new Group()
  const n = GYM.tiers.length
  const cols = Math.ceil(n / 2)
  const xEnd = G.x0 + (cols - 1) * G.spacing + G.pad / 2 + 2
  // Walkway: dark rubber with yellow edge lines.
  box(statics, xEnd - (G.x0 - G.pad / 2 - 6), 0.08, 9, std('#3a3d44', { roughness: 0.9 }), (xEnd + G.x0 - G.pad / 2 - 6) / 2, 0, G.z)
  for (const dz of [-4.4, 4.4]) box(statics, xEnd - (G.x0 - G.pad / 2 - 6), 0.09, 0.25, std('#ffc21a'), (xEnd + G.x0 - G.pad / 2 - 6) / 2, 0, G.z + dz)
  const gymWord = flatText('GYM', 4.5, { color: '#ffb21a', outline: '#3a1600', outlineWidth: 22 })
  gymWord.rotation.x = -Math.PI / 2
  gymWord.position.set(G.x0 - G.pad / 2 - 2, 0.12, G.z)
  root.add(gymWord)
  const sign = label('GYM', 3, { color: '#ffb21a', outline: '#3a1600', outlineWidth: 22 })
  sign.position.set(G.x0 - G.pad / 2 - 2, 9, G.z)
  root.add(sign)

  const beltTex = toTexture(beltTexture(), { srgb: true })
  beltTex.wrapS = beltTex.wrapT = RepeatWrapping
  beltTex.repeat.set(1, 4)
  const stations = []
  const pads = []
  GYM.tiers.forEach((tier, i) => {
    const col = Math.floor(i / 2)
    const north = i % 2 === 0
    const px = G.x0 + col * G.spacing
    const pz = G.z + (north ? -G.offset : G.offset)
    const face = north ? 1 : -1 // machines face the walkway (+Z for the north row)
    const S = G.pad
    const premium = tier.price != null
    // Platform + neon rim + rubber mat.
    box(statics, S, 0.3, S, std('#5d626b', { roughness: 0.8 }), px, 0, pz)
    box(statics, S - 1.2, 0.04, S - 1.2, std('#23252b', { roughness: 0.95 }), px, 0.3, pz)
    const rim = neon(tier.color, premium ? 3.2 : 2.4)
    for (const [dx, dz, w, d] of [[0, -S / 2, S, 0.25], [0, S / 2, S, 0.25], [-S / 2, 0, 0.25, S], [S / 2, 0, 0.25, S]]) {
      const m = new Mesh(new BoxGeometry(w, 0.12, d), rim)
      m.position.set(px + dx, 0.32, pz + dz)
      root.add(m)
    }
    const inner = neon(tier.color, 1.6)
    for (const [dx, dz, w, d] of [[0, -S / 2 + 1, S - 2, 0.12], [0, S / 2 - 1, S - 2, 0.12], [-S / 2 + 1, 0, 0.12, S - 2], [S / 2 - 1, 0, 0.12, S - 2]]) {
      const m = new Mesh(new BoxGeometry(w, 0.05, d), inner)
      m.position.set(px + dx, 0.34, pz + dz)
      root.add(m)
    }
    if (premium) {
      // Golden posts and rope round the premium pads.
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        cyl(statics, 0.18, 1.6, std('#ffcf3a', { metalness: 0.7, roughness: 0.25 }), px + (dx * (S - 0.6)) / 2, 0.3, pz + (dz * (S - 0.6)) / 2, 10)
      }
    }
    solidBox(S / 2, 0.15, S / 2, px, 0.15, pz)
    const plateMat = std(tier.color, { roughness: 0.35, metalness: 0.3, emissive: tier.color, emissiveIntensity: premium ? 0.35 : 0.08 })
    const bench = makeBench(tier.color, plateMat)
    const bx = px - 2.4
    bench.position.set(bx, 0.3, pz)
    bench.rotation.y = face > 0 ? 0 : Math.PI
    root.add(bench)
    solidBox(0.45, 0.6, 1.2, bx, 0.6, pz)
    const screenMat = neon(tier.color, 2)
    const beltMat = new MeshStandardMaterial({ map: beltTex.clone(), roughness: 0.9 })
    beltMat.map.needsUpdate = true
    const mill = makeTreadmill(screenMat, beltMat)
    const tx = px + 2.6
    mill.position.set(tx, 0.3, pz)
    mill.rotation.y = face > 0 ? Math.PI : 0
    root.add(mill)
    solidBox(0.65, 0.35, 1.3, tx, 0.45, pz)
    // Labels: multiplier and requirement / price.
    const req = premium ? `$${(tier.price / 1e6).toFixed(1)}M` : tier.need ? `Requirement: ${tier.need} Building${tier.need > 1 ? 's' : ''}` : 'Everyone'
    const lbl = label(tier.label, 1.5, { color: tier.color, outline: '#141414', outlineWidth: 16 })
    lbl.position.set(px, 4.6, pz)
    root.add(lbl)
    const sub = label(req, 0.55, { color: '#ffffff', outline: '#141414', outlineWidth: 10 })
    sub.position.set(px, 3.65, pz)
    root.add(sub)
    // Bench: lie with the head at the bar (-Z of the bench, turned by `face`).
    stations.push({
      id: `b${i}`,
      kind: 'strength',
      tier: i,
      x: bx,
      z: pz + face * 2.2,
      y: 1.2,
      // Lying on the bench, feet toward the walkway, shoulders under the bar (1.35 m from the
      // feet); `y` puts the back on the pad (feet origin on the body's centre line).
      lie: { x: bx, y: 1.17, z: pz + face * 0.35, facing: face > 0 ? 0 : Math.PI },
      exit: { x: bx, z: pz + face * 3.2 },
      bar: bench.userData.bar,
      barRest: 1.42, // on the hooks (bench-local y)
      barLow: 1.1, // on the chest
      barHigh: 1.52, // arms locked out
    })
    stations.push({
      id: `t${i}`,
      kind: 'speed',
      tier: i,
      x: tx,
      z: pz + face * 2.2,
      y: 1.2,
      // On the belt, facing the console (which faces the walkway).
      stand: { x: tx, y: 0.3 + 0.32, z: pz - face * 0.1, facing: face > 0 ? 0 : Math.PI },
      exit: { x: tx, z: pz + face * 3.4 },
      belt: beltMat.map,
      screen: screenMat,
    })
    pads.push({ tier, x: px, z: pz, label: sub })
  })
  root.add(bake(statics, true))
  scene.add(root)

  return {
    stations,
    pads,
    tierUnlocked(i, buildings, owned) {
      const t = GYM.tiers[i]
      if (t.price != null) return !!owned[i]
      return buildings >= t.need
    },
    update(dt, elapsed, active) {
      for (const s of stations) {
        if (s.kind === 'speed') s.belt.offset.y += active === s ? dt * 3.2 : 0
      }
    },
  }
}

export { Vector3 }
