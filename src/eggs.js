import { CanvasTexture, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2 } from 'three'
import { EGGS, LAYOUT } from './config.js'
import { bake } from './bake.js'
import { RAPIER, addFixed } from './physics.js'
import { box, cyl, flatText, label, neon, put, solidBox, solidPole, std } from './propkit.js'
import { mats } from './props.js'
import { paintCorrugated, paintHazard, toTexture } from './textures.js'
import { short } from './stats.js'

// The Egg Hall: a covered hall south of the road (entrance on the north side) with a green
// carpet down the middle, an egg on a hazard-striped pedestal either side (EGGS: side/row),
// and the Pet Merge machine (glass domes on a hazard base) at the far end under a blue
// screen. A blue corrugated gable roof on yellow steel; its colliders keep the chase camera
// under it. Returns { eggs: [{ def, x, z, top, front }], merge: { x, z }, update }.

const HALL = { w: 28, l: 36, eave: 9.2, ridge: 11.8 }
const EGG = { r: 1.9, h: 4.6, base: 1.3 }

// --- Egg shells ----------------------------------------------------------------------------
function canvas(w, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
// Painted with u around the egg, v up it (canvas top = the egg's top).
function paintEgg(id) {
  const c = canvas(256)
  const g = c.getContext('2d')
  const S = 256
  if (id === 'hazard') {
    g.fillStyle = '#ffd21a'
    g.fillRect(0, 0, S, S)
    const band = canvas(S, 48)
    band.getContext('2d').drawImage(paintHazard(128, '#ffd21a', '#1d1d22'), 0, 0, S, 96)
    g.drawImage(band, 0, S * 0.5 - 24)
    g.fillStyle = '#1d1d22'
    g.fillRect(0, S * 0.5 - 28, S, 4)
    g.fillRect(0, S * 0.5 + 24, S, 4)
    g.fillStyle = '#8a9099'
    for (let i = 0; i < 8; i++) {
      g.beginPath()
      g.arc((i + 0.5) * (S / 8), S * 0.28 + (i % 2) * 8, 5, 0, Math.PI * 2)
      g.arc((i + 0.2) * (S / 8), S * 0.74, 5, 0, Math.PI * 2)
      g.fill()
    }
  } else if (id === 'brick') {
    g.fillStyle = '#c8553a'
    g.fillRect(0, 0, S, S)
    const rows = 10
    const h = S / rows
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 0 : S / 16
      for (let x = -S / 8 + off; x < S; x += S / 8) {
        g.fillStyle = r % 3 === 0 ? '#b8442a' : r % 3 === 1 ? '#d0603f' : '#c24d33'
        g.fillRect(x + 2, r * h + 2, S / 8 - 4, h - 4)
      }
    }
    g.strokeStyle = '#7dff8a'
    g.lineWidth = 3
    for (let r = 0; r <= rows; r++) {
      g.beginPath()
      g.moveTo(0, r * h)
      g.lineTo(S, r * h)
      g.stroke()
    }
  } else if (id === 'steel') {
    const grd = g.createLinearGradient(0, 0, S, 0)
    grd.addColorStop(0, '#8f969f')
    grd.addColorStop(0.5, '#c4cad2')
    grd.addColorStop(1, '#8f969f')
    g.fillStyle = grd
    g.fillRect(0, 0, S, S)
    g.strokeStyle = '#5d646e'
    g.lineWidth = 4
    for (const y of [S * 0.25, S * 0.75]) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(S, y)
      g.stroke()
    }
    for (let i = 0; i < 6; i++) {
      g.beginPath()
      g.moveTo((i * S) / 6, 0)
      g.lineTo((i * S) / 6, S)
      g.stroke()
    }
    g.fillStyle = '#e6ebf0'
    for (let i = 0; i < 12; i++) {
      g.beginPath()
      g.arc((i + 0.5) * (S / 12), S * 0.3, 3, 0, Math.PI * 2)
      g.arc((i + 0.5) * (S / 12), S * 0.7, 3, 0, Math.PI * 2)
      g.fill()
    }
  } else {
    const grd = g.createLinearGradient(0, 0, 0, S)
    grd.addColorStop(0, '#ffe680')
    grd.addColorStop(1, '#f0a812')
    g.fillStyle = grd
    g.fillRect(0, 0, S, S)
    g.strokeStyle = '#d68a00'
    g.lineWidth = 6
    g.lineCap = 'round'
    for (let i = 0; i < 14; i++) {
      const x = (i * 37) % S
      const y = 20 + ((i * 53) % (S - 40))
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + 34, y)
      g.stroke()
    }
  }
  return c
}

function eggGeometry() {
  const pts = []
  const N = 28
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI
    // Wider low, pointier on top.
    const r = EGG.r * Math.sin(t) * (1 + 0.1 * Math.cos(t))
    pts.push(new Vector2(Math.max(0.001, r), (EGG.h / 2) * (1 - Math.cos(t))))
  }
  return new LatheGeometry(pts, 40)
}

function makeEgg(def) {
  const tex = new CanvasTexture(paintEgg(def.id))
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const metal = def.id === 'golden' ? { metalness: 0.75, roughness: 0.25 } : def.id === 'steel' ? { metalness: 0.45, roughness: 0.35 } : { roughness: 0.5 }
  const g = new Group()
  const shell = new Mesh(eggGeometry(), new MeshStandardMaterial({ map: tex, ...metal }))
  shell.castShadow = true
  g.add(shell)
  if (def.id === 'steel') {
    const band = new Mesh(new TorusGeometry(EGG.r * 1.03, 0.09, 8, 48), neon('#3bd9ff', 2.8))
    band.rotation.x = Math.PI / 2
    band.position.y = EGG.h * 0.47
    g.add(band)
  }
  return g
}

// --- Pet Merge machine ------------------------------------------------------------------------
function glassMat() {
  return new MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false, side: DoubleSide })
}
// x / z in hall space (statics) and C = the hall origin for the loose meshes.
function dome(root, statics, C, x, y, z, r, ringColor) {
  cyl(statics, r + 0.35, 0.5, std(ringColor === '#b45cff' ? '#3a3f48' : '#ffc21a', { roughness: 0.4 }), x, y, z, 24)
  const ring = new Mesh(new TorusGeometry(r * 0.75, 0.12, 8, 40), neon(ringColor, 2.6))
  ring.rotation.x = Math.PI / 2
  ring.position.set(C.x + x, y + 0.56, C.z + z)
  root.add(ring)
  const glass = new Mesh(new SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glassMat())
  glass.position.set(C.x + x, y + 0.5, C.z + z)
  glass.renderOrder = 2
  root.add(glass)
  return ring
}

export function createEggHall(scene) {
  const C = LAYOUT.eggs
  const root = new Group()
  root.name = 'eggHall'
  const statics = new Group()
  const W = HALL.w / 2
  const L = HALL.l / 2
  const yellow = mats.yellow()
  const concrete = std('#9aa1a8', { roughness: 0.85 })
  const wallGreen = std('#6f8f78', { roughness: 0.8 })
  const hazard = mats.hazard()
  const lime = neon('#3bff6a', 2.4)

  // Floor slab, the green carpet and its white edges.
  box(statics, HALL.w, 0.12, HALL.l, concrete, 0, 0, 0)
  solidBox(W, 0.06, L, C.x, 0.06, C.z)
  box(statics, 8, 0.04, HALL.l - 4, std('#1f7a3c', { roughness: 0.95 }), 0, 0.12, -2)
  for (const x of [-4.1, 4.1]) box(statics, 0.35, 0.05, HALL.l - 4, mats.white(), x, 0.12, -2)

  // Low side walls with a glowing green top, the back wall, steel columns.
  for (const s of [-1, 1]) {
    box(statics, 0.8, 1.6, HALL.l, wallGreen, s * (W - 0.4), 0, 0)
    const top = new Mesh(new PlaneGeometry(0.8, HALL.l), lime)
    top.rotation.x = -Math.PI / 2
    top.position.set(C.x + s * (W - 0.4), 1.62, C.z)
    root.add(top)
    solidBox(0.4, 0.8, L, C.x + s * (W - 0.4), 0.8, C.z)
  }
  box(statics, HALL.w, 7, 0.8, wallGreen, 0, 0, L - 0.4)
  solidBox(W, 3.5, 0.4, C.x, 3.5, C.z + L - 0.4)
  // The big blue screen on the back wall with a skyscraper sketch.
  const screen = new Mesh(new PlaneGeometry(12, 4.4), neon('#2f6fd8', 1.5))
  screen.position.set(C.x, 4.2, C.z + L - 0.85)
  screen.rotation.y = Math.PI
  root.add(screen)
  const sketch = flatText('PET MERGE', 2, { color: '#e2ccff', outline: '#2a0e5a', outlineWidth: 16 })
  sketch.position.set(C.x, 4.4, C.z + L - 0.9)
  sketch.rotation.y = Math.PI
  root.add(sketch)
  const cols = [-L + 0.3, -6, 6, L - 0.3]
  for (const z of cols) {
    for (const s of [-1, 1]) {
      box(statics, 0.6, HALL.eave, 0.6, yellow, s * (W - 0.4), 0, z)
      solidBox(0.3, HALL.eave / 2, 0.3, C.x + s * (W - 0.4), HALL.eave / 2, C.z + z)
    }
    // Truss: tie beam, rafters and a king post.
    box(statics, HALL.w, 0.35, 0.35, yellow, 0, HALL.eave - 0.35, z)
    const rise = HALL.ridge - HALL.eave
    const len = Math.hypot(W, rise)
    for (const s of [-1, 1]) {
      const r = box(statics, len, 0.35, 0.35, yellow, (s * W) / 2, 0, z)
      r.position.y = HALL.eave + rise / 2
      r.rotation.z = -s * Math.atan2(rise, W)
    }
    box(statics, 0.3, rise, 0.3, yellow, 0, HALL.eave, z)
  }
  // Ridge + eave purlins.
  for (const [x, y] of [[0, HALL.ridge], [-W + 0.4, HALL.eave], [W - 0.4, HALL.eave]]) box(statics, 0.35, 0.35, HALL.l, yellow, x, y - 0.1, 0)
  // Roof: two corrugated slopes. Colliders too, so the chase camera stays under them.
  const roofTex = toTexture(paintCorrugated('#2f6fd6'), { srgb: true })
  roofTex.repeat.set(1, 10)
  const roofMat = new MeshStandardMaterial({ map: roofTex, roughness: 0.6, metalness: 0.3, side: DoubleSide })
  const rise = HALL.ridge - HALL.eave
  const slope = Math.hypot(W + 1, rise)
  const ang = Math.atan2(rise, W + 1)
  for (const s of [-1, 1]) {
    // Laid flat (X), then tilted about the hall's long axis (Z) so it drops toward its eave.
    const m = put(root, new PlaneGeometry(slope, HALL.l + 2), roofMat, C.x + (s * (W + 1)) / 2, HALL.eave + rise / 2 + 0.25, C.z, false)
    m.rotation.set(-Math.PI / 2, 0, -s * ang, 'ZYX')
    m.receiveShadow = true
    const q = { x: 0, y: 0, z: Math.sin((-s * ang) / 2), w: Math.cos((-s * ang) / 2) }
    addFixed(RAPIER.ColliderDesc.cuboid(slope / 2, 0.1, L + 1), { x: C.x + (s * (W + 1)) / 2, y: HALL.eave + rise / 2 + 0.25, z: C.z }, q)
  }
  // Gable signs: EGGS over the entrance.
  const sign = label('EGGS', 2.6, { color: '#3bff6a', outline: '#0a3a14', outlineWidth: 20 })
  sign.position.set(C.x, HALL.ridge + 2.2, C.z - L)
  root.add(sign)
  box(statics, 9, 0.5, 0.5, yellow, 0, HALL.eave - 1.2, -L + 0.3)

  // Pedestals + eggs.
  const eggs = EGGS.map((def) => {
    const px = def.side * 9.2
    const pz = def.row === 0 ? -8.5 : 2
    const pw = 8
    const pd = 9
    box(statics, pw, EGG.base, pd, concrete, px, 0, pz)
    // Hazard bands on the faces toward the carpet and the entrance; green neon lip on top.
    const inner = px - def.side * (pw / 2 + 0.02)
    box(statics, 0.06, EGG.base - 0.35, pd, hazard, inner, 0.15, pz)
    box(statics, pw, EGG.base - 0.35, 0.06, hazard, px, 0.15, pz - pd / 2 - 0.02)
    for (const [x, z, w, d] of [[inner, pz, 0.2, pd], [px, pz - pd / 2, pw, 0.2]]) {
      const lip = new Mesh(new PlaneGeometry(w, d), lime)
      lip.rotation.x = -Math.PI / 2
      lip.position.set(C.x + x, EGG.base + 0.02, C.z + z)
      root.add(lip)
    }
    solidBox(pw / 2, EGG.base / 2, pd / 2, C.x + px, EGG.base / 2, C.z + pz)
    const egg = makeEgg(def)
    egg.position.set(C.x + px, EGG.base, C.z + pz)
    root.add(egg)
    solidPole(EGG.r, EGG.h, C.x + px, C.z + pz, EGG.base)
    const name = label(def.name.toUpperCase(), 1.2, { color: def.color, outline: '#141414', outlineWidth: 16 })
    name.position.set(C.x + px, EGG.base + EGG.h + 1.6, C.z + pz)
    root.add(name)
    const price = label(`$${short(def.price)}`, 0.8, { color: '#7dff6b', outline: '#0b2a10', outlineWidth: 14 })
    price.position.set(C.x + px, EGG.base + EGG.h + 0.6, C.z + pz)
    root.add(price)
    // You stand on the carpet beside the pedestal to use it.
    return { def, mesh: egg, x: C.x + px, z: C.z + pz, top: EGG.base + EGG.h, front: { x: C.x + def.side * 2.5, z: C.z + pz } }
  })

  // Pet Merge machine at the far end.
  const mz = L - 5.2
  box(statics, 13, 0.9, 4.6, concrete, 0, 0, mz)
  box(statics, 13, 0.6, 0.06, hazard, 0, 0.15, mz - 2.32)
  solidBox(6.5, 0.45, 2.3, C.x, 0.45, C.z + mz)
  const rings = [dome(root, statics, C, 0, 0.9, mz, 1.9, '#b45cff'), dome(root, statics, C, -4.4, 0.9, mz, 1.3, '#ffd23a'), dome(root, statics, C, 4.4, 0.9, mz, 1.3, '#ffd23a')]
  // Console with a screen and a red + green button.
  box(statics, 1.5, 1.5, 0.9, std('#ffc21a', { roughness: 0.45 }), -2.4, 0.9, mz - 1.4)
  const scr = new Mesh(new PlaneGeometry(1.1, 0.7), neon('#3bd9ff', 1.6))
  scr.position.set(C.x - 2.4, 2.2, C.z + mz - 1.86)
  scr.rotation.y = Math.PI
  root.add(scr)
  for (const [x, c] of [[-2.75, '#ff3d3d'], [-2.05, '#3bff6a']]) {
    const b = new Mesh(new CylinderGeometry(0.17, 0.17, 0.12, 14), neon(c, 2.2))
    b.position.set(C.x + x, 2.46, C.z + mz - 1.4)
    root.add(b)
  }
  solidBox(0.75, 1.2, 0.45, C.x - 2.4, 1.2, C.z + mz - 1.4)
  const plate = flatText('PET MERGE', 0.6, { color: '#c9a8ff', outline: '#2a0e5a', outlineWidth: 12 })
  plate.position.set(C.x, 0.48, C.z + mz - 2.36)
  plate.rotation.y = Math.PI
  root.add(plate)

  // Statics were laid out in hall space: the merged meshes move to the hall origin.
  const baked = bake(statics, true)
  baked.position.set(C.x, 0, C.z)
  root.add(baked)
  scene.add(root)

  return {
    eggs,
    merge: { x: C.x, z: C.z + mz - 3.6 },
    update(dt, elapsed) {
      eggs.forEach((e, i) => {
        e.mesh.rotation.y = elapsed * 0.35 + i
        e.mesh.position.y = EGG.base + 0.05 + Math.sin(elapsed * 1.6 + i) * 0.08
        if (e.wobbleT > 0) e.wobbleT = Math.max(0, e.wobbleT - dt)
        e.mesh.rotation.z = e.wobbleT > 0 ? Math.sin(e.wobbleT * 40) * 0.12 * e.wobbleT : 0
      })
      rings.forEach((r, i) => (r.rotation.z = elapsed * (i ? -1.2 : 0.8)))
    },
    // A quick shake when it hatches.
    wobble(id) {
      const e = eggs.find((q) => q.def.id === id)
      if (e) e.wobbleT = 0.8
    },
  }
}
