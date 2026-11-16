import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ExtrudeGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Shape, SphereGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ROBOT } from './config.js'
import { groundBelow } from './player.js'

// The parachute. Drop off something high (the tower roof) without Robot Gear and, as the ground comes
// up, a ram-air canopy opens over you (gear wearers take the hit on their shock absorbers, impact.js):
//  - free fall (everyone): air streaks rush past and the wind roars louder the faster you fall,
//  - the rip: the pack pops (sparks, a puff), the pilot chute whips out on its bridle, the canopy
//    unfurls out of the pack cell by cell (the centre fills first, the tips flap open last) and snaps
//    full with a shock ring and a burst of air; the opening shock brakes the fall and swings you
//    forward under it,
//  - under canopy: it breathes and ripples, banks into turns, vortex trails stream off the tips and a
//    smoke flare in the trim colour trails from your boots; near the ground you flare (canopy
//    pitches up, hands pull the toggles down, legs out front) and touch down softly,
//  - touchdown: a dust ring, then the canopy left behind pitches forward, sighs out its air and folds
//    down into a heap that crumples away.
// `makeCanopy` is the look (any player: remotePlayers.js draws the others' from their `chute` act);
// `createParachute` is the local player's controller (when it opens, the physics, the free fall).

const C = ROBOT.chute
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const easeIn = (t) => t * t * t
const backOut = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)
const rnd = (a, b) => a + Math.random() * (b - a)
const HARNESS = 1.45 // m above the feet (x size)
export const SNAP = C.pack + C.inflate * 0.35 // s after the rip the canopy snaps full
export const flareFor = (dist) => clamp01(((C.flareAlt - dist) / C.flareAlt) * 1.6)

const N = C.cells
const W = C.span / N
const R = 5.2 // arc radius of the canopy's anhedral
const STEP = W / R
const ATTACH = [C.chord * 0.3, 0, -C.chord * 0.33] // line attachments under every cell (chord positions)

// One cell of the wing: a cambered airfoil (leading edge at +z) extruded across the cell's width, with a
// glowing strip under the leading edge. Built once, shared by every canopy.
let cellGeo = null
function cellGeometry() {
  if (cellGeo) return cellGeo
  const w = W * 1.03
  const chord = C.chord
  const t = chord * 0.17
  const s = new Shape()
  const n = 14
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const x = -chord / 2 + u * chord
    const y = t * 2.5 * Math.sqrt(u) * Math.pow(1 - u, 1.15)
    i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)
  }
  for (let i = n; i >= 0; i--) {
    const u = i / n
    s.lineTo(-chord / 2 + u * chord, -t * 0.22 * Math.sqrt(u) * (1 - u))
  }
  const g = new ExtrudeGeometry(s, { depth: w, bevelEnabled: false, steps: 1 })
  g.translate(0, 0, -w / 2)
  g.rotateY(Math.PI / 2) // chord x -> -z: the leading edge (x = -chord / 2) faces +z
  g.computeVertexNormals()
  const strip = new BoxGeometry(w * 0.98, 0.045, 0.07)
  strip.translate(0, -0.02, chord / 2 - 0.12)
  cellGeo = mergeGeometries([g.toNonIndexed(), strip.toNonIndexed()], true)
  g.dispose()
  strip.dispose()
  return cellGeo
}

// Air streaks rushing past a body falling at vy (m/s), plus a few sparks in `glow` peeling off it.
export function freefallFx(fx, P, vy, size, glow, dt, scale = 1) {
  const v = -vy
  if (v < 12) return
  const n = Math.max(1, Math.round(Math.min(4, Math.round((v - 10) / 9) + 1) * scale))
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const r = rnd(1.1, 3.2) * size
    fx.streak(P.x + Math.cos(a) * r, P.y + rnd(-1.5, 3.5) * size, P.z + Math.sin(a) * r, 0, 3, 0, { count: 1, jitter: 0.2, size: rnd(0.1, 0.18), shrink: 0.6, life: 0.32, colors: ['#ffffff', '#d6ecff'], intensity: 1.1, drag: 0.5 })
  }
  if (Math.random() < dt * 10 * scale) {
    fx.streak(P.x + rnd(-0.4, 0.4) * size, P.y + rnd(0.6, 1.8) * size, P.z + rnd(-0.4, 0.4) * size, 0, 4, 0, { count: 2, jitter: 1, size: 0.22, life: 0.4, colors: [glow, '#ffffff'], intensity: 2.6 })
  }
}

// The canopy, pack and lines on one body. holder: the body's group (feet at its origin, +z forward);
// feet: the body's feet position (read every frame). Phases: idle -> deploy -> open -> collapse -> idle.
export function makeCanopy({ scene, holder, feet, fx, snd }) {
  const root = new Group() // at the harness, scaled by the body size
  root.visible = false
  const swing = new Group() // pendulum: canopy + lines swing around the harness
  root.add(swing)
  const canopy = new Group()
  swing.add(canopy)
  const matA = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, metalness: 0.05 })
  const matB = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, metalness: 0.05 })
  const neon = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
  const geo = cellGeometry()
  const cells = []
  for (let i = 0; i < N; i++) {
    const m = new Mesh(geo, [i % 2 ? matB : matA, neon])
    m.castShadow = true
    m.userData.a = (i - (N - 1) / 2) * STEP
    m.userData.delay = (Math.abs(i - (N - 1) / 2) / ((N - 1) / 2)) * 0.38 // centre fills first
    m.userData.phase = Math.random() * 6.28
    canopy.add(m)
    cells.push(m)
  }
  // Tip markers for the vortex trails (trailing edge of the outer cells).
  const tips = [new Group(), new Group()]
  cells[0].add(tips[0])
  cells[N - 1].add(tips[1])
  tips[0].position.set(-W * 0.5, 0, -C.chord * 0.45)
  tips[1].position.set(W * 0.5, 0, -C.chord * 0.45)

  // Pilot chute: a little dome on its bridle, trailing above and behind the canopy.
  const pilot = new Group()
  const domeMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, side: 2 })
  const dome = new Mesh(new SphereGeometry(0.42, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), domeMat)
  pilot.add(dome)
  pilot.add(new Mesh(new BoxGeometry(0.86, 0.04, 0.04), neon))
  swing.add(pilot)

  // Suspension lines: from three points under every cell down to the left / right riser, plus the bridle.
  const SEG = N * ATTACH.length + 1
  const linePos = new Float32Array(SEG * 6)
  const lineGeo = new BufferGeometry()
  lineGeo.setAttribute('position', new BufferAttribute(linePos, 3))
  const lineMat = new LineBasicMaterial({ color: '#2c2e36', transparent: true, opacity: 0.85 })
  const lines = new LineSegments(lineGeo, lineMat)
  lines.frustumCulled = false
  swing.add(lines)

  // The container on the back (stays with the body, not the canopy).
  const pack = new Group()
  const packBox = new Mesh(new BoxGeometry(0.62, 0.66, 0.26), new MeshStandardMaterial({ color: '#2a2d36', roughness: 0.7 }))
  packBox.castShadow = true
  pack.add(packBox)
  const packStrip = new Mesh(new BoxGeometry(0.64, 0.06, 0.27), neon)
  packStrip.position.y = 0.18
  pack.add(packStrip)
  const flap = new Mesh(new BoxGeometry(0.6, 0.05, 0.3), matA)
  flap.position.set(0, 0.34, 0)
  pack.add(flap)
  pack.visible = false
  holder.add(pack)
  holder.add(root)

  const tmp = new Vector3()
  const tmp2 = new Vector3()
  const col = new Color()
  function paint(def) {
    const base = def?.color ?? C.color
    const glow = def?.glow ?? C.glow
    col.set(base)
    const light = col.r * 0.3 + col.g * 0.59 + col.b * 0.11 > 0.62
    matA.color.set(base)
    matB.color.set(light ? glow : '#f2f4f8')
    neon.color.set(glow)
    domeMat.color.set(glow)
  }

  let phase = 'idle' // idle | deploy | open | collapse
  let t = 0
  let size = 1
  let vol = 1
  let glowCol = C.glow
  let snapped = false
  let flareCalled = false
  let landDust = false
  let trailT = 0
  let smokeT = 0
  const sw = { p: 0, pv: 0, r: 0, rv: 0 }

  function layout(k, time, collapse = 0) {
    // k: 0 (bundled in the pack) .. 1 (fully open); collapse: 0..1 deflating on the ground.
    for (let i = 0; i < N; i++) {
      const m = cells[i]
      const u = m.userData
      const ki = clamp01((k - u.delay) / (1 - 0.38))
      const open = easeOut(ki)
      const a = u.a * (0.18 + 0.82 * open) * (1 - collapse * 0.35)
      const r = R * (0.5 + 0.5 * open)
      m.position.set(Math.sin(a) * r, (Math.cos(a) - 1) * r, 0)
      const breath = ki >= 1 && !collapse ? Math.sin(time * 2.6 + u.phase) * 0.035 : 0
      const thick = Math.max(0.06, (0.12 + 0.88 * Math.min(1.15, backOut(ki))) * (1 + breath) * (1 - collapse * 0.9))
      const width = (0.3 + 0.7 * open) * (1 - collapse * 0.12)
      const chord = (0.4 + 0.6 * open) * (1 - collapse * 0.15)
      m.scale.set(width, thick, chord)
      const flapAmp = 0.28 * (1 - ki) + 0.012 + collapse * 0.35
      m.rotation.set(Math.sin(time * (ki < 1 ? 26 : 7) + u.phase) * flapAmp, 0, -a)
    }
  }

  function updateLines() {
    canopy.updateMatrix()
    let o = 0
    const put = (v) => {
      linePos[o++] = v.x
      linePos[o++] = v.y
      linePos[o++] = v.z
    }
    for (let i = 0; i < N; i++) {
      const m = cells[i]
      m.updateMatrix()
      const side = m.position.x >= 0 ? 0.24 : -0.24
      for (const z of ATTACH) {
        tmp.set(0, -0.01, z).applyMatrix4(m.matrix).applyMatrix4(canopy.matrix)
        put(tmp)
        put(tmp2.set(side, 0.05, 0.02))
      }
    }
    // Bridle: canopy top centre to the pilot chute.
    tmp.set(0, C.chord * 0.14, -C.chord * 0.1).applyMatrix4(cells[(N - 1) >> 1].matrix).applyMatrix4(canopy.matrix)
    put(tmp)
    put(pilot.position)
    lineGeo.attributes.position.needsUpdate = true
  }

  function show(on) {
    root.visible = on
    pack.visible = on
  }
  function reattach() {
    if (root.parent !== holder) holder.add(root)
    root.position.set(0, HARNESS * size, 0)
    root.rotation.set(0, 0, 0)
  }

  function vortexFx(dt) {
    trailT -= dt
    if (trailT <= 0) {
      trailT = 0.035
      for (const tip of tips) {
        tip.getWorldPosition(tmp)
        fx.streak(tmp.x, tmp.y, tmp.z, 0, 0.2, 0, { count: 1, jitter: 0.15, size: 0.2 * size, shrink: 0.2, life: 0.9, drag: 0.6, colors: ['#ffffff', glowCol], intensity: 1.7 })
      }
    }
    smokeT -= dt
    if (smokeT <= 0) {
      smokeT = 0.05
      const P = feet()
      fx.dust(P.x, P.y + 0.1 * size, P.z, { count: 1, size: 0.45 * size, grow: 3.4, life: 1.9, color: glowCol, alpha: 0.32, rise: 0.25, push: 0.15, spread: 0.05, height: 0 })
    }
  }

  return {
    get phase() {
      return phase
    },
    get t() {
      return t
    },
    // def: canopy colours ({ color, glow }, default ROBOT.chute); v: sound volume 0..1 (0 = silent).
    deploy(def = null, v = 1) {
      phase = 'deploy'
      t = 0
      vol = v
      snapped = false
      flareCalled = false
      paint(def)
      glowCol = def?.glow ?? C.glow
      reattach()
      show(true)
      lineMat.opacity = 0.85
      canopy.scale.setScalar(1)
      sw.p = sw.r = sw.pv = sw.rv = 0
      flap.position.set(0, 0.34, 0)
      flap.rotation.set(0, 0, 0)
      if (vol > 0.02) snd.chuteDeploy(SNAP, vol)
      pack.getWorldPosition(tmp)
      fx.sparks(tmp.x, tmp.y + 0.3 * size, tmp.z, { count: 18, colors: [glowCol, '#ffffff'], speed: 5, up: 3, size: 0.32, life: 0.5 })
      fx.dust(tmp.x, tmp.y + 0.2 * size, tmp.z, { count: 5, size: 0.7 * size, grow: 2.4, life: 0.7, color: '#f4f6fa', alpha: 0.4, rise: 2, spread: 0.3, push: 1.2, height: 0 })
    },
    // Touchdown: dust ring at the feet; the canopy stays where it came down and folds away.
    land() {
      if (phase !== 'deploy' && phase !== 'open') return
      phase = 'collapse'
      t = 0
      landDust = false
      if (vol > 0.02) snd.chuteLand(vol)
      const P = feet()
      fx.ring(P.x, P.y + 0.12, P.z, 0.4, 6 * size, '#ffffff', 0.7)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        fx.dust(P.x + Math.cos(a) * 0.7 * size, P.y + 0.05, P.z + Math.sin(a) * 0.7 * size, { count: 2, size: 1 * size, grow: 2.4, life: 1.1, spread: 0.3, push: 3, alpha: 0.42, color: '#d9c7ad', height: 0 })
      }
      fx.sparks(P.x, P.y + 0.3, P.z, { count: 16, colors: [glowCol, '#ffffff'], speed: 5, size: 0.3, flat: true, life: 0.5 })
      scene.attach(root)
      pack.visible = false
    },
    // Gone at once (gear put on, elevator, out of view): a little poof where it was.
    stow(poof = true) {
      if (phase === 'idle') return
      if (poof && root.visible) {
        root.getWorldPosition(tmp)
        fx.sparks(tmp.x, tmp.y, tmp.z, { count: 14, colors: [glowCol, '#ffffff'], speed: 4, size: 0.3, life: 0.4 })
      }
      phase = 'idle'
      show(false)
      reattach()
    },
    // o: { size, flare 0..1, yawRate (rad/s), speed (horizontal m/s), loops (drive the canopy sound loop) }
    update(dt, elapsed, o) {
      if (phase === 'idle') return
      t += dt
      if (phase !== 'collapse') {
        size = o.size ?? 1
        root.position.set(0, HARNESS * size, 0)
      }
      root.scale.setScalar(size)
      pack.position.set(0, 1.28 * size, -0.34 * size)
      pack.scale.setScalar(size)

      if (phase === 'deploy' || phase === 'open') {
        const flare = phase === 'open' ? o.flare ?? 0 : 0
        if (phase === 'deploy') {
          // Pilot chute whips out first; then the canopy unfurls up out of the pack.
          const kp = clamp01(t / C.pack)
          const k = clamp01((t - C.pack) / C.inflate)
          flap.rotation.x = -easeOut(kp) * 2.2
          flap.position.set(0, 0.34 + kp * 0.08, -kp * 0.1)
          canopy.position.set(0, -0.1 + (C.lines + 0.1) * easeOut(k), -0.35 * (1 - k))
          canopy.rotation.set(0.1 + (1 - k) * 0.5, 0, 0)
          layout(k, elapsed)
          const pk = easeOut(kp)
          pilot.position.set(0, -0.1 + (C.lines + 1.6) * pk, -0.4 - 1.3 * pk)
          pilot.rotation.set(-0.5 * pk + Math.sin(elapsed * 30) * 0.1, 0, Math.sin(elapsed * 23) * 0.15)
          pilot.scale.setScalar(0.4 + 0.6 * pk)
          if (t >= SNAP && !snapped) {
            // The snap: shock ring, a burst of air out of the cells, the swing forward.
            snapped = true
            canopy.getWorldPosition(tmp)
            fx.ring(tmp.x, tmp.y, tmp.z, 0.6, 7 * size, glowCol, 0.75)
            fx.dust(tmp.x, tmp.y, tmp.z, { count: 12, size: 1.1 * size, grow: 2.6, life: 0.8, color: '#ffffff', alpha: 0.35, rise: 0.5, spread: 3 * size, push: 2.2, height: 0.3 })
            fx.sparks(tmp.x, tmp.y, tmp.z, { count: 26, colors: [glowCol, '#ffffff'], speed: 7, up: 1, size: 0.38, life: 0.6, spread: 2 * size })
            sw.pv -= 2.6
          }
          if (t >= C.pack + C.inflate) phase = 'open'
        } else {
          canopy.position.set(0, C.lines, 0)
          layout(1, elapsed)
          if (flare > 0.3 && !flareCalled) {
            flareCalled = true
            if (vol > 0.02) snd.chuteFlare(vol)
          }
          canopy.rotation.set(0.1 - flare * 0.42, 0, 0)
          pilot.position.set(0, C.lines + 1.3 + Math.sin(elapsed * 3) * 0.08, -1.7)
          pilot.rotation.set(-0.5 + Math.sin(elapsed * 9) * 0.06, 0, Math.sin(elapsed * 7) * 0.1)
          pilot.scale.setScalar(1)
          vortexFx(dt)
        }
        // Pendulum: the opening shock swings the body forward, turns bank the canopy into the turn.
        const rollT = Math.max(-0.45, Math.min(0.45, -(o.yawRate ?? 0) * 0.22))
        sw.pv += (-60 * sw.p - 4.2 * sw.pv) * dt
        sw.rv += (40 * (rollT - sw.r) - 5 * sw.rv) * dt
        sw.p += sw.pv * dt
        sw.r += sw.rv * dt
        swing.rotation.set(sw.p * 0.5, 0, sw.r)
        if (o.loops) snd.loop('canopy', phase === 'open' ? 0.85 : clamp01((t - C.pack) / C.inflate) * 0.85, Math.min(1, (o.speed ?? 0) / C.speed), dt)
        updateLines()
        return
      }

      // Collapse on the ground: pitches forward, sighs out its air, folds down and crumples away.
      if (o.loops) snd.loop('canopy', 0, 0.5, dt)
      const k = clamp01(t / C.collapse)
      const fall = easeIn(Math.min(1, k * 1.3))
      swing.rotation.x += (0 - swing.rotation.x) * Math.min(1, dt * 4)
      swing.rotation.z += (0 - swing.rotation.z) * Math.min(1, dt * 4)
      canopy.position.set(0, C.lines - (C.lines + HARNESS - 0.3) * fall, 2.4 * fall)
      canopy.rotation.set(0.1 + fall * 1.35, 0, 0)
      layout(1, elapsed, Math.min(1, k * 1.4))
      const shrink = k > 0.72 ? 1 - easeIn((k - 0.72) / 0.28) : 1
      canopy.scale.set(shrink, Math.max(0.001, shrink), shrink)
      pilot.position.lerp(tmp2.set(0, -HARNESS + 0.3, 3.4), Math.min(1, dt * 3))
      pilot.scale.setScalar(Math.max(0.001, shrink))
      lineMat.opacity = 0.85 * (1 - k)
      if (k > 0.62 && !landDust) {
        landDust = true
        canopy.getWorldPosition(tmp)
        fx.dust(tmp.x, tmp.y, tmp.z, { count: 10, size: 1.2 * size, grow: 2.2, life: 1.1, spread: 2.5 * size, push: 1.6, alpha: 0.38, color: '#e6dccb', height: 0 })
      }
      updateLines()
      if (k >= 1) {
        phase = 'idle'
        show(false)
        canopy.scale.setScalar(1)
        reattach()
      }
    },
    dispose() {
      holder.remove(pack)
      root.parent?.remove(root)
      for (const m of [matA, matB, neon, domeMat, lineMat, packBox.material]) m.dispose()
      lineGeo.dispose()
    },
  }
}

// The local player's parachute: when it opens, the braking physics (player.chute), the flare, the free
// fall rush (for everyone, gear or not) and touchdown.
export function createParachute({ scene, playerGroup, player, fx, snd, onDeploy }) {
  const canopy = makeCanopy({ scene, holder: playerGroup, feet: () => player.renderPosition, fx, snd })
  let apexY = 0
  let dist = 99
  let flare = 0
  let rushLevel = 0
  let lastFacing = player.facing
  let yawRate = 0
  const params = { sink: C.sink, decel: 0, glide: C.glide, speed: C.speed }
  const flying = () => canopy.phase === 'deploy' || canopy.phase === 'open'

  function stow() {
    canopy.stow()
    player.chute = null
  }

  return {
    get active() {
      return flying()
    },
    get flare() {
      return canopy.phase === 'open' ? flare : 0
    },
    stow,
    // allowed: the parachute may open now; s: body size; glow: free-fall spark colour.
    update(dt, elapsed, { allowed, s = 1, glow = C.glow }) {
      const airborne = !player.grounded
      const vy = player.velocity.y
      // Free fall tracking: where this drop began.
      if (!airborne || player.fly || player.climb || player.locked) apexY = player.position.y
      else apexY = Math.max(apexY, player.position.y)

      const dYaw = Math.atan2(Math.sin(player.facing - lastFacing), Math.cos(player.facing - lastFacing))
      lastFacing = player.facing
      yawRate += (Math.max(-6, Math.min(6, dYaw / Math.max(dt, 1e-3))) - yawRate) * Math.min(1, dt * 6)

      let rush = 0
      if (canopy.phase === 'idle' || canopy.phase === 'collapse') {
        if (airborne && vy < 0 && !player.fly && !player.climb && !player.locked) {
          dist = groundBelow()
          const v = -vy
          if (apexY - (player.position.y - dist) >= C.minDrop) {
            rush = Math.max(0, Math.min(1, (v - 10) / 40))
            freefallFx(fx, player.renderPosition, vy, s, glow, dt)
            const stop = (v * v - C.sink * C.sink) / (2 * C.decel) + v * SNAP + C.margin
            if (allowed && canopy.phase === 'idle' && vy <= C.triggerVy && dist >= C.minAlt && dist <= Math.max(C.deployAlt, stop)) {
              flare = 0
              canopy.deploy(null, 1)
              onDeploy?.()
            }
          }
        }
      } else if (!allowed || player.locked || player.fly || player.climb) stow()
      rushLevel += (rush - rushLevel) * Math.min(1, dt * 5)
      snd.loop('rush', rushLevel * 0.9, rushLevel, dt)

      if (flying()) {
        dist = groundBelow()
        if (canopy.phase === 'deploy') {
          const t = canopy.t
          if (t >= C.pack) {
            params.decel = C.decel * clamp01((t - C.pack) / (SNAP - C.pack)) * 0.6 + (t >= SNAP ? C.decel * 0.4 : 0)
            params.sink = C.sink
            params.glide = C.glide
            player.chute = params
          }
          if (!airborne && t > 0.1) {
            canopy.land()
            player.chute = null
          }
        } else {
          // Flare in the last few metres: canopy pitches up, the descent nearly stops.
          flare += (flareFor(dist) - flare) * Math.min(1, dt * 7)
          params.sink = C.sink + (C.flareSink - C.sink) * flare
          params.decel = C.decel
          params.glide = C.glide * (1 - flare * 0.5)
          player.chute = params
          if (!airborne) {
            canopy.land()
            player.chute = null
          }
        }
      }
      canopy.update(dt, elapsed, { size: s, flare, yawRate, speed: Math.hypot(player.velocity.x, player.velocity.z), loops: true })
      if (canopy.phase === 'idle') snd.loop('canopy', 0, 0.5, dt)
    },
  }
}
