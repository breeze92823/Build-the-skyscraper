import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three'
import { PLAYER_DIMS, ROBOT } from './config.js'
import { getYaw, shakeCamera } from './camera.js'
import { resetPlayer } from './player.js'
import { pointInPolygon } from './shapes.js'
import * as S from './stats.js'
import { makeDropship, makePod, wearGear } from './gear.js'
import { makeVehicle } from './vehicles.js'
import { robot as snd, sfx } from './audio/index.js'
import { inputState, onKey } from './input.js'
import { flash } from './juice.js'
import { createParachute } from './parachute.js'
import { createImpact } from './impact.js'

// The local player's Robot Gear: buying / wearing at the hall pedestals (E or tap the prompt),
// the suit-up (a beam of light, every armour piece flying in and locking on with a clank and
// sparks, a power chord and the stats popping up), and what the gear does while worn:
//  - full suits are a 2x giant robot the (unscaled) player pilots; they stomp (dust + thuds),
//  - Jet Boots, the Black Mech Suit and Titan Armor fly (hold Jump), with thruster flames, spark
//    and smoke trails, a take-off blast, a superhero lean and a landing slam,
//  - Robotic Arms walk on their claws and weld while you build; gauntlets zap at work,
//  - G / the touch gear button: transformers build their vehicle piece by piece out of the robot
//    (and fold it back in), then drive on sprung suspension (wheels spin and steer, the body
//    squats, dives and rolls, exhaust smoke, wheel dust, tyre screech, gear shifts); the Jet
//    Transformer flies. Titan Armor calls a dropship that drops the armour in a pod with a ground
//    slam and a timed build-speed boost.
//  - dropping off the tower in gear ends in a superhero landing on the leg shock absorbers (impact.js);
//    without gear a parachute opens instead (parachute.js).

const { state } = S
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const backOut = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const FLAME = ['#ffd27a', '#ff8a1a', '#fff6d8']

export function createRobotPlayer({ scene, hall, tower, interact, hud, fx, say, player, playerGroup, getAvatar, popAtPlayer }) {
  // --- Worn gear on the avatar (rebuilt when the avatar is swapped) ----------------------------------
  let worn = null
  let wornAvatar = null
  let wornId = null
  let suit = null // { k, dur, off }
  let landedCount = 0
  let size = 1 // the worn suit's size in robot form (name tag, particles)

  // Beam of light for the suit-up, and the Titan boost aura.
  const pillarMat = new MeshBasicMaterial({ color: '#7dffe4', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
  const pillar = new Mesh(new CylinderGeometry(1.5, 1.9, 16, 28, 1, true), pillarMat)
  pillar.visible = false
  scene.add(pillar)
  const auraMat = new MeshBasicMaterial({ color: '#ff3a3a', transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
  const aura = new Mesh(new RingGeometry(1.1, 1.7, 40), auraMat)
  aura.rotation.x = -Math.PI / 2
  aura.visible = false
  scene.add(aura)

  function dropWorn() {
    worn?.remove()
    worn = null
    wornAvatar = null
    wornId = null
  }
  // k = assembly progress to start at; merged = straight to the final (merged) model.
  function putOn(id, k = 1, merged = false) {
    const av = getAvatar()
    if (!av || !id) return
    worn = wearGear(av, id, { merge: merged })
    wornAvatar = av
    wornId = id
    if (!merged) worn.assemble(k)
  }
  const chest = () => {
    const p = player.renderPosition
    return [p.x, p.y + 1.2 * size, p.z]
  }

  function startSuitUp(def, dur = ROBOT.suitUp) {
    suit = { k: 0, dur, off: false }
    landedCount = 0
    pillarMat.color.set(def.glow)
    pillar.visible = true
    snd.suitStart()
    const [x, y, z] = chest()
    fx.ring(x, y - 1.1, z, 0.5, 5 * (def.size ?? 1), def.glow, 0.8)
    fx.sparks(x, y, z, { count: 30, colors: [def.glow, '#ffffff'], speed: 6, size: 0.4 })
  }
  function finishSuitUp(def) {
    snd.powerUp()
    const [x, y, z] = chest()
    fx.sparks(x, y + 0.4, z, { count: 70, colors: [def.glow, def.color, '#ffffff'], speed: 9, size: 0.55, life: 1.2 })
    fx.ring(x, y - 1.1, z, 1, 9 * (def.size ?? 1), def.glow, 0.9)
    hud.banner(`${def.name.toUpperCase()} EQUIPPED!`, def.glow, 2.6)
    const chips = [`${def.blocks}x Blocks Placed`, `${def.build}x Build Speed`, `+${def.walk} Walk Speed`, `+${S.short(def.capacity)} Capacity`]
    chips.forEach((c, i) => setTimeout(() => popAtPlayer(c, i % 2 ? '#7dffe4' : '#ffd23a', true), 120 + i * 220))
    const tips = []
    if (def.fly) tips.push('Hold Jump to fly!')
    if (def.ability === 'drop') tips.push('G / the gear button calls the dropship!')
    else if (def.ability) tips.push('G / the gear button to transform!')
    if (tips.length) setTimeout(() => say(tips.join(' '), true), 1100)
  }

  // A reward unlocked a piece (owned, not worn): only the hall's cards change.
  S.on('gearOwned', () => hall.refresh())
  // Gear changed (bought, worn, taken off), from the pedestals or anywhere else.
  S.on('gear', (id) => {
    hall.refresh()
    S.boosts.gearBuild = 1
    boostT = 0
    if (form !== 'robot' || tf) toRobot(true)
    if (id) {
      dropWorn()
      putOn(id, 0)
      startSuitUp(S.gearDef(id))
    } else if (worn) {
      // Take-off: rebuild unmerged so the pieces can fly away.
      const was = wornId
      dropWorn()
      putOn(was, 1)
      suit = { k: 1, dur: 0.5, off: true }
      snd.powerDown()
    }
  })

  // --- Pedestals -----------------------------------------------------------------------------------------
  for (const p of hall.pedestals) {
    const d = p.def
    interact.add({
      x: p.x,
      z: p.z,
      y: p.top + 1.2,
      r: p.r + 3,
      info() {
        const owned = !!state.gear.owned[d.id]
        if (state.gear.on === d.id) return { title: d.name, verb: 'Take Off' }
        if (owned) return { title: d.name, verb: 'Wear' }
        return { title: d.name, verb: 'Buy', price: `$${S.short(d.price)}`, short: state.cash < d.price }
      },
      run() {
        if (!state.gear.owned[d.id]) {
          const r = S.buyGear(d.id)
          if (r.need) {
            sfx.deny()
            hud.shake('cash')
            say(`Need $${S.short(r.need)} more!`, false)
          } else if (r.done) {
            sfx.purchase()
            flash('gold')
            say(`${d.name} unlocked!`, true)
          }
          return
        }
        S.wearGear(d.id)
      },
    })
  }

  // --- Transform (robot <-> vehicle) ----------------------------------------------------------------------
  let form = 'robot'
  let tf = null // { t, dur, to, avatar, base }
  let vehicle = null
  const vehicleHolder = new Group()
  playerGroup.add(vehicleHolder)
  let pendingFinalize = 0
  const v = new Vector3()

  function newVehicle(def) {
    const ve = makeVehicle(def.vehicle, ROBOT.vehicleScale[def.vehicle] ?? 0.55)
    ve.kindId = def.vehicle
    vehicleHolder.add(ve.group)
    return ve
  }
  function startTransform(toVehicle) {
    const def = S.gearOn()
    if (!def?.vehicle) return
    const av = getAvatar()
    if (vehicle) vehicleHolder.remove(vehicle.group)
    vehicle = newVehicle(def) // unmerged: every piece can fly
    vehicle.assemble(toVehicle ? 0 : 1)
    const dur = toVehicle ? ROBOT.transformTime : ROBOT.foldTime
    tf = { t: 0, dur, to: toVehicle ? 'vehicle' : 'robot', avatar: av, base: av ? av.scale.x : 1, clicks: 0 }
    snd.transform(toVehicle, dur)
    const [x, y, z] = chest()
    fx.sparks(x, y, z, { count: 40, colors: [def.glow, '#ffffff', '#ffd23a'], speed: 7, size: 0.45 })
    fx.ring(x, player.renderPosition.y + 0.2, z, 0.6, 7, def.glow, 0.7)
  }
  // Back to the robot; `now` skips the animation (elevator, gym, gear change).
  function toRobot(now = false) {
    if (now) {
      if (tf?.avatar) tf.avatar.scale.setScalar(tf.base)
      tf = null
      if (vehicle) vehicleHolder.remove(vehicle.group)
      vehicle = null
      form = 'robot'
      const av = getAvatar()
      if (av) av.visible = true
      player.fly = null
      return
    }
    startTransform(false)
  }
  function updateTransform(dt) {
    tf.t += dt / tf.dur
    const t = clamp01(tf.t)
    const def = S.gearOn()
    const toV = tf.to === 'vehicle'
    const A = tf.avatar
    if (toV) {
      // Robot crouches (servos), then folds away into the vehicle building around it.
      const crouch = clamp01(t / 0.3)
      const fold = clamp01((t - 0.25) / 0.35)
      if (A) {
        const sxz = tf.base * (1 + 0.1 * crouch) * Math.max(0.001, 1 - fold)
        A.scale.set(sxz, tf.base * (1 - 0.3 * crouch) * Math.max(0.001, 1 - fold), sxz)
        A.visible = fold < 1
      }
      vehicle.assemble(clamp01((t - 0.12) / 0.78))
      vehicleHolder.rotation.y = (1 - easeOut(t)) * 0.5
    } else {
      // Vehicle folds back into the middle, the robot unfolds out of it and stands up.
      vehicle.assemble(1 - clamp01(t / 0.7))
      const grow = clamp01((t - 0.35) / 0.55)
      if (A) {
        A.visible = grow > 0
        const s = tf.base * Math.max(0.001, backOut(grow))
        A.scale.set(s, s, s)
      }
      vehicleHolder.rotation.y = easeOut(t) * -0.5
    }
    // Pieces locking into place: clicks and sparks.
    const n = vehicle.landed()
    for (let i = 0; i < n; i++) {
      tf.clicks++
      if (tf.clicks % 3 === 0) snd.lockIn(tf.clicks / 3)
      if (tf.clicks % 2 === 0) {
        const P = player.renderPosition
        fx.sparks(P.x + (Math.random() - 0.5) * 3, P.y + 0.5 + Math.random() * 1.8, P.z + (Math.random() - 0.5) * 4, { count: 4, colors: [def?.glow ?? '#ffffff', '#ffffff', '#ffd23a'], speed: 4, size: 0.3, life: 0.45 })
      }
    }
    if (tf.t < 1) return
    if (A) A.scale.setScalar(tf.base)
    form = tf.to
    vehicleHolder.rotation.y = 0
    const P = player.renderPosition
    if (form === 'vehicle') {
      // Drops onto its springs, lights blink on, engine starts with a puff of smoke.
      phys.hv -= 1.6
      vehicle.flash()
      snd.engineStart(vehicle.kindId)
      for (const m of vehicle.points.exhaust) {
        m.getWorldPosition(v)
        fx.dust(v.x, v.y, v.z, { count: 4, size: 0.5, grow: 4, life: 1.4, color: '#3d4046', alpha: 0.5, rise: 2, spread: 0.1, push: 0.4, height: 0 })
      }
      fx.dust(P.x, P.y + 0.1, P.z, { count: 10, size: 1.4, grow: 2.2, life: 1, spread: 2, push: 3, alpha: 0.35, color: '#d9c7ad', height: 0 })
      pendingFinalize = 0.7
    } else {
      vehicleHolder.remove(vehicle.group)
      vehicle = null
      if (A) A.visible = true
      robotPhys.hv += 1.2 // springs up out of the crouch
      snd.stomp(size)
      fx.ring(P.x, P.y + 0.15, P.z, 0.5, 5, def?.glow ?? '#ffffff', 0.5)
    }
    tf = null
  }

  // --- Titan Armor: the dropship --------------------------------------------------------------------------
  let drop = null // { phase, t, ship, pod, from }
  let dropCd = 0
  let boostT = 0
  const hover = new Vector3()
  function callDropship() {
    if (drop) return
    if (dropCd > 0) {
      sfx.deny()
      say(`Dropship ready in ${Math.ceil(dropCd)}s`, false)
      return
    }
    dropCd = ROBOT.drop.cooldown
    const ship = makeDropship()
    scene.add(ship.group)
    const pod = makePod()
    pod.visible = false
    scene.add(pod)
    const p = player.position
    drop = { phase: 'in', t: 0, ship, pod, from: new Vector3(p.x - 110, p.y + 90, p.z - 70) }
    snd.shipIn()
    hud.banner('DROPSHIP INCOMING!', '#ff3a3a', 2)
  }
  function updateDrop(dt) {
    if (!drop) return
    const P = player.renderPosition
    hover.set(P.x, P.y + 15 + 4 * (size - 1), P.z)
    const D = ROBOT.drop
    const ship = drop.ship.group
    drop.t += dt
    drop.ship.update(dt)
    if (drop.phase === 'in') {
      const k = clamp01(drop.t / D.hover)
      const e = easeOut(k)
      ship.position.lerpVectors(drop.from, hover, e)
      ship.rotation.set(0.25 * (1 - e), Math.atan2(hover.x - drop.from.x, hover.z - drop.from.z), Math.sin(drop.t * 2) * 0.05)
      if (k >= 1) {
        drop.phase = 'release'
        drop.t = 0
        if (wornId === 'titan') dropWorn() // the armour goes into the pod
        drop.pod.visible = true
        snd.podFall()
      }
    } else if (drop.phase === 'release') {
      ship.position.copy(hover)
      ship.position.y += Math.sin(drop.t * 3) * 0.2
      const k = clamp01(drop.t / D.fallTime)
      drop.pod.position.set(P.x, hover.y - 1.8 - (hover.y - 1.8 - P.y) * k * k, P.z)
      drop.pod.rotation.y = drop.t * 6
      if (Math.random() < dt * 30) fx.sparks(P.x, drop.pod.position.y + 2.8, P.z, { count: 2, colors: ['#ff3a3a', '#ffd23a'], speed: 1.5, up: 3, size: 0.45, life: 0.5 })
      if (k >= 1) {
        drop.phase = 'out'
        drop.t = 0
        drop.pod.visible = false
        snd.slam()
        flash('edge')
        fx.ring(P.x, P.y + 0.25, P.z, 1, 16, '#ff3a3a', 0.9)
        fx.ring(P.x, P.y + 0.3, P.z, 0.5, 10, '#ffd23a', 0.7)
        fx.sparks(P.x, P.y + 0.6, P.z, { count: 90, colors: ['#ff3a3a', '#ffd23a', '#ffffff'], speed: 12, size: 0.6, flat: true })
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          fx.dust(P.x + Math.cos(a) * 2.5, P.y + 0.1, P.z + Math.sin(a) * 2.5, { count: 4, size: 2.2, grow: 2.2, life: 1.4, spread: 1, push: 4, alpha: 0.5 })
        }
        if (state.gear.on === 'titan') {
          dropWorn()
          putOn('titan', 0)
          suit = { k: 0, dur: 0.75, off: false }
          landedCount = 0
        }
        robotPhys.hv -= 2
        S.boosts.gearBuild = D.boost
        boostT = D.boostTime
        hud.banner(`TITAN POWER! ${D.boost}x BUILD SPEED`, '#ff3a3a', 2.8)
      }
    } else {
      const k = drop.t / 2.4
      ship.position.copy(hover).add(new Vector3(40 * k * k, 70 * k * k, 30 * k * k))
      ship.rotation.x = -0.3 * k
      if (k >= 1) {
        scene.remove(ship)
        scene.remove(drop.pod)
        drop = null
      }
    }
  }

  // --- Ability (G / touch gear button) ---------------------------------------------------------------------
  function ability() {
    const def = S.gearOn()
    if (!def?.ability) {
      if (def?.fly) say(`${def.name}: hold Jump to fly!`, true)
      else if (def) say(`${def.name} has no special move. Transformers and Titan Armor do!`, false)
      return
    }
    if (suit) return
    if (def.ability === 'drop') return callDropship()
    if (tf) return
    if (player.locked) {
      say("You can't transform here!", false)
      sfx.deny()
      return
    }
    startTransform(form === 'robot')
  }
  onKey('KeyG', ability)

  // Key hints (desktop, in the HUD's key list) and the touch button's label.
  const keyList = document.querySelector('.hud-keys')
  const hint = document.createElement('div')
  hint.hidden = true
  hint.innerHTML = '<b>G</b> <span></span>'
  const flyHint = document.createElement('div')
  flyHint.hidden = true
  flyHint.innerHTML = '<b>Space</b> Hold to fly'
  keyList?.prepend(hint, flyHint)
  const hintText = hint.querySelector('span')
  let shownHint = ''
  function updateHint() {
    const def = S.gearOn()
    let text = ''
    let short = ''
    if (def?.ability === 'drop') {
      text = dropCd > 0 ? `Titan Drop (${Math.ceil(dropCd)}s)` : 'Titan Drop'
      short = dropCd > 0 ? `${Math.ceil(dropCd)}s` : 'DROP'
    } else if (def?.ability) {
      const jet = def.ability === 'fly'
      text = form === 'vehicle' ? 'Robot Mode' : jet ? 'Jet Mode' : 'Transform'
      short = form === 'vehicle' ? 'ROBOT' : jet ? 'JET' : 'DRIVE'
    }
    const canFly = !!player.fly
    const key = `${text}|${short}|${canFly}`
    if (key === shownHint) return
    shownHint = key
    hint.hidden = !text
    hintText.textContent = text
    flyHint.hidden = !canFly
    document.body.classList.toggle('gear-ability', !!text)
    const btn = document.querySelector('.touch-btn.ability')
    if (btn) btn.textContent = short || 'G'
  }

  // --- Physics: springs on the vehicle body and the robot ------------------------------------------------------
  // Each axis is a damped spring toward a target set from the motion (squat on acceleration, dive
  // on braking, roll out of turns, lean / bank in flight, dips on footsteps and landings).
  const SP = ROBOT.spring
  const phys = { pitch: 0, pv: 0, roll: 0, rv: 0, heave: 0, hv: 0, steer: 0 } // vehicle body
  const robotPhys = { pitch: 0, pv: 0, roll: 0, rv: 0, heave: 0, hv: 0 } // the robot (playerGroup)
  const motion = { fwd: 0, lastFwd: 0, accel: 0, yawRate: 0, lastFacing: player.facing, lastVy: 0, gear: 0 }
  function springStep(o, key, vkey, target, dt, k = SP.k, c = SP.damp) {
    const a = -k * (o[key] - target) - c * o[vkey]
    o[vkey] += a * dt
    o[key] += o[vkey] * dt
  }
  function readMotion(dt) {
    const f = player.facing
    const fwd = player.velocity.x * Math.sin(f) + player.velocity.z * Math.cos(f)
    const a = (fwd - motion.lastFwd) / Math.max(dt, 1e-3)
    motion.accel += (clamp(a, -60, 60) - motion.accel) * Math.min(1, dt * 8)
    motion.lastFwd = fwd
    motion.fwd = fwd
    const yr = Math.atan2(Math.sin(f - motion.lastFacing), Math.cos(f - motion.lastFacing)) / Math.max(dt, 1e-3)
    motion.yawRate += (clamp(yr, -8, 8) - motion.yawRate) * Math.min(1, dt * 8)
    motion.lastFacing = f
  }

  // --- Particles ---------------------------------------------------------------------------------------------
  let trailT = 0
  let smokeN = 0
  let stepAcc = 0
  let stepIdx = 0
  let stepPhase = 0
  let workT = 0
  let speedT = 0
  let exhaustT = 0
  let dustT = 0
  let chirpT = 4
  let wasGrounded = true
  let airTime = 0
  let lastAir = 0
  let lastJump = false
  function flameTrail(flames, thrust, scale = 1) {
    smokeN++
    for (let i = 0; i < flames.length && i < 6; i++) {
      const f = flames[i]
      if (!f.visible) continue
      f.getWorldPosition(v)
      fx.sparks(v.x, v.y - 0.15, v.z, { count: thrust > 0.7 ? 3 : 1, speed: 2.2, up: -6 * thrust - 2, gravity: -2, drag: 2.2, size: 0.38 * scale, life: 0.35, colors: FLAME, intensity: 3.6 })
      if (smokeN % 3 === 0) fx.dust(v.x, v.y - 0.5, v.z, { count: 1, size: 0.45 * scale, grow: 3, life: 0.9, color: '#dfe3e8', alpha: 0.26, rise: 0.4, spread: 0.1, push: 0.25, height: 0 })
    }
  }
  function burstAtFeet(color, n, big) {
    const P = player.renderPosition
    fx.ring(P.x, P.y + 0.15, P.z, 0.4, (big ? 6 : 4) * size, color, 0.5)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      fx.dust(P.x + Math.cos(a) * 0.8 * size, P.y + 0.05, P.z + Math.sin(a) * 0.8 * size, { count: 2, size: 1.1 * size, grow: 2.2, life: 0.9, spread: 0.3, push: 3, alpha: 0.4, color: '#d9c7ad', height: 0 })
    }
  }
  function footDust(n = 3) {
    const feet = worn?.points.feet
    if (!feet?.length) return
    const f = feet[stepIdx++ % feet.length]
    f.getWorldPosition(v)
    fx.dust(v.x, Math.max(player.renderPosition.y, v.y - 0.2), v.z, { count: n, size: 0.8 * size, grow: 2.4, life: 0.8, spread: 0.4 * size, push: 1.6, alpha: 0.4, color: '#d2bfa3', height: 0 })
  }
  function sparkAt(list, colors, count = 4) {
    if (!list?.length) return
    const o = list[Math.floor(Math.random() * list.length)]
    o.getWorldPosition(v)
    fx.sparks(v.x, v.y, v.z, { count, colors, speed: 4, size: 0.3, life: 0.4, intensity: 3.5 })
  }

  // --- Climbing (Spider Arms) -----------------------------------------------------------------------------
  // Walk into the tower's wall to latch on; forward / back climbs, strafe moves along the wall, Jump kicks
  // off, and reaching the roof hauls you over the parapet onto it. The legs claw up the glass in two
  // alternating groups; each bite throws glass sparks and a tick.
  const CL = ROBOT.climb
  let mantle = null // { t, from, to, facing }
  let climbBlend = 0
  let climbPhase = 0
  let gaitCount = 0
  let carryLift = 0
  let hintedClimb = false
  function nearestWall(x, z) {
    const C = tower.center
    const pts = tower.spec.pts
    const lx = x - C.x
    const lz = z - C.z
    let best = Infinity
    let bx = 0
    let bz = 0
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i]
      const [cx2, cz2] = pts[(i + 1) % pts.length]
      const ex = cx2 - ax
      const ez = cz2 - az
      const t = clamp(((lx - ax) * ex + (lz - az) * ez) / (ex * ex + ez * ez || 1), 0, 1)
      const px = ax + ex * t
      const pz = az + ez * t
      const d = Math.hypot(lx - px, lz - pz)
      if (d < best) {
        best = d
        bx = px
        bz = pz
      }
    }
    const inside = pointInPolygon(lx, lz, pts)
    let nx = (lx - bx) / (best || 1)
    let nz = (lz - bz) / (best || 1)
    if (inside) {
      nx = -nx
      nz = -nz
    }
    return { d: best, nx, nz, inside, px: bx + C.x, pz: bz + C.z }
  }
  function latch(w) {
    player.climb = { nx: w.nx, nz: w.nz, speed: CL.speed }
    player.velocity.x = player.velocity.y = player.velocity.z = 0
    snd.latch()
    const P = player.renderPosition
    fx.sparks(w.px, P.y + 1.4, w.pz, { count: 24, colors: ['#ffffff', '#bfefff', '#ff3a4a'], speed: 5, size: 0.35, life: 0.5 })
    if (!hintedClimb) {
      hintedClimb = true
      say('Climbing! Forward = up, sideways = along the wall, Jump = let go', true)
    }
  }
  function detach() {
    if (!player.climb) return
    player.climb = null
    snd.release()
  }
  function startMantle(w) {
    player.climb = null
    const y = tower.roofY + 0.05
    mantle = {
      t: 0,
      from: { x: player.position.x, y: player.position.y, z: player.position.z },
      to: { x: w.px - w.nx * CL.inward, y, z: w.pz - w.nz * CL.inward },
      edge: { x: w.px, z: w.pz },
      facing: Math.atan2(-w.nx, -w.nz),
    }
    player.locked = true
    player.hold = { ...mantle.from }
    snd.mantle()
  }
  function updateMantle(dt) {
    mantle.t += dt / CL.mantleTime
    const k = clamp01(mantle.t)
    const { from, to, edge } = mantle
    const top = to.y + 1.6
    if (k < 0.55) {
      // Pull up the last of the wall to above the parapet.
      const e = easeOut(k / 0.55)
      player.hold.x = from.x
      player.hold.z = from.z
      player.hold.y = from.y + (top - from.y) * e
    } else {
      // Swing over the edge and drop onto the roof.
      const e = easeOut((k - 0.55) / 0.45)
      player.hold.x = from.x + (to.x - from.x) * e
      player.hold.z = from.z + (to.z - from.z) * e
      player.hold.y = top + (to.y - top) * e * e
    }
    player.facing = mantle.facing
    if (k >= 1) {
      player.locked = false
      player.hold = null
      resetPlayer(to, mantle.facing)
      fx.dust(edge.x, to.y + 0.1, edge.z, { count: 10, size: 1.2, grow: 2.2, life: 1, spread: 1.5, push: 2.5, alpha: 0.4, color: '#d9d2c4', height: 0 })
      fx.sparks(to.x, to.y + 0.3, to.z, { count: 30, colors: ['#ff3a4a', '#ffffff'], speed: 6, size: 0.4, flat: true })
      fx.ring(to.x, to.y + 0.2, to.z, 0.5, 6, '#ff3a4a', 0.6)
      snd.stomp(1.2)
      hud.banner('ON THE ROOF!', '#ff3a4a', 1.6)
      mantle = null
    }
  }
  // Each half gait cycle one group of legs plants: dust on the ground, sparks on the glass.
  function legPlants(phase, onWall) {
    const k = Math.floor(phase / Math.PI)
    if (k === gaitCount) return
    gaitCount = k
    const claws = worn?.points.claws
    if (!claws?.length) return
    const parity = k % 2 === 0 ? 1 : 0
    let n = 0
    for (let i = parity; i < claws.length; i += 2) {
      claws[i].getWorldPosition(v)
      if (onWall) {
        if (n++ < 3) fx.sparks(v.x, v.y, v.z, { count: 5, colors: ['#ffffff', '#bfefff', '#9fdcff'], speed: 3.5, size: 0.28, life: 0.4 })
        if (Math.random() < 0.3) fx.dust(v.x, v.y - 0.2, v.z, { count: 1, size: 0.4, grow: 1.8, life: 1.2, rise: -1.5, alpha: 0.3, color: '#cfd6de', height: 0 })
      } else if (v.y < player.renderPosition.y + 1.5 && n++ < 3) {
        fx.dust(v.x, player.renderPosition.y + 0.05, v.z, { count: 2, size: 0.8, grow: 2.2, life: 0.8, spread: 0.3, push: 1.2, alpha: 0.38, color: '#d2bfa3', height: 0 })
      }
    }
    if (onWall) snd.clawGlass((Math.random() - 0.5) * 0.6)
    else {
      snd.clawStep()
      if (Math.random() < 0.35) snd.servo(Math.random() < 0.5, 0.15)
    }
  }

  // --- Per frame ------------------------------------------------------------------------------------------------
  // --- Big drops: a parachute without gear, a superhero landing in it ------------------------------------
  const IMP = ROBOT.impact
  let impact = null // { t, hold, risen }
  const impactFx = createImpact({ scene, fx, snd, flash, shake: shakeCamera })
  const me = {
    get pos() {
      return player.renderPosition
    },
    get facing() {
      return player.facing
    },
  }
  const impactDepth = () => {
    if (!impact) return 0
    const t = impact.t
    if (t < IMP.down) return easeOut(t / IMP.down)
    if (t < impact.hold) return 1
    const k = clamp01((t - impact.hold) / IMP.rise)
    return 1 - k * k * (3 - 2 * k)
  }
  let chuteTipped = false
  const chute = createParachute({
    scene,
    playerGroup,
    player,
    fx,
    snd,
    onDeploy() {
      if (chuteTipped) return
      chuteTipped = true
      setTimeout(() => say('Parachute open! Steer to pick your landing spot.', true), 600)
    },
  })

  let refreshT = 0
  let flyThrust = 0 // the thrusters' power this frame (the pose act 'fly' tells the others)
  const flyCache = new Map()
  const flyParams = (def) => flyCache.get(def.id) ?? flyCache.set(def.id, { climb: def.fly.climb, sink: def.fly.sink, dive: def.fly.dive ?? ROBOT.fly.dive, accel: ROBOT.flyAccel, maxY: ROBOT.flyMaxY }).get(def.id)
  return {
    ability,
    get form() {
      return form
    },
    // Walk speed multiplier (vehicle form is faster).
    speedMul: () => (form === 'vehicle' && !tf ? ROBOT.vehicleSpeed : 1) * (impact && impact.t < impact.hold ? IMP.slow : 1),
    // 0..1 how deep the superhero-landing crouch is (the animator's `impact` pose).
    impactDepth: () => (S.gearOn()?.carry ? 0 : impactDepth()),
    // The superhero-landing effects, shared so other players' landings (act "impact") can play them:
    // impactFx.land(target, p, size, glow, { vol, shakeK, big }), .rise(target, size, vol); target =
    // { pos: feet {x, y, z} (read live), facing }.
    impactFx,
    // How tall the worn robot is compared to the player (name tag height).
    bodyScale: () => size + carryLift / 2.5,
    // The player's own legs stand still (Spider Arms carry them).
    legsIdle: () => form === 'robot' && !!worn && !!S.gearOn()?.carry && !suit && !chute.active,
    // What the others should draw of us (the pose `act` net.js sends; backend POSE_ACTS), '' = nothing special.
    poseAct() {
      if (chute.active) return 'chute'
      if (!S.gearOn()?.carry && impactDepth() > 0) return 'impact'
      if (player.climb || mantle) return 'climb'
      if (form === 'vehicle' && !tf) return vehicle?.kind === 'jet' && !player.grounded ? 'jet' : 'vehicle'
      if (form === 'robot' && worn && flyThrust > 0.04) return 'fly'
      return ''
    },
    // Hanging under the parachute (the animator's harness pose) and how far the toggles are pulled.
    chuting: () => chute.active,
    chuteFlare: () => chute.flare,
    // ctx: { building, collecting, training }
    update(dt, elapsed, ctx = {}) {
      if (!(dt > 0)) return
      const av = getAvatar()
      // The avatar was swapped (avatar loaded / changed): dress the new one, no animation.
      if (worn && wornAvatar !== av) {
        const id = wornId
        dropWorn()
        if (!suit?.off) putOn(id, 1, true)
        suit = null
      } else if (!worn && state.gear.on && av && !suit && drop?.phase !== 'release') putOn(state.gear.on, 1, true)

      // Suit-up / take-off animation.
      if (suit && worn) {
        suit.k += (suit.off ? -dt : dt) / suit.dur
        worn.assemble(clamp01(suit.k))
        const n = worn.landed()
        for (let i = 0; i < n; i++) {
          snd.lockIn(landedCount++)
          const [x, y, z] = chest()
          fx.sparks(x + (Math.random() - 0.5) * 1.2 * size, y + (Math.random() - 0.3) * 1.4 * size, z + (Math.random() - 0.5) * 1.2 * size, { count: 8, colors: [S.gearDef(wornId)?.glow ?? '#ffffff', '#ffffff'], speed: 4, size: 0.3, life: 0.5 })
        }
        if (!suit.off && suit.k >= 1) {
          const def = S.gearDef(wornId)
          suit = null
          worn.finalize()
          if (def) finishSuitUp(def)
        } else if (suit?.off && suit.k <= 0) {
          suit = null
          dropWorn()
        }
      }
      // Beam fades out over the suit-up.
      if (pillar.visible) {
        const k = suit && !suit.off ? suit.k : 1.2
        pillarMat.opacity = Math.max(0, 0.55 * (1 - Math.max(0, k - 0.6) / 0.6)) * (0.8 + Math.sin(elapsed * 30) * 0.2)
        const P = player.renderPosition
        pillar.position.set(P.x, P.y + 8, P.z)
        const w = (worn?.size ?? 1) * (1 + Math.sin(elapsed * 8) * 0.06)
        pillar.scale.set(w, 1, w)
        if (pillarMat.opacity <= 0.001) pillar.visible = false
      }

      // Riding the elevator / on a gym machine: back to the robot (and out of a giant suit).
      if (player.locked && (form !== 'robot' || tf)) toRobot(true)
      worn?.setPiloted(!ctx.training)

      if (tf) updateTransform(dt)
      if (form === 'vehicle' && !tf && av) av.visible = false
      if (pendingFinalize > 0) {
        pendingFinalize -= dt
        if (pendingFinalize <= 0 && vehicle && form === 'vehicle' && !tf) vehicle.finalize()
      }

      const def = S.gearOn()
      size = worn && form === 'robot' && !ctx.training ? worn.size : 1

      // Flying: the jet, or gear that flies in robot form.
      const jet = form === 'vehicle' && !tf && vehicle?.kind === 'jet'
      player.fly = jet ? ROBOT.fly : form === 'robot' && !tf && worn && def?.fly ? flyParams(def) : null
      document.body.classList.toggle('flying', !!player.fly) // shows the touch DOWN button

      readMotion(dt)

      // Climbing: latch, follow the wall, let go, haul over the top.
      const canClimb = !!def?.climb && form === 'robot' && !tf && !suit && !ctx.training && !tower.sinking && tower.phase !== 'sinking'
      if (player.climbJump) {
        player.climbJump = false
        snd.release()
        const P = player.renderPosition
        fx.sparks(P.x, P.y + 1.2, P.z, { count: 16, colors: ['#ffffff', '#ff3a4a'], speed: 5, size: 0.3, life: 0.4 })
      }
      if (mantle) updateMantle(dt)
      else if (player.climb) {
        const w = nearestWall(player.position.x, player.position.z)
        if (!canClimb || player.locked || w.inside || w.d > CL.detach || (player.grounded && inputState.move.z < -0.2)) detach()
        else {
          player.climb.nx = w.nx
          player.climb.nz = w.nz
          player.climb.speed = Math.max(CL.speed, player.walkSpeed * 0.45)
          if (player.position.y >= tower.roofY - CL.mantleAt) startMantle(w)
        }
      } else if (canClimb && !player.locked && player.position.y < tower.roofY - 1.5) {
        const w = nearestWall(player.position.x, player.position.z)
        const mv = inputState.move
        if (!w.inside && w.d < CL.reach && Math.hypot(mv.x, mv.z) > 0.3) {
          const yaw = getYaw()
          const wx = -Math.sin(yaw) * mv.z + Math.cos(yaw) * mv.x
          const wz = -Math.cos(yaw) * mv.z - Math.sin(yaw) * mv.x
          if ((wx * -w.nx + wz * -w.nz) / Math.hypot(wx, wz) > 0.55) latch(w)
        }
      }
      const climbing = !!player.climb || !!mantle
      climbBlend += ((climbing ? 1 : 0) - climbBlend) * Math.min(1, dt * 6)
      if (player.climb) climbPhase += (dt * (Math.abs(player.velocity.y) + Math.abs(inputState.move.x) * 5) * Math.PI) / CL.gait
      if (mantle) climbPhase += dt * 8

      // No gear: the parachute may open. In gear: free fall (the rush and streaks) and a hard landing.
      chute.update(dt, elapsed, {
        allowed: !worn && !state.gear.on && !suit && form === 'robot' && !tf && !player.fly && !climbing && !player.locked && !ctx.training,
        s: size,
        glow: def?.glow,
      })

      const moving = Math.hypot(player.velocity.x, player.velocity.z)
      const airborne = !player.grounded
      airTime = airborne ? airTime + dt : 0
      const landedHard = !wasGrounded && player.grounded && lastAir > 0.35 && motion.lastVy < -6 ? Math.min(3, -motion.lastVy / 10) : 0
      // Superhero landing: gear soaks up a big drop (knee down, cracked ground, rubble, steam from the legs).
      const bigFall = !wasGrounded && player.grounded && form === 'robot' && !!worn && !suit && !tf && motion.lastVy < -IMP.minVy
      if (bigFall) {
        const p = clamp((-motion.lastVy - IMP.minVy) / IMP.range, 0, 1)
        impact = { t: 0, hold: IMP.hold + IMP.holdExtra * p, risen: false }
        impactFx.land(me, p, size, def?.glow ?? '#ffffff')
        robotPhys.hv -= (0.8 + p) * size
      }
      if (impact) {
        impact.t += dt
        if (airborne || player.locked || !worn) impact = null
        else {
          if (!impact.risen && impact.t >= impact.hold) {
            impact.risen = true
            impactFx.rise(me, size)
          }
          if (impact.t >= impact.hold + IMP.rise) impact = null
        }
      }
      impactFx.update(dt)

      // --- Robot form: lean, bank, hover, stomps.
      let thrust = 0
      if (player.fly && form === 'robot') thrust = airborne ? (inputState.jumpHeld ? 1 : 0.5) : def?.id === 'jetboots' && inputState.sprint && moving > 2 ? 0.4 : 0
      else if (def?.id === 'jet' && form === 'robot') thrust = airborne ? 0.8 : 0
      flyThrust = thrust
      const carry = !!def?.carry && form === 'robot' && !!worn && !suit
      if (form === 'robot' && player.grounded && moving > 0.5) stepPhase += (dt * moving * Math.PI) / (carry ? 3.2 : ROBOT.stride * size * 0.6)
      if (worn) {
        worn.update(dt, {
          t: elapsed,
          thrust,
          building: !!ctx.building,
          speed: player.grounded ? moving : 0,
          step: climbing ? climbPhase : stepPhase,
          moving: climbing ? Math.abs(player.velocity.y) > 0.5 || Math.abs(inputState.move.x) > 0.3 || !!mantle : player.grounded && moving > 0.8,
          climb: climbBlend,
        })
      }
      // Carried by the legs: lift the body until the lowest planted claw rests on the ground.
      if (carry && climbBlend < 0.5) {
        let low = Infinity
        for (const c of worn.points.claws) {
          c.getWorldPosition(v)
          if (v.y < low) low = v.y
        }
        const want = clamp(player.renderPosition.y - low + 0.15 + carryLift * 0, 0, 9)
        carryLift += (want - carryLift) * Math.min(1, dt * 6)
        legPlants(stepPhase, false)
      } else if (carry) {
        carryLift += (0 - carryLift) * Math.min(1, dt * 6)
        legPlants(climbPhase, true)
      } else carryLift += (0 - carryLift) * Math.min(1, dt * 6)
      if (carryLift > 0.01) playerGroup.position.y += carryLift + (moving > 0.8 ? Math.abs(Math.sin(stepPhase)) * ROBOT.carry.bob : 0)
      player.dims.height = PLAYER_DIMS.height + carryLift * 0.8
      if (climbing) {
        // Hugging the wall: lean in a little, sway with the climbing rhythm.
        playerGroup.rotation.x += 0.12 * climbBlend
        playerGroup.rotation.z += Math.sin(climbPhase) * 0.05 * climbBlend
      }
      if (form === 'robot' && !player.locked && !ctx.training && !climbing) {
        const flying = !!player.fly && airborne
        const pitchT = flying ? clamp(moving * SP.flyLean, 0, SP.maxFlyLean) : clamp(moving * 0.004 + motion.accel * 0.006, -0.08, 0.16)
        const rollT = flying ? clamp(-motion.yawRate * 0.35, -0.5, 0.5) : clamp(-motion.yawRate * moving * 0.004, -0.12, 0.12)
        const heaveT = flying && moving < 3 ? Math.sin(elapsed * 2.2) * 0.12 : 0
        if (landedHard) robotPhys.hv -= landedHard * 0.8 * size
        springStep(robotPhys, 'pitch', 'pv', pitchT, dt, 60, 10)
        springStep(robotPhys, 'roll', 'rv', rollT, dt, 60, 10)
        springStep(robotPhys, 'heave', 'hv', heaveT, dt, 120, 12)
        playerGroup.rotation.x += robotPhys.pitch
        playerGroup.rotation.z += robotPhys.roll
        playerGroup.position.y += clamp(robotPhys.heave, -0.35 * size, 0.6)
      } else {
        robotPhys.pitch = robotPhys.roll = robotPhys.heave = robotPhys.pv = robotPhys.rv = robotPhys.hv = 0
      }
      if (form === 'robot' && trailT <= 0 && thrust > 0.04 && worn) {
        trailT = ROBOT.trail
        flameTrail(worn.points.flames, thrust, size)
      }
      trailT -= dt
      // Take-off blast and landing slam for flying gear.
      if (player.fly && form === 'robot') {
        if (wasGrounded && airborne && player.velocity.y > 1) {
          burstAtFeet(def.glow, 8, false)
          snd.liftoff()
        }
        if (inputState.jumpHeld && !lastJump && airborne) snd.boost() // thrusters kick in mid-air
      }
      if (landedHard && form === 'robot' && worn && !bigFall) {
        burstAtFeet('#ffffff', 10, true)
        fx.sparks(player.renderPosition.x, player.renderPosition.y + 0.3, player.renderPosition.z, { count: 30, colors: [def.glow, '#ffffff'], speed: 7, size: 0.4, flat: true })
        snd.stomp(1.4 * size)
        snd.suspension(size)
      }
      // Heavy footsteps (giant suits) and the robotic arms' claws planting.
      if (form === 'robot' && worn && player.grounded && moving > 1 && !carry && (size > 1.2 || worn.points.claws.length > 0)) {
        stepAcc += moving * dt
        if (stepAcc > ROBOT.stride * size) {
          stepAcc = 0
          if (worn.points.claws.length) {
            const claws = worn.points.claws
            const c = claws[stepIdx++ % claws.length]
            c.getWorldPosition(v)
            fx.dust(v.x, Math.max(player.renderPosition.y, v.y - 0.3), v.z, { count: 2, size: 0.6, grow: 2, life: 0.6, spread: 0.2, push: 1, alpha: 0.35, color: '#d2bfa3', height: 0 })
            snd.clawStep()
          } else {
            footDust(4)
            snd.stomp(size)
            robotPhys.hv -= 0.5 // the whole machine dips on each footfall
          }
        }
      }
      // Work sparks: welding claws / zapping gauntlets while building or grabbing blocks.
      workT -= dt
      if (worn && form === 'robot' && workT <= 0 && (ctx.building || ctx.collecting)) {
        if (worn.points.claws.length && ctx.building) {
          workT = 0.07
          sparkAt(worn.points.claws.slice(0, 2), ['#bff6ff', '#ffffff', '#7dffe4'], 4)
          snd.weld()
        } else if (worn.points.fists.length) {
          workT = 0.14
          sparkAt(worn.points.fists, [def.glow, '#ffd23a', '#ffffff'], 4)
          if (Math.random() < 0.5) snd.zap()
        } else workT = 0.2
      }
      // Speed trail: glowing sparks off the feet when running fast in gear.
      speedT -= dt
      if (worn && form === 'robot' && player.grounded && moving > 14 && speedT <= 0) {
        speedT = 0.08
        const P = player.renderPosition
        fx.sparks(P.x, P.y + 0.15, P.z, { count: 2, colors: [def.glow, '#ffffff'], speed: 1.5, up: 0.8, size: 0.3, life: 0.45, flat: true })
      }
      // The suit's computer chirps now and then.
      chirpT -= dt
      if (chirpT <= 0) {
        chirpT = 6 + Math.random() * 8
        if (worn && form === 'robot' && size > 1) snd.chirp()
      }
      snd.loop('thrust', form === 'robot' ? thrust * (player.fly ? 0.9 : 0.6) : 0, airborne ? 0.4 + (inputState.jumpHeld ? 0.5 : 0) : Math.min(1, moving / 30), dt)

      // --- Vehicle form: suspension, steering, wheels, smoke, dust, screech, gear shifts.
      if (vehicle) {
        const ground = !airborne
        const lateral = motion.fwd * motion.yawRate
        let pitchT
        let rollT
        if (jet && airborne) {
          pitchT = clamp(-player.velocity.y * 0.03, -0.45, 0.45)
          rollT = clamp(-motion.yawRate * 0.5, -0.7, 0.7)
        } else {
          pitchT = clamp(-motion.accel * SP.pitchPerAccel, -0.12, 0.12)
          rollT = clamp(lateral * SP.rollPerLateral, -0.12, 0.12)
        }
        if (landedHard) {
          phys.hv -= landedHard * 1.2
          snd.suspension(1.2)
        }
        const throttle = clamp01(Math.abs(motion.accel) / 20)
        const heaveT = ground && !jet ? Math.sin(elapsed * 38) * 0.012 * (0.4 + throttle) : 0
        springStep(phys, 'pitch', 'pv', pitchT, dt)
        springStep(phys, 'roll', 'rv', rollT, dt)
        springStep(phys, 'heave', 'hv', heaveT, dt, 140, 12)
        const steerT = clamp(motion.yawRate * SP.steer * Math.sign(motion.fwd || 1), -SP.maxSteer, SP.maxSteer)
        phys.steer += (steerT - phys.steer) * Math.min(1, dt * 10)
        const vs = vehicle.group.children[0]?.scale.x ?? 1
        vehicle.update(dt, {
          speed: motion.fwd,
          steer: phys.steer,
          pitch: phys.pitch,
          roll: phys.roll,
          heave: phys.heave / vs,
          airborne: jet && airborne,
          thrust: jet ? (airborne ? 1 : moving > 1 ? 0.5 : 0.15) : 0,
        })
        const driving = form === 'vehicle' && !tf
        if (driving && jet && airborne && Math.random() < dt * 22) flameTrail(vehicle.points.flames, 1, 1.2)
        if (driving && !jet) {
          // Exhaust smoke (thicker when accelerating), wheel dust, tyre screech, gear shifts.
          exhaustT -= dt
          if (exhaustT <= 0) {
            exhaustT = 0.16 - throttle * 0.1
            for (const m of vehicle.points.exhaust) {
              m.getWorldPosition(v)
              fx.dust(v.x, v.y, v.z, { count: 1, size: 0.3 + throttle * 0.3, grow: 3.5, life: 1.2, color: throttle > 0.5 ? '#2e3036' : '#6a6d73', alpha: 0.3 + throttle * 0.25, rise: 1.6, spread: 0.05, push: 0.2, height: 0 })
            }
          }
          dustT -= dt
          if (ground && Math.abs(motion.fwd) > 6 && dustT <= 0) {
            dustT = 0.07
            for (const m of vehicle.points.rear) {
              m.getWorldPosition(v)
              fx.dust(v.x, v.y, v.z, { count: 1, size: 0.55, grow: 2.6, life: 0.8, color: '#d9c3a0', alpha: 0.3, rise: 0.6, push: 0.8, spread: 0.2, height: 0 })
            }
          }
          if (ground && Math.abs(lateral) > 22) {
            snd.skid(Math.min(1.5, Math.abs(lateral) / 30))
            if (Math.random() < dt * 20) {
              const m = vehicle.points.rear[Math.floor(Math.random() * vehicle.points.rear.length)]
              m?.getWorldPosition(v)
              if (m) fx.sparks(v.x, v.y + 0.05, v.z, { count: 2, colors: ['#ffb347', '#ffffff'], speed: 3, size: 0.25, life: 0.3, flat: true })
            }
          }
          const gearNow = Math.floor(Math.abs(motion.fwd) / 14)
          if (gearNow > motion.gear && motion.accel > 2) snd.gearShift()
          motion.gear = gearNow
        }
      }
      const driving = form === 'vehicle' && vehicle && !tf
      snd.loop('diesel', driving && vehicle.kind !== 'jet' ? 0.35 + 0.65 * Math.min(1, moving / 35) : 0, Math.min(1, Math.abs(motion.fwd % 14) / 14 * 0.6 + Math.min(1, moving / 45) * 0.4), dt)
      snd.loop('jet', driving && vehicle.kind === 'jet' ? (airborne ? 0.85 : 0.35 + Math.min(0.4, moving / 60)) : 0, airborne ? 0.6 + Math.min(0.4, Math.abs(player.velocity.y) / 30) : Math.min(1, moving / 50), dt)

      lastAir = airborne ? lastAir + dt : player.grounded && wasGrounded ? 0 : lastAir
      wasGrounded = player.grounded
      motion.lastVy = player.velocity.y
      lastJump = inputState.jumpHeld

      // Titan dropship, boost and aura.
      if (dropCd > 0) dropCd = Math.max(0, dropCd - dt)
      updateDrop(dt)
      const dist = drop ? drop.ship.group.position.distanceTo(hover) : 999
      snd.loop('rotor', drop ? Math.max(0.15, 1 - dist / 140) : 0, 0.5, dt)
      // Spider legs working (hydraulic whine) and the wind up high.
      const legWork = carry ? (climbing ? Math.min(1, Math.abs(player.velocity.y) / 8 + (mantle ? 0.8 : 0)) : Math.min(1, moving / 20) * 0.5) : 0
      snd.loop('hydraulic', legWork * 0.8, legWork, dt)
      snd.loop('wind', clamp((player.position.y - 12) / 60, 0, 1) * 0.8, clamp(player.position.y / 120, 0, 1), dt)
      if (boostT > 0) {
        boostT -= dt
        aura.visible = true
        const P = player.renderPosition
        aura.position.set(P.x, P.y + 0.08, P.z)
        aura.scale.setScalar((1 + Math.sin(elapsed * 6) * 0.12) * size)
        auraMat.opacity = 0.45 + Math.sin(elapsed * 10) * 0.2
        if (Math.random() < dt * 8) fx.sparks(P.x, P.y + 0.3, P.z, { count: 2, colors: ['#ff3a3a', '#ffd23a'], speed: 2, up: 3, size: 0.35, life: 0.6, spread: 1 })
        if (boostT <= 0) {
          S.boosts.gearBuild = 1
          aura.visible = false
          say('Titan Power faded. Call the dropship again soon!', true)
        }
      } else aura.visible = false

      refreshT -= dt
      if (refreshT <= 0) {
        refreshT = 0.25
        updateHint()
      }
    },
  }
}
