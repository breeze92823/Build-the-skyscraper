import { AdditiveBlending, BackSide, BufferAttribute, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { FINALE } from './config.js'
import { pointInPolygon } from './shapes.js'
import { createEmoteChannel } from './emotes.js'
import { flatText } from './propkit.js'
import { commas } from './stats.js'
import { finale as sfx } from './audio/index.js'
import './finale.css'

// Top Builders finale. When a building is finished (main.js `complete` -> queue()), the top 3
// builders of THAT building (tower.contributors(): blocks placed on it by the room's real
// players, the server's `built` list) are shown on glowing podiums on its roof, opposite the south walkway: a swoop onto the
// roof, a close-up per builder from #3 up to #1 (snare roll, then the name card pops with a
// hit, confetti and a cheer; #1 gets a crown, a fanfare and fireworks), then a wide shot of
// all three. Letterbox bars carry the title, the countdown and SKIP; the HUD is hidden and you
// stand still (or on your podium) while everyone watches. You are held through
// `me.stage(spot | null)` / `me.release()` (main.js owns the player); other players only get their podium and card.

const UP = new Vector3(0, 1, 0)
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Celebration poses layered over the idle (emotes.js clip format: bone-degree deltas).
const CLIPS = {
  victory: {
    len: 1.1,
    loop: true,
    tracks: {
      ArmL_Offset: [[0, -165, 0, -18], [0.55, -150, 0, -26], [1.1, -165, 0, -18]],
      ArmR_Offset: [[0, -150, 0, 26], [0.55, -165, 0, 18], [1.1, -150, 0, 26]],
      ArmL2: [[0, -12, 0, 0], [0.55, -30, 0, 0], [1.1, -12, 0, 0]],
      ArmR2: [[0, -30, 0, 0], [0.55, -12, 0, 0], [1.1, -30, 0, 0]],
      Neck1: [[0, -6, 0, 0], [0.55, -8, 0, 0], [1.1, -6, 0, 0]],
    },
  },
  wave: {
    len: 0.9,
    loop: true,
    tracks: {
      ArmR_Offset: [[0, -158, 0, 30], [0.45, -158, 0, 6], [0.9, -158, 0, 30]],
      ArmR2: [[0, -24, 0, 0], [0.45, -6, 0, 0], [0.9, -24, 0, 0]],
      ArmL_Offset: [[0, -8, 0, -6], [0.9, -8, 0, -6]],
    },
  },
  pump: {
    len: 0.8,
    loop: true,
    tracks: {
      ArmL_Offset: [[0, -150, 0, -12], [0.4, -172, 0, -8], [0.8, -150, 0, -12]],
      ArmL2: [[0, -36, 0, 0], [0.4, -8, 0, 0], [0.8, -36, 0, 0]],
      ArmR_Offset: [[0, -10, 0, 8], [0.8, -10, 0, 8]],
    },
  },
}
const CLIP_FOR = { 1: 'victory', 2: 'wave', 3: 'pump' }

export function createFinale({ scene, camera, tower, fx, me, onStart, onEnd }) {
  let pending = -1 // s until the show starts (-1 = none)
  let show = null // the running show
  let holdT = null // dev: holdAt()
  const later = [] // [fn, ms] deferred until the show is over (main.js reward toasts)

  // --- Overlay (built once) -----------------------------------------------------------------------
  const root = document.createElement('div')
  root.className = 'fin'
  root.hidden = true
  root.innerHTML = `
    <div class="fin-flash"></div>
    <div class="fin-cards"></div>
    <div class="fin-bar fin-top"><div class="fin-title">TOP BUILDERS</div><div class="fin-sub"></div></div>
    <div class="fin-bar fin-bot">
      <div class="fin-msg"><div class="fin-watch">Everyone is watching the finale <b>0s</b></div><div class="fin-you"></div></div>
      <button type="button" class="fin-skip">SKIP <svg viewBox="0 0 24 14" aria-hidden="true"><path d="M0 0l11 7-11 7zM12 0l11 7-11 7z"/></svg></button>
    </div>`
  document.body.append(root)
  const cardsEl = root.querySelector('.fin-cards')
  const subEl = root.querySelector('.fin-sub')
  const watchNum = root.querySelector('.fin-watch b')
  const youEl = root.querySelector('.fin-you')
  const flashEl = root.querySelector('.fin-flash')
  const topBar = root.querySelector('.fin-top')
  const botBar = root.querySelector('.fin-bot')
  root.querySelector('.fin-skip').addEventListener('click', () => {
    if (!show || show.ending) return
    sfx.skip()
    finish()
  })
  const onKeyDown = (e) => {
    if (show && !show.ending && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      e.preventDefault()
      sfx.skip()
      finish()
    }
  }

  // --- Where the podiums go -----------------------------------------------------------------------
  // On the roof between the crown and the edge, facing out, on the side away from the south
  // walkway (hut, hoist and stairs exits). Local coordinates (relative to the tower centre).
  function findStage() {
    const spec = tower.spec
    const pts = spec.pts
    const crownR = tower.lobby?.crownR ?? spec.size * 0.5
    const inside = (x, z) => pointInPolygon(x, z, pts)
    const tries = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75]
    let best = null
    for (const sp of [FINALE.spacing, FINALE.spacing * 0.8]) {
      for (const off of tries) {
        const a = -Math.PI / 2 + off // (0, -1) = north
        const dx = Math.cos(a)
        const dz = Math.sin(a)
        let R = crownR
        while (R < spec.size * 3 && inside(dx * (R + 0.25), dz * (R + 0.25))) R += 0.25
        const room = R - crownR
        if (!best || room > best.room) best = { dx, dz, room, crownR, sp }
        if (room < 3.2) continue
        const r = crownR + Math.max(1.7, room * 0.5)
        const tx = -dz
        const tz = dx
        const spots = [0, 1, -1].map((k) => ({ x: dx * r + tx * sp * k, z: dz * r + tz * sp * k }))
        const m = FINALE.podiumR
        const ok = spots.every((p) => Math.hypot(p.x, p.z) > crownR + m && [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([u, v]) => inside(p.x + u, p.z + v)))
        if (ok) return { dx, dz, tx, tz, r, spots }
      }
    }
    // Nothing fits cleanly (a very spiky roof): the roomiest direction, tight.
    const { dx, dz, crownR: cr, room } = best
    const r = cr + Math.max(1.2, room * 0.5)
    const sp = FINALE.spacing * 0.75
    return { dx, dz, tx: -dz, tz: dx, r, spots: [0, 1, -1].map((k) => ({ x: dx * r - dz * sp * k, z: dz * r + dx * sp * k })) }
  }

  // --- Props ----------------------------------------------------------------------------------------
  // A beam's vertex colours fade from bright at the podium to black at the top (additive = clear).
  function beamGeometry(h) {
    const g = new CylinderGeometry(0.35, FINALE.podiumR * 1.05, h, 24, 6, true)
    g.translate(0, h / 2, 0)
    const pos = g.attributes.position
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const k = Math.pow(1 - pos.getY(i) / h, 1.6)
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    return g
  }
  function makeCrown() {
    const g = new Group()
    const gold = new MeshStandardMaterial({ color: '#ffc21a', metalness: 0.9, roughness: 0.28, emissive: '#7a4a00', emissiveIntensity: 0.6 })
    const band = new Mesh(new CylinderGeometry(0.34, 0.3, 0.2, 18, 1, true), gold)
    band.material.side = DoubleSide
    g.add(band)
    const gems = ['#ff3b5c', '#3bd9ff', '#7dff6b', '#3bd9ff', '#ff3b5c']
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      const spike = new Mesh(new ConeGeometry(0.075, 0.24, 6), gold)
      spike.position.set(Math.cos(a) * 0.31, 0.2, Math.sin(a) * 0.31)
      const gem = new Mesh(new SphereGeometry(0.055, 8, 6), new MeshBasicMaterial({ color: gems[i], toneMapped: false }))
      gem.position.set(Math.cos(a) * 0.31, 0.34, Math.sin(a) * 0.31)
      g.add(spike, gem)
    }
    return g
  }
  function buildProps(stage, actors, C, roofY) {
    const g = new Group()
    for (const a of actors) {
      const R = FINALE.ranks[a.rank]
      const h = FINALE.podium[a.rank]
      const holder = new Group()
      holder.position.set(C.x + a.local.x, roofY, C.z + a.local.z)
      holder.rotation.y = a.facing
      const body = new Mesh(new CylinderGeometry(FINALE.podiumR, FINALE.podiumR * 1.08, h, 32), new MeshStandardMaterial({ color: '#1d1830', roughness: 0.45, metalness: 0.4 }))
      body.position.y = h / 2
      body.castShadow = body.receiveShadow = true
      const top = new Mesh(new CylinderGeometry(FINALE.podiumR * 0.98, FINALE.podiumR * 0.98, 0.06, 32), new MeshStandardMaterial({ color: R.color, roughness: 0.3, metalness: 0.7, emissive: R.color, emissiveIntensity: 0.35 }))
      top.position.y = h + 0.03
      const rimMat = new MeshBasicMaterial({ color: new Color(R.rim).multiplyScalar(2.2), toneMapped: false })
      const rim = new Mesh(new TorusGeometry(FINALE.podiumR * 1.0, 0.045, 6, 48), rimMat)
      rim.rotation.x = Math.PI / 2
      rim.position.y = h + 0.02
      const foot = new Mesh(new TorusGeometry(FINALE.podiumR * 1.08, 0.04, 6, 48), rimMat)
      foot.rotation.x = Math.PI / 2
      foot.position.y = 0.03
      const num = flatText(`#${a.rank}`, Math.min(0.55, h * 0.75), { color: R.rim, outline: '#140f22', outlineWidth: 10 })
      num.position.set(0, h * 0.5, FINALE.podiumR * 1.08 + 0.02)
      const beam = new Mesh(beamGeometry(FINALE.beam), new MeshBasicMaterial({ color: R.color, vertexColors: true, transparent: true, opacity: 0.05, blending: AdditiveBlending, depthWrite: false, side: BackSide, fog: false, toneMapped: false }))
      // Back faces only: from outside, the beam's far wall glows behind the builder, never over them.
      beam.position.y = h
      const ring = new Mesh(new RingGeometry(0.75, 1.35, 48), new MeshBasicMaterial({ color: R.color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }))
      ring.rotation.x = -Math.PI / 2
      ring.position.y = h + 0.08
      holder.add(body, top, rim, foot, num, beam, ring)
      g.add(holder)
      a.beam = beam
      a.ring = ring
    }
    const crown = makeCrown()
    crown.visible = false
    g.add(crown)
    scene.add(g)
    return { group: g, crown }
  }
  function disposeTree(o) {
    o.traverse((m) => {
      if (!m.isMesh) return
      m.geometry?.dispose()
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mat?.map?.dispose()
        mat?.dispose()
      }
    })
    o.removeFromParent()
  }

  // --- Show -------------------------------------------------------------------------------------------
  function start() {
    const all = tower.contributors()
    if (!all.length || tower.phase !== 'celebrate') return false
    const stage = findStage()
    const C = tower.center
    const roofY = tower.roofY
    const facing = Math.atan2(stage.dx, stage.dz)
    const actors = all.slice(0, 3).map((c, i) => {
      const rank = i + 1
      const local = stage.spots[i]
      const pos = new Vector3(C.x + local.x, roofY + FINALE.podium[rank], C.z + local.z)
      const spot = { x: pos.x, y: pos.y, z: pos.z, facing }
      const a = { rank, id: c.id, name: c.id === 'me' ? me.name() : c.name, blocks: c.blocks, local, pos, facing, revealed: false, flare: 0, scale: 0.6, mine: c.id === 'me' }
      if (a.mine) {
        a.staged = me.stage(spot)
        a.animator = () => me.animator()
        a.head = () => me.headY()
      } else {
        // Another real player: the podium, name card and crown are staged, their own body stays where they are.
        a.animator = () => null
        a.head = () => 2.05
      }
      a.channel = createEmoteChannel()
      return a
    })
    const meIdx = all.findIndex((c) => c.id === 'me')
    if (meIdx < 0 || meIdx > 2) me.stage(null) // not on a podium: stand still and watch

    // Timeline: intro, close-ups from the lowest rank to #1, wide.
    const shots = [{ kind: 'intro', t0: 0, t1: FINALE.intro }]
    let t = FINALE.intro
    for (const a of [...actors].sort((x, y) => y.rank - x.rank)) {
      const dur = a.rank === 1 ? FINALE.shotTop : FINALE.shot
      shots.push({ kind: 'close', actor: a, t0: t, t1: t + dur })
      t += dur
    }
    shots.push({ kind: 'wide', t0: t, t1: t + FINALE.wide })
    const total = t + FINALE.wide

    // Overlay.
    cardsEl.textContent = ''
    for (const a of actors) {
      const el = document.createElement('div')
      el.className = `fin-card r${a.rank}${a.mine ? ' mine' : ''}`
      el.innerHTML = `<div class="fc-in"><div class="fc-rank">#${a.rank}</div><div class="fc-name"></div><div class="fc-blocks">${commas(a.blocks)} BLOCKS</div>${a.mine ? '<div class="fc-you">YOU</div>' : ''}</div>`
      el.querySelector('.fc-name').textContent = a.name // player names are untrusted text
      cardsEl.append(el)
      a.el = el
      a.inner = el.firstElementChild
    }
    subEl.textContent = `${tower.spec.def.name} complete!`
    youEl.textContent =
      meIdx < 0 ? 'Place blocks on the next building to make the podium!' : meIdx > 2 ? `You placed ${commas(all[meIdx].blocks)} blocks · #${meIdx + 1} of ${all.length}` : `You're #${meIdx + 1}! Great building!`
    root.hidden = false
    root.classList.remove('on', 'out')
    void root.offsetWidth // restart the bar slide-in
    root.classList.add('on')
    document.body.classList.add('finale-on')
    if (document.pointerLockElement) document.exitPointerLock?.() // the cursor is needed for SKIP
    window.addEventListener('keydown', onKeyDown, true)

    const props = buildProps(stage, actors, C, roofY)
    const mid = new Vector3(C.x + stage.dx * stage.r, roofY + 0.6, C.z + stage.dz * stage.r)
    show = { t: 0, total, shots, shot: -1, actors, props, stage, mid, eye: new Vector3(), look: new Vector3(), fromEye: new Vector3(), fromLook: new Vector3(), blend: 1, lastSec: -1, ending: false, sparkT: 0 }
    sfx.duck(true)
    sfx.intro()
    onStart?.()
    return true
  }

  // Camera for the current shot into (eye, look).
  const tmpE = new Vector3()
  const tmpL = new Vector3()
  const D = new Vector3()
  const T = new Vector3()
  function shotPose(shot, k, eye, look) {
    const s = show.stage
    D.set(s.dx, 0, s.dz)
    T.set(s.tx, 0, s.tz)
    const half = Math.tan(((FINALE.fov / 2) * Math.PI) / 180)
    const aspect = camera.aspect || 1
    // Far enough back that the three podiums fit across (portrait phones need much more).
    const wideDist = Math.max(8.5, (FINALE.spacing + 2.4) / (half * aspect), 3.4 / half)
    if (shot.kind === 'close') {
      const a = shot.actor
      const h = a.head()
      const side = a.rank === 1 ? 1 : Math.sign(a.local.x * s.tx + a.local.z * s.tz) || 1
      const sc = Math.max(1, h / 2.05) * Math.max(1, 0.9 / aspect)
      const dist = (a.rank === 1 ? 6.2 - 1.4 * k : 5.4 - 0.9 * k) * sc
      const lat = (a.rank === 1 ? 1.4 - 2.2 * k : side * (1.3 - 0.7 * k)) * sc
      const lift = a.rank === 1 ? h * 0.55 : h * 0.75
      eye.copy(a.pos).addScaledVector(D, dist).addScaledVector(T, lat).addScaledVector(UP, lift)
      look.copy(a.pos).addScaledVector(UP, h * 0.78)
      return
    }
    // Wide (and the intro swooping down into it).
    const e = smooth(k)
    eye.copy(show.mid).addScaledVector(D, wideDist * (1.04 - 0.08 * k)).addScaledVector(T, Math.sin(k * 1.2 - 0.6) * 1.6).addScaledVector(UP, 1.7 + wideDist * 0.1)
    look.copy(show.mid).addScaledVector(UP, 1.7)
    if (shot.kind === 'intro') {
      tmpE.copy(show.mid).addScaledVector(D, wideDist * 2.6).addScaledVector(T, 9).addScaledVector(UP, 24)
      tmpL.copy(show.mid)
      eye.lerpVectors(tmpE, eye, e)
      look.lerpVectors(tmpL, look, e)
    }
  }

  function enterShot(i) {
    const shot = show.shots[i]
    show.shot = i
    show.fromEye.copy(show.eye)
    show.fromLook.copy(show.look)
    show.blend = i === 0 ? 1 : 0
    if (shot.kind === 'close') {
      sfx.whoosh(shot.actor.rank === 1)
      sfx.drumroll(FINALE.roll, shot.actor.rank)
      shot.revealAt = shot.t0 + FINALE.roll
    } else if (shot.kind === 'wide') {
      sfx.whoosh(true)
      sfx.cheer(3.2, 1.1)
      for (const a of show.actors) if (!a.revealed) reveal(a, true)
      for (let k = 0; k < 4; k++) setTimeout(() => show && fx.firework(show.mid.x + (Math.random() - 0.5) * 30, show.mid.y + 14 + Math.random() * 14, show.mid.z + (Math.random() - 0.5) * 30), k * 380)
    }
  }

  function reveal(a, quiet = false) {
    a.revealed = true
    a.flare = 1
    a.el.classList.add('show')
    a.inner.classList.remove('pop')
    void a.inner.offsetWidth
    a.inner.classList.add('pop')
    const p = a.pos
    const R = FINALE.ranks[a.rank]
    fx.confetti(p.x, p.y + 3.2, p.z, a.rank === 1 ? 160 : 80, 2.5)
    fx.sparks(p.x, p.y + 1.2, p.z, { count: a.rank === 1 ? 40 : 24, speed: 8, colors: [R.color, R.rim, '#ffffff'], size: 0.32, spread: 0.6 })
    fx.ring(p.x, p.y + 0.1, p.z, 0.6, a.rank === 1 ? 7 : 4.5, R.color, 0.8)
    const anim = a.animator()
    if (anim) {
      anim.overlay = a.channel.hook
      a.channel.play(CLIPS[CLIP_FOR[a.rank]])
    }
    if (quiet) return
    sfx.reveal(a.rank)
    sfx.cheer(a.rank === 1 ? 3 : 2, a.rank === 1 ? 1.2 : 0.75)
    if (a.rank === 1) {
      flashEl.classList.remove('go')
      void flashEl.offsetWidth
      flashEl.classList.add('go')
      show.props.crown.visible = true
      show.crownT = 0
      for (let k = 0; k < 5; k++) setTimeout(() => show && fx.firework(p.x + (Math.random() - 0.5) * 24, p.y + 10 + Math.random() * 12, p.z + (Math.random() - 0.5) * 24), 250 + k * 300)
    }
  }

  const scr = new Vector3()
  function placeCards(dt) {
    const w = window.innerWidth
    const hgt = window.innerHeight
    const topH = topBar.getBoundingClientRect().bottom
    const botH = botBar.getBoundingClientRect().top
    const shot = show.shots[show.shot]
    for (const a of show.actors) {
      if (!a.revealed) continue
      const focus = shot?.kind === 'close' ? shot.actor === a : false
      const want = focus ? 1 : shot?.kind === 'wide' ? (w < 700 ? 0.5 : 0.62) : 0.55
      a.scale += (want - a.scale) * (1 - Math.exp(-dt * 8))
      scr.copy(a.pos).addScaledVector(UP, a.head() + 0.35).project(camera)
      if (scr.z > 1 || Math.abs(scr.x) > 1.6) {
        a.el.style.visibility = 'hidden'
        continue
      }
      a.el.style.visibility = ''
      const cardH = (a.el.offsetHeight || 80) * a.scale
      const x = ((scr.x + 1) / 2) * w
      // The "#N" sticks out above the card by about half its height: keep it under the top bar.
      const y = clamp(((1 - scr.y) / 2) * hgt, topH + cardH * 1.55 + 8, botH - 8)
      a.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${a.scale.toFixed(3)})`
      a.el.style.zIndex = focus ? 3 : 4 - a.rank
    }
  }

  function update(dt) {
    if (pending >= 0) {
      pending -= dt
      if (pending < 0) {
        pending = -1
        if (!start()) flushLater()
      }
    }
    if (!show) return
    // The building is going away (or a new one started): the show is over.
    if (tower.phase !== 'celebrate') return finish(true)
    const S = show
    S.t = holdT != null ? Math.min(holdT, S.t + dt) : S.t + dt // dev: holdAt() freezes the show
    if (!S.ending && S.t >= S.total) return finish()
    // Shots.
    let i = S.shot
    while (i + 1 < S.shots.length && S.t >= S.shots[i + 1].t0) i++
    if (i !== S.shot) enterShot(i)
    const shot = S.shots[S.shot]
    if (shot.kind === 'close' && !shot.actor.revealed && S.t >= shot.revealAt) reveal(shot.actor)
    // Camera: each shot's pose, blended from wherever the last one left it (a swoop).
    const k = clamp((S.t - shot.t0) / (shot.t1 - shot.t0), 0, 1)
    shotPose(shot, k, tmpE, tmpL)
    S.blend = Math.min(1, S.blend + dt / 0.7)
    const e = smooth(S.blend)
    S.eye.lerpVectors(S.fromEye, tmpE, e)
    S.look.lerpVectors(S.fromLook, tmpL, e)
    camera.position.copy(S.eye)
    camera.lookAt(S.look)
    camera.updateMatrixWorld() // the cards project through it this frame (camera.js left the chase pose in it)
    if (Math.abs(camera.fov - FINALE.fov) > 0.01) {
      camera.fov = FINALE.fov
      camera.updateProjectionMatrix()
    }
    // Highlights: beams brighten on the reveal (the one in focus most), rings pulse.
    S.sparkT -= dt
    const sparkle = S.sparkT <= 0
    if (sparkle) S.sparkT = 0.3
    for (const a of S.actors) {
      a.flare = Math.max(0, a.flare - dt * 1.4)
      const focus = shot.kind === 'close' && shot.actor === a
      const base = a.revealed ? (focus || shot.kind === 'wide' ? 0.26 : 0.14) : 0.05
      a.beam.material.opacity = base + a.flare * 0.5
      a.ring.material.opacity = a.revealed ? 0.35 + 0.25 * Math.sin(S.t * 5 + a.rank) + a.flare * 0.4 : 0
      a.ring.rotation.z += dt * 0.8
      a.ring.scale.setScalar(1 + a.flare * 0.5)
      if (sparkle && a.revealed) {
        const R = FINALE.ranks[a.rank]
        fx.sparks(a.pos.x, a.pos.y + 0.1, a.pos.z, { count: a.rank === 1 ? 3 : 2, speed: 1.6, colors: [R.color, R.rim], size: 0.2, spread: 1.1 })
      }
    }
    // #1's crown, bobbing over the head.
    const top = S.actors[0]
    const crown = S.props.crown
    if (crown.visible && top) {
      S.crownT += dt
      const pop = Math.min(1, S.crownT / 0.45)
      const s = pop < 1 ? 1.4 * Math.sin(pop * Math.PI * 0.5) + (1 - pop) * 0.2 : 1
      const h = top.head()
      crown.scale.setScalar(Math.max(0.01, s) * (h / 2.05))
      crown.position.set(top.pos.x, top.pos.y + h + 0.1 + Math.sin(S.t * 3) * 0.05 + (1 - pop) * 1.2, top.pos.z)
      crown.rotation.y += dt * 1.2
    }
    // Overlay.
    placeCards(dt)
    const left = Math.max(0, Math.ceil(S.total - S.t))
    if (left !== S.lastSec) {
      S.lastSec = left
      watchNum.textContent = `${left}s`
      if (left <= 3 && left > 0 && !S.ending) sfx.tick(left === 1)
    }
  }

  function finish(abrupt = false) {
    const S = show
    if (!S || S.ending) return
    S.ending = true
    show = null
    for (const a of S.actors) {
      a.channel.stop()
      const anim = a.animator()
      if (anim && anim.overlay === a.channel.hook) anim.overlay = null
    }
    me.release()
    disposeTree(S.props.group)
    window.removeEventListener('keydown', onKeyDown, true)
    document.body.classList.remove('finale-on')
    root.classList.remove('on')
    root.classList.add('out')
    setTimeout(() => {
      if (!show) {
        root.hidden = true
        cardsEl.textContent = ''
      }
    }, 600)
    sfx.duck(false)
    if (!abrupt) sfx.outro()
    onEnd?.()
    flushLater()
  }

  function flushLater() {
    for (const [fn, ms] of later.splice(0)) setTimeout(fn, ms)
  }

  return {
    // A building was just finished: the show starts after FINALE.delay.
    queue() {
      if (!show) pending = FINALE.delay
    },
    // Run fn after `ms`, counted from the end of the show if one is coming or running.
    after(fn, ms = 0) {
      if (show || pending >= 0) later.push([fn, ms])
      else setTimeout(fn, ms)
    },
    update,
    skip: () => finish(),
    // Dev: freeze the running show once it reaches `t` s (null = play on).
    holdAt(t) {
      holdT = t
    },
    get time() {
      return show ? show.t : -1
    },
    get active() {
      return !!show
    },
  }
}
