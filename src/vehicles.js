import { Euler, Group, LatheGeometry, Mesh, Quaternion, TorusGeometry, Vector2, Vector3 } from 'three'
import { boxGeo } from './propkit.js'
import { mats } from './props.js'
import { kit } from './gear.js'

// The transformers' vehicle forms, procedural and in metres (base at y = 0, front +Z): a big rig,
// a cement mixer and a jet. Each one is a sprung `body` (pitch / roll / heave from the driving
// physics in robotPlayer.js) over `wheels` that spin with the ground speed and steer at the
// front; the jet's landing gear folds away in the air. Every top-level piece remembers its rest
// transform so assemble(k) can build the vehicle piece by piece out of the robot (the transform)
// and fold it back in. finalize() merges the static pieces into a few meshes once it is built.

const { once, paint, familyMat, lit, chrome, glass, cylGeo, sphereGeo, mesh, bx, rb, cy, marker, flame, coloured, mergeStatic, SIDES } = kit
const TAU = Math.PI * 2
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

// One wheel as a single vertex-coloured mesh: tyre with tread lugs, rim, hub cap and lug nuts.
function wheelGeo(r, w, side, rim) {
  return coloured(`wheel${r}|${w}|${side}|${rim}`, [
    [cylGeo(r, r, w, 22), '#1d1e22', 0, 0, 0, 0, 0, Math.PI / 2],
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * TAU
      return [boxGeo(w * 0.92, r * 0.13, r * 0.3), '#2c2d32', 0, Math.cos(a) * r, Math.sin(a) * r, a, 0, 0]
    }),
    [cylGeo(r * 0.62, r * 0.62, w + 0.04, 18), rim, 0, 0, 0, 0, 0, Math.PI / 2],
    [cylGeo(r * 0.26, r * 0.32, w + 0.12, 12), '#e3e7ee', 0, 0, 0, 0, 0, Math.PI / 2],
    ...Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * TAU
      return [cylGeo(r * 0.05, r * 0.05, 0.08, 6), '#2b2d33', side * (w / 2 + 0.05), Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, 0, 0, Math.PI / 2]
    }),
  ])
}
function addWheel(V, x, y, z, r, w, { steer = false, rim = '#c9ccd3' } = {}) {
  const pivot = new Group()
  pivot.position.set(x, y, z)
  pivot.userData.live = true
  const spin = new Group()
  pivot.add(spin)
  mesh(spin, wheelGeo(r, w, Math.sign(x) || 1, rim), familyMat('matte'), 0, 0, 0, 0, 0, 0)
  V.wheels.add(pivot)
  V.wheelList.push({ pivot, spin, r, steer })
}
// A light that flashes on when the transform completes (kept out of the merge).
function light(V, w, h, d, color, x, y, z, k = 3) {
  const m = rb(V.body, w, h, d, lit(color, k), x, y, z, 0, 0, 0, Math.min(w, h, d) * 0.3)
  m.userData.live = true
  V.lights.push(m)
  return m
}

// --- Big rig ------------------------------------------------------------------------------------------------
function bigRig(V) {
  const B = V.body
  const body = paint('#7a3dd1', 0.45, 0.28)
  const dark = paint('#24202e', 0.3, 0.5)
  const black = paint('#141418', 0.3, 0.5)
  const white = paint('#f2f4f7', 0.1, 0.35)
  for (const s of SIDES) bx(B, 0.28, 0.45, 9.4, dark, s * 0.55, 0.85, -0.7)
  bx(B, 1.4, 0.18, 9.0, dark, 0, 0.74, -0.7)
  // Hood, fenders, grille, lights, bumper.
  rb(B, 2.3, 1.45, 2.9, body, 0, 1.95, 3.15, 0, 0, 0, 0.35)
  rb(B, 1.7, 0.18, 2.5, body, 0, 2.72, 3.05, 0, 0, 0, 0.08)
  rb(B, 1.85, 1.5, 0.18, chrome(), 0, 1.95, 4.62, 0, 0, 0, 0.06)
  for (let i = 0; i < 8; i++) bx(B, 0.08, 1.2, 0.06, black, -0.7 + i * 0.2, 1.95, 4.72)
  bx(B, 0.5, 0.16, 0.06, lit('#ffd23a', 2.4), 0, 2.62, 4.7)
  rb(B, 2.75, 0.45, 0.4, chrome(), 0, 0.95, 4.72, 0, 0, 0, 0.12)
  for (const s of SIDES) {
    rb(B, 0.55, 0.55, 1.6, body, s * 1.25, 1.42, 3.2, 0, 0, 0, 0.2)
    bx(B, 0.06, 0.12, 1.4, chrome(), s * 1.18, 2.25, 3.15)
    rb(B, 0.5, 0.32, 0.12, mats.lamp(), s * 0.95, 1.6, 4.62, 0, 0, 0, 0.05)
    light(V, 0.4, 0.22, 0.06, '#fff6d8', s * 0.95, 1.6, 4.7)
    light(V, 0.2, 0.14, 0.08, '#ffb020', s * 1.22, 1.6, 4.56, 2.6)
    light(V, 0.22, 0.22, 0.1, '#fff6d8', s * 0.9, 0.95, 4.94, 2.4)
  }
  // Cab: windscreen, windows, doors, mirrors, steps.
  rb(B, 2.6, 2.4, 2.3, body, 0, 2.75, 0.85, 0, 0, 0, 0.3)
  rb(B, 2.2, 1.05, 0.1, glass(), 0, 3.25, 2.02, -0.18, 0, 0, 0.05)
  bx(B, 0.08, 1.05, 0.14, dark, 0, 3.25, 2.04, -0.18)
  for (const s of SIDES) {
    rb(B, 0.08, 0.75, 1.15, glass(), s * 1.31, 3.2, 1.05, 0, 0, 0, 0.03)
    bx(B, 0.04, 1.5, 0.04, black, s * 1.31, 2.4, 0.4)
    bx(B, 0.06, 0.06, 0.3, chrome(), s * 1.33, 2.6, 1.1)
    cy(B, 0.04, 0.04, 0.7, chrome(), s * 1.6, 3.0, 1.95, 0, 0, Math.PI / 2, 6)
    rb(B, 0.16, 0.6, 0.3, black, s * 1.95, 3.0, 1.95, 0, 0, 0, 0.05)
    rb(B, 0.35, 0.12, 0.8, dark, s * 1.35, 1.25, 0.9, 0, 0, 0, 0.04)
    rb(B, 0.35, 0.12, 0.8, dark, s * 1.35, 1.7, 0.9, 0, 0, 0, 0.04)
  }
  // Sleeper, roof fairing, marker lights, air horns, stripes.
  rb(B, 2.6, 2.9, 2.0, body, 0, 2.95, -1.25, 0, 0, 0, 0.3)
  rb(B, 2.5, 0.9, 2.6, body, 0, 4.5, -0.55, -0.14, 0, 0, 0.35)
  for (let i = 0; i < 5; i++) light(V, 0.2, 0.1, 0.1, '#ffb020', -0.8 + i * 0.4, 4.05, 2.0, 2.6)
  for (const s of SIDES) {
    cy(B, 0.08, 0.14, 0.7, chrome(), s * 0.5, 4.3, 1.1, Math.PI / 2, 0, 0, 8)
    bx(B, 0.04, 0.22, 6.0, white, s * 1.31, 2.05, 0.6)
    bx(B, 0.04, 0.1, 6.0, paint('#ff5fd2'), s * 1.31, 1.88, 0.6)
    // Smokestacks (exhaust smoke comes out of the caps), fuel tanks, battery box.
    cy(B, 0.19, 0.19, 3.8, chrome(), s * 1.42, 3.05, -0.25, 0, 0, 0, 12)
    cy(B, 0.22, 0.22, 0.12, black, s * 1.42, 4.98, -0.25, 0, 0, 0, 12)
    marker(B, s * 1.42, 5.1, -0.25, V.exhaust)
    cy(B, 0.45, 0.45, 1.7, chrome(), s * 1.32, 1.05, 1.0, Math.PI / 2, 0, 0, 16)
    for (const k of [-0.55, 0.55]) cy(B, 0.47, 0.47, 0.06, black, s * 1.32, 1.05, 1.0 + k, Math.PI / 2, 0, 0, 16)
    rb(B, 0.5, 0.6, 0.8, dark, s * 1.25, 1.0, -0.45, 0, 0, 0, 0.08)
    // Rear fenders, mud flaps, tail lights.
    rb(B, 0.85, 0.12, 2.6, black, s * 1.3, 1.45, -3.1, 0, 0, 0, 0.05)
    bx(B, 0.7, 0.9, 0.06, black, s * 1.3, 0.8, -4.6)
    light(V, 0.26, 0.16, 0.06, '#ff2a2a', s * 1.0, 1.0, -5.0, 2.8)
    marker(V.wheels, s * 1.3, 0.1, -3.1, V.rear)
  }
  cy(B, 0.85, 0.85, 0.18, dark, 0, 1.2, -3.2, 0, 0, 0, 18)
  bx(B, 0.3, 0.2, 0.9, black, 0, 1.25, -3.6)
  bx(B, 2.2, 0.3, 0.3, dark, 0, 0.9, -5.0)
  for (const s of SIDES) {
    addWheel(V, s * 1.22, 0.62, 3.2, 0.62, 0.45, { steer: true })
    for (const z of [-2.4, -3.8]) {
      addWheel(V, s * 1.02, 0.62, z, 0.62, 0.38)
      addWheel(V, s * 1.44, 0.62, z, 0.62, 0.36)
    }
  }
}

// --- Cement mixer ---------------------------------------------------------------------------------------------
function mixer(V) {
  const B = V.body
  const blue = paint('#2f6fd0', 0.3, 0.32)
  const dark = paint('#1c2433', 0.3, 0.5)
  const black = paint('#141418', 0.3, 0.5)
  const orange = paint('#ff7a1a')
  const white = paint('#f2f4f7', 0.15, 0.35)
  for (const s of SIDES) bx(B, 0.28, 0.45, 9.2, dark, s * 0.55, 0.85, -0.6)
  bx(B, 1.4, 0.18, 8.8, dark, 0, 0.74, -0.6)
  // Cab.
  rb(B, 2.45, 2.4, 2.25, blue, 0, 2.35, 3.0, 0, 0, 0, 0.32)
  rb(B, 2.1, 1.0, 0.1, glass(), 0, 2.95, 4.12, -0.12, 0, 0, 0.05)
  rb(B, 1.7, 0.7, 0.14, chrome(), 0, 1.5, 4.15, 0, 0, 0, 0.05)
  for (let i = 0; i < 6; i++) bx(B, 1.5, 0.06, 0.06, black, 0, 1.25 + i * 0.1, 4.23)
  rb(B, 2.55, 0.42, 0.36, chrome(), 0, 0.95, 4.2, 0, 0, 0, 0.12)
  rb(B, 1.2, 0.2, 0.4, dark, 0, 3.65, 2.7, 0, 0, 0, 0.06)
  light(V, 0.3, 0.18, 0.3, '#ffb020', -0.35, 3.82, 2.7, 2.8) // beacon
  light(V, 0.3, 0.18, 0.3, '#ffb020', 0.35, 3.82, 2.7, 2.8)
  for (const s of SIDES) {
    rb(B, 0.08, 0.7, 1.0, glass(), s * 1.23, 2.9, 3.0, 0, 0, 0, 0.03)
    light(V, 0.42, 0.26, 0.08, '#fff6d8', s * 0.85, 1.75, 4.15)
    cy(B, 0.04, 0.04, 0.6, chrome(), s * 1.5, 2.8, 3.9, 0, 0, Math.PI / 2, 6)
    rb(B, 0.14, 0.55, 0.28, black, s * 1.82, 2.8, 3.9, 0, 0, 0, 0.05)
    rb(B, 0.55, 0.5, 1.5, blue, s * 1.22, 1.35, 2.9, 0, 0, 0, 0.18)
    rb(B, 0.8, 0.12, 2.6, black, s * 1.25, 1.42, -2.7, 0, 0, 0, 0.05)
    light(V, 0.26, 0.16, 0.06, '#ff2a2a', s * 1.0, 1.0, -5.0, 2.8)
    marker(V.wheels, s * 1.25, 0.1, -2.7, V.rear)
  }
  cy(B, 0.16, 0.16, 2.2, chrome(), 1.2, 3.0, 1.7, 0, 0, 0, 10) // exhaust stack
  marker(B, 1.2, 4.15, 1.7, V.exhaust)
  cy(B, 0.42, 0.42, 2.0, white, -1.15, 1.55, -0.6, Math.PI / 2, 0, 0, 14) // water tank
  rb(B, 1.6, 1.5, 0.35, blue, 0, 1.65, 1.35, 0, 0, 0, 0.1) // drum pedestal
  rb(B, 1.8, 0.9, 0.5, dark, 0, 1.35, -3.6, 0, 0, 0, 0.1) // rollers frame
  // The drum: white shell, orange bands, a spiral fin, turning all the time.
  const pts = [new Vector2(0.01, 0), new Vector2(0.8, 0.2), new Vector2(1.25, 1.2), new Vector2(1.3, 2.6), new Vector2(1.0, 4.0), new Vector2(0.55, 4.8), new Vector2(0.01, 4.85)]
  const drum = new Group()
  drum.userData.live = true
  drum.rotation.x = -Math.PI / 2 + 0.22
  drum.position.set(0, 2.55, 1.2)
  B.add(drum)
  mesh(drum, once('mixDrum', () => new LatheGeometry(pts, 22)), white, 0, 0, 0, 0, 0, 0)
  for (let i = 0; i < 3; i++) {
    const ring = mesh(drum, once(`mixRing${i}`, () => new TorusGeometry(1.29 - Math.abs(i - 1) * 0.05, 0.09, 6, 26)), orange, 0, 1.4 + i * 0.9, 0, Math.PI / 2, 0, 0)
    ring.castShadow = false
  }
  for (let i = 0; i < 14; i++) {
    const y = 0.6 + i * 0.27
    const a = i * 0.95
    const r = y < 1.2 ? 0.8 + (y - 0.2) * 0.45 : y < 2.6 ? 1.3 : 1.3 - (y - 2.6) * 0.22
    bx(drum, 0.12, 0.26, 0.5, orange, Math.cos(a) * (r + 0.04), y, Math.sin(a) * (r + 0.04), 0, -a, 0.35, false)
  }
  V.spin.push(drum)
  cy(B, 0.75, 0.32, 0.8, orange, 0, 3.55, -4.3, 0, 0, 0, 16) // hopper
  rb(B, 0.5, 0.16, 1.6, orange, 0, 2.65, -4.95, -0.6, 0, 0, 0.06) // chute
  for (let i = 0; i < 6; i++) bx(B, 0.5, 0.05, 0.05, black, 0.95, 1.2 + i * 0.4, -4.25) // ladder rungs
  for (const dx of [0.72, 1.18]) bx(B, 0.05, 2.4, 0.05, black, dx, 2.2, -4.25)
  for (const s of SIDES) {
    addWheel(V, s * 1.2, 0.58, 2.8, 0.58, 0.42, { steer: true })
    for (const z of [-2.0, -3.4]) addWheel(V, s * 1.2, 0.58, z, 0.58, 0.46)
  }
}

// --- Jet --------------------------------------------------------------------------------------------------------
function jet(V) {
  const B = V.body
  const white = paint('#f2f4f7', 0.15, 0.3)
  const gold = paint('#ffb21f', 0.5, 0.3)
  const dark = paint('#3a3f4a', 0.35, 0.45)
  const black = paint('#141418', 0.3, 0.5)
  const prof = [[0.05, -5.0], [0.55, -4.8], [0.85, -4.0], [1.0, -2.0], [1.02, 0.5], [0.92, 2.4], [0.7, 3.8], [0.4, 4.9], [0.06, 5.7]].map(([r, y]) => new Vector2(r, y))
  mesh(B, once('jetBody', () => new LatheGeometry(prof, 22)), white, 0, 1.75, 0, Math.PI / 2, 0, 0)
  const canopy = mesh(B, sphereGeo(0.8), glass(), 0, 2.45, 2.4, 0, 0, 0)
  canopy.scale.set(0.72, 0.58, 2.0)
  for (const z of [1.7, 2.9]) bx(B, 1.05, 0.06, 0.08, dark, 0, 2.62, z, 0, 0, 0)
  for (const s of SIDES) {
    // Intakes.
    rb(B, 0.62, 0.85, 1.7, dark, s * 1.0, 1.55, 1.0, 0, 0, 0, 0.18)
    cy(B, 0.26, 0.26, 0.1, black, s * 1.0, 1.55, 1.86, Math.PI / 2, 0, 0, 12)
    // Wings with gold tips and navigation lights.
    const wing = new Group()
    wing.position.set(s * 0.9, 1.5, -0.6)
    wing.rotation.y = s * -0.4
    B.add(wing)
    rb(wing, 4.8, 0.2, 2.7, white, s * 2.4, 0, 0, 0, 0, 0, 0.08)
    rb(wing, 1.0, 0.22, 2.72, gold, s * 4.3, 0, 0, 0, 0, 0, 0.08)
    bx(wing, 3.4, 0.04, 0.06, dark, s * 2.3, 0.11, -0.9)
    for (const k of [1.4, 3.0]) cy(wing, 0.16, 0.16, 1.4, dark, s * k, -0.25, 0.2, Math.PI / 2, 0, 0, 8) // pylons
    const nav = rb(wing, 0.22, 0.22, 0.4, lit(s > 0 ? '#ff3a3a' : '#3aff6b', 3.2), s * 4.85, 0, 0.2, 0, 0, 0, 0.06)
    nav.userData.live = true
    // Twin tail fins and stabilisers.
    rb(B, 0.18, 2.0, 1.7, white, s * 0.75, 2.9, -3.9, 0.25, 0, s * -0.3, 0.06)
    rb(B, 0.2, 0.5, 1.72, gold, s * 1.02, 3.75, -4.15, 0.25, 0, s * -0.3, 0.06)
    rb(B, 2.4, 0.14, 1.3, white, s * 1.6, 1.8, -4.1, 0, s * -0.35, 0, 0.05)
    // Engines: nozzles and afterburner flames.
    cy(B, 0.5, 0.55, 1.6, dark, s * 0.48, 1.6, -4.6, Math.PI / 2, 0, 0, 14)
    cy(B, 0.58, 0.48, 0.4, chrome(), s * 0.48, 1.6, -5.55, Math.PI / 2, 0, 0, 14)
    V.flames.push(flame(B, s * 0.48, 1.6, -5.75, 1.3, 'back'))
    bx(B, 0.05, 0.22, 6.0, gold, s * 1.0, 1.85, 0.2)
  }
  light(V, 0.3, 0.2, 0.1, '#fff6d8', 0, 1.25, 4.6, 3)
  // Landing gear (folds up in the air).
  const gear = new Group()
  gear.userData.live = true
  B.add(gear)
  for (const [x, z] of [[0, 3.6], [1.4, -0.6], [-1.4, -0.6]]) {
    bx(gear, 0.14, 1.0, 0.14, dark, x, 0.75, z)
    const w = cy(gear, 0.3, 0.3, 0.22, mats.tyre(), x, 0.3, z, 0, 0, Math.PI / 2, 12)
    w.castShadow = true
  }
  V.gear = gear
}

// Returns { group, kind, body, assemble(k), landed(), finalize(), update(dt, ctx), points }.
// ctx: { speed (forward m/s), steer (rad), pitch, roll, heave, airborne, thrust 0..1 }.
// display: built and merged straight away (the hall's parked vehicles).
export function makeVehicle(kind, scale = 0.55, { display = false } = {}) {
  const group = new Group()
  const model = new Group()
  model.scale.setScalar(scale)
  group.add(model)
  const body = new Group()
  const wheels = new Group()
  model.add(body, wheels)
  const V = { body, wheels, wheelList: [], lights: [], exhaust: [], rear: [], flames: [], spin: [], gear: null }
  if (kind === 'truck') bigRig(V)
  else if (kind === 'mixer') mixer(V)
  else jet(V)
  model.traverse((o) => {
    if (o.isMesh) o.castShadow = true
  })
  // Pieces for the transform: assembled outward from the middle of the robot.
  const centre = new Vector3(0, 2.6, 0)
  const pieces = [...body.children, ...wheels.children]
    .filter((c) => c.isMesh || c.children.length)
    .map((obj) => {
      const tumble = new Quaternion().setFromEuler(new Euler(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU))
      const from = obj.position.clone().sub(centre).multiplyScalar(0.12).add(centre)
      from.y += Math.random() * 1.5
      return { obj, p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone(), tumble, from, d: obj.position.distanceTo(centre), done: true }
    })
    .sort((a, b) => a.d - b.d)
  pieces.forEach((pc, i) => (pc.delay = (i / Math.max(1, pieces.length - 1)) * 0.55))
  let merged = false
  let landedNow = 0
  let flashT = 0
  const api = {
    group,
    kind,
    body,
    points: V,
    // 0 = folded into the robot, 1 = built.
    assemble(k) {
      if (merged) return
      for (const pc of pieces) {
        const t = clamp01((k - pc.delay) / 0.45)
        const e = easeOut(t)
        pc.obj.position.lerpVectors(pc.from, pc.p, e)
        pc.obj.quaternion.slerpQuaternions(pc.tumble, pc.q, e)
        pc.obj.scale.copy(pc.s).multiplyScalar(Math.max(0.001, 0.08 + 0.92 * e))
        pc.obj.visible = t > 0
        const done = t >= 1
        if (done && !pc.done) landedNow++
        pc.done = done
      }
    },
    landed() {
      const n = landedNow
      landedNow = 0
      return n
    },
    // Headlights and marker lights blink on (end of the transform).
    flash() {
      flashT = 0.6
    },
    finalize() {
      if (merged) return
      api.assemble(1)
      merged = true
      mergeStatic(body)
      mergeStatic(wheels)
    },
    update(dt, ctx) {
      for (const w of V.wheelList) {
        if (!ctx.airborne) w.spin.rotation.x += ((ctx.speed ?? 0) * dt) / (w.r * scale)
        if (w.steer) w.pivot.rotation.y = ctx.steer ?? 0
      }
      body.position.y = ctx.heave ?? 0
      body.rotation.x = ctx.pitch ?? 0
      body.rotation.z = ctx.roll ?? 0
      for (const d of V.spin) d.rotateY(dt * (1.2 + Math.abs(ctx.speed ?? 0) * 0.04))
      for (const f of V.flames) {
        const on = (ctx.thrust ?? 0) > 0.04
        f.visible = on
        if (on) f.scale.set(f.userData.size, f.userData.size * (0.4 + ctx.thrust * 0.9) * (0.85 + Math.random() * 0.3), f.userData.size)
      }
      if (V.gear) {
        const want = ctx.airborne ? 0.02 : 1
        V.gear.scale.y += (want - V.gear.scale.y) * Math.min(1, dt * 5)
      }
      if (flashT > 0) {
        flashT -= dt
        const on = Math.floor(flashT * 10) % 2 === 0
        for (const l of V.lights) l.scale.setScalar(on ? 1.5 : 1)
        if (flashT <= 0) for (const l of V.lights) l.scale.setScalar(1)
      }
    },
  }
  if (display) api.finalize()
  return api
}

export { Mesh }
